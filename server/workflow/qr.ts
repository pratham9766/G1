import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { key } from "../security";
const schema = z
  .object({
    v: z.literal(1),
    type: z.literal("g1-consent-identity"),
    connectionId: z.uuid(),
    nonce: z.uuid(),
    exp: z.number().int(),
  })
  .strict();
export function createIdentityQR(connectionId: string) {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      type: "g1-consent-identity",
      connectionId,
      nonce: randomUUID(),
      exp: Date.now() + 10 * 60_000,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", key("IDENTITY"))
    .update("g1-qr:" + payload)
    .digest("base64url");
  return `g1id:${payload}.${signature}`;
}
export function validateIdentityQR(value: string) {
  try {
    if (value.length > 1024 || !value.startsWith("g1id:")) throw new Error();
    const parts = value.slice(5).split(".");
    if (parts.length !== 2) throw new Error();
    const [payload, sig] = parts;
    const expected = createHmac("sha256", key("IDENTITY"))
      .update("g1-qr:" + payload)
      .digest();
    const actual = Buffer.from(sig, "base64url");
    if (actual.length !== 32 || !timingSafeEqual(expected, actual))
      throw new Error();
    const data = schema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
    if (data.exp < Date.now() || data.exp > Date.now() + 11 * 60_000)
      throw new Error();
    return data;
  } catch {
    throw new BadRequestException(
      "Invalid or expired G1 identity QR. Ask the patient to refresh it, or use the manual identity fallback.",
    );
  }
}
export const normalizeABHA = (value: string) =>
  value.includes("@") ? value.trim().toLowerCase() : value.replace(/[ -]/g, "");
export function validateABHA(value: string) {
  const normalized = normalizeABHA(value);
  if (!/^(?:\d{14}|[a-z0-9._-]{3,60}@[a-z0-9.-]{2,30})$/.test(normalized))
    throw new BadRequestException(
      "Enter a 14-digit ABHA number or an ABHA address",
    );
  return normalized;
}
export const maskABHA = (number: string) => `**-****-****-${number.slice(-4)}`;
