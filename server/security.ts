import "dotenv/config";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
export const hostedDemo = process.env.G1_HOSTED_DEMO === "true";
export const production = process.env.NODE_ENV === "production";
export const dataDir = resolve(process.env.DATA_DIR || "./data");
mkdirSync(dataDir, { recursive: true });
const keyFile = resolve(dataDir, "development-keys.json");
let local: Record<string, string> = {};
if (!production && !hostedDemo) {
  if (existsSync(keyFile)) local = JSON.parse(readFileSync(keyFile, "utf8"));
  else {
    for (const n of ["IDENTITY", "CLINICAL", "AUDIT", "LOOKUP"])
      local[n] = randomBytes(32).toString("hex");
    writeFileSync(keyFile, JSON.stringify(local), { mode: 0o600 });
  }
}
export function key(domain: string): Buffer {
  const value = process.env[domain + "_KEY"] || local[domain];
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error(`${domain}_KEY must be a distinct 32-byte hex key`);
  return Buffer.from(value, "hex");
}
const domains = ["IDENTITY", "CLINICAL", "AUDIT", "LOOKUP"];
if (new Set(domains.map((d) => key(d).toString("hex"))).size !== 4)
  throw new Error("Vault keys must be distinct");
export function seal(data: Buffer | string, domain = "CLINICAL"): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(domain), iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64",
  );
}
export function unseal(data: string, domain = "CLINICAL"): Buffer {
  const b = Buffer.from(data, "base64");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(domain),
    b.subarray(0, 12),
  );
  cipher.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]);
}
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const lookup = (value: string) =>
  createHmac("sha256", key("LOOKUP"))
    .update(value.toLowerCase().trim())
    .digest("hex");
export function passwordHash(value: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
}
export function passwordMatches(value: string, stored: string) {
  const [salt, digest] = stored.split(":");
  const result = scryptSync(value, salt, 64);
  return timingSafeEqual(result, Buffer.from(digest, "hex"));
}
export const token = () => randomBytes(32).toString("base64url");
