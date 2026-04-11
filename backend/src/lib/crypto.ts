import crypto from "node:crypto";

import { env } from "./env.js";

const ALGORITHM = "aes-256-gcm";
const KEY = crypto.createHash("sha256").update(env.GMAIL_TOKEN_ENCRYPTION_KEY).digest();

export function encryptSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

export function decryptSecret(payload: string) {
  const data = Buffer.from(payload, "base64url");
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function signState(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", env.GMAIL_TOKEN_ENCRYPTION_KEY)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyState<T>(value: string): T {
  const [encoded, signature] = value.split(".");
  const expected = crypto
    .createHmac("sha256", env.GMAIL_TOKEN_ENCRYPTION_KEY)
    .update(encoded)
    .digest("base64url");

  if (!encoded || !signature || signature !== expected) {
    throw new Error("Invalid OAuth state");
  }

  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
}

