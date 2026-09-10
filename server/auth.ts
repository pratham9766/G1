import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  randomUUID,
  createHmac,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
import type { Request, Response } from "express";
import { store } from "./store";
import {
  hash,
  lookup,
  passwordHash,
  passwordMatches,
  production,
  token,
} from "./security";
import type { Entity, User } from "./types";
export type AuthRequest = Request & {
  user: User;
  session: Entity;
  rawBody?: Buffer;
};
const cookies = {
  httpOnly: true,
  secure: production,
  sameSite: "strict" as const,
  path: "/api",
};
export const safeUser = (u: User) => ({
  id: u.id,
  role: u.role,
  name: u.name,
  email: u.email,
  patientId: u.patientId,
  tenant: u.tenant,
  verified: u.verified,
  department: u.department,
  mfaEnabled: !!u.mfaSecret,
});
export async function createUser(
  email: string,
  password: string,
  name: string,
  role: User["role"] = "patient",
  tenant = "",
  extra: Record<string, unknown> = {},
) {
  const id = lookup(email);
  if (await store.get("identity", id))
    throw new BadRequestException(
      "Account cannot be created with these details",
    );
  const patientId = role === "patient" ? randomUUID() : undefined;
  return store.put<User>("identity", {
    id,
    kind: "user",
    owner: patientId || id,
    tenant,
    role,
    email: email.toLowerCase(),
    password: passwordHash(password),
    name,
    patientId,
    verified: role === "patient",
    ...extra,
  });
}
export async function issueSession(
  user: User,
  res: Response,
  family = randomUUID(),
) {
  const access = token(),
    refresh = token(),
    csrf = token(),
    now = Date.now();
  await store.put("identity", {
    id: hash(access),
    kind: "session",
    owner: user.id,
    tenant: user.tenant,
    userId: user.id,
    family,
    csrf,
    expires: now + 15 * 60_000,
  });
  await store.put("identity", {
    id: hash(refresh),
    kind: "refresh",
    owner: user.id,
    tenant: user.tenant,
    userId: user.id,
    family,
    expires: now + 8 * 60 * 60_000,
    used: false,
  });
  res.cookie("g1_access", access, { ...cookies, maxAge: 15 * 60_000 });
  res.cookie("g1_refresh", refresh, { ...cookies, maxAge: 8 * 60 * 60_000 });
  return { user: safeUser(user), csrf };
}
export async function revokeFamily(family: string, userId: string) {
  for (const kind of ["session", "refresh"])
    for (const s of await store.list("identity", kind, { owner: userId }))
      if (s.family === family) {
        s.revoked = true;
        await store.put("identity", s);
      }
}
export async function authenticate(
  req: Request,
): Promise<{ user: User; session: Entity }> {
  const s = req.cookies?.g1_access
    ? await store.get("identity", hash(req.cookies.g1_access))
    : undefined;
  const user = s ? await store.get<User>("identity", s.userId) : undefined;
  if (
    !s ||
    s.kind !== "session" ||
    s.revoked ||
    s.expires <= Date.now() ||
    !user ||
    user.disabled
  )
    throw new UnauthorizedException("Sign in to continue");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers["x-csrf-token"] !== s.csrf
  )
    throw new ForbiddenException(
      "Session validation failed; reload and try again",
    );
  return { user, session: s };
}
export function totp(secret: string, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const mac = createHmac("sha1", Buffer.from(secret, "hex"))
    .update(counter)
    .digest();
  const offset = mac[19] & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
export function verifyTotp(secret: string, code: string, lastStep = -1) {
  if (!/^\d{6}$/.test(code)) return undefined;
  for (const delta of [-30000, 0, 30000]) {
    const at = Date.now() + delta;
    const step = Math.floor(at / 30000);
    if (
      step > lastStep &&
      timingSafeEqual(Buffer.from(totp(secret, at)), Buffer.from(code))
    )
      return step;
  }
  return undefined;
}
export function newMfaSecret() {
  const raw = randomBytes(20);
  let bits = 0,
    value = 0,
    text = "";
  for (const b of raw) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      text += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return { hex: raw.toString("hex"), base32: text };
}
export async function login(
  email: string,
  password: string,
  code: string | undefined,
  res: Response,
) {
  const user = await store.get<User>("identity", lookup(email));
  // Comparable password work for unknown accounts.
  const ok = passwordMatches(
    password,
    user?.password || passwordHash("unknown-account-password"),
  );
  if (!user || !ok || user.disabled)
    throw new UnauthorizedException("Email or password is incorrect");
  if (user.mfaSecret) {
    const step = verifyTotp(user.mfaSecret, code || "", user.mfaLastStep);
    if (step === undefined)
      throw new UnauthorizedException("A fresh authenticator code is required");
    user.mfaLastStep = step;
    await store.put("identity", user);
  }
  if (production && user.role !== "patient" && !user.mfaSecret)
    throw new ForbiddenException(
      "Privileged accounts require MFA enrollment before production use",
    );
  await store.audit(user.id, user.patientId || "", "auth.login", user.tenant);
  return issueSession(user, res);
}
