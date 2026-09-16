import { env } from "../_generated/server";

/** Versioned ciphertext prefix so encrypted values are detectable. */
export const TOKEN_CIPHER_PREFIX = "enc:v1:";

const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Missing/empty env must never throw on .trim(). */
function envTrimmed(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function requireEncryptionKeyMaterial(): Uint8Array {
  const raw = envTrimmed(env.TOKEN_ENCRYPTION_KEY);
  if (raw === undefined) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. Generate a key with `openssl rand -base64 32` and set it via `npx convex env set TOKEN_ENCRYPTION_KEY <key>`.",
    );
  }
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(raw);
  } catch {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  }
  if (keyBytes.byteLength !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${keyBytes.byteLength})`,
    );
  }
  return keyBytes;
}

async function importAesKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    requireEncryptionKeyMaterial() as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export function isEncryptedToken(value: string): boolean {
  return value.startsWith(TOKEN_CIPHER_PREFIX);
}

/**
 * Encrypt a secret with AES-256-GCM.
 * Returns `enc:v1:` + base64(iv || ciphertext+tag).
 */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await importAesKey();
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const packed = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(ciphertext, iv.byteLength);
  return `${TOKEN_CIPHER_PREFIX}${bytesToBase64(packed)}`;
}

/**
 * Decrypt a stored token. Values without a valid `enc:v1:` ciphertext
 * prefix are rejected — plaintext is never returned as-is.
 */
export async function decryptToken(stored: string): Promise<string> {
  if (!isEncryptedToken(stored)) {
    throw new Error(
      "Stored connection token is not encrypted (expected enc:v1: ciphertext). Reconnect the provider so tokens are stored encrypted.",
    );
  }
  const packed = base64ToBytes(stored.slice(TOKEN_CIPHER_PREFIX.length));
  if (packed.byteLength <= IV_BYTES) {
    throw new Error("Encrypted token is truncated or corrupt");
  }
  const iv = packed.subarray(0, IV_BYTES);
  const ciphertext = packed.subarray(IV_BYTES);
  const key = await importAesKey();
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error(
      "Failed to decrypt connection token. Check TOKEN_ENCRYPTION_KEY matches the key used to encrypt.",
    );
  }
}
