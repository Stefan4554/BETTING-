import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * AES-256-GCM encryption for user API keys at rest. The key comes from
 * API_KEY_ENCRYPTION_KEY (32 bytes, hex or base64) and never leaves the server.
 * Ciphertext format: base64(iv[12] | tag[16] | data).
 */
function key(): Buffer {
  const raw = env().API_KEY_ENCRYPTION_KEY;
  if (!raw) throw new Error("API_KEY_ENCRYPTION_KEY is not configured; API keys cannot be stored securely.");
  const k = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("API_KEY_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)");
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}

export function decryptSecret(token: string): string {
  const buf = Buffer.from(token, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

export const last4 = (s: string) => (s.length <= 4 ? "••••" : s.slice(-4));
