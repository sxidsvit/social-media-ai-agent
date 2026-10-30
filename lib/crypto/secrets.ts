import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encrypts secrets users give us (their Blotato API key) before they're stored, with AES-256-GCM and
// the server-only INTEGRATIONS_ENCRYPTION_KEY (32 bytes, base64: `openssl rand -base64 32`).
// Stored as "v1:<iv>:<tag>:<ciphertext>", all base64.

const VERSION = "v1";

function encryptionKey() {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!raw) throw new Error("INTEGRATIONS_ENCRYPTION_KEY isn't set: add a 32-byte base64 key to .env.local (openssl rand -base64 32).");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("INTEGRATIONS_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  return key;
}

export function isEncryptionConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(stored: string) {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unrecognised encrypted secret.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
