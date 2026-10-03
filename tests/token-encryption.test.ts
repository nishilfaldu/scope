import { afterEach, expect, test, vi } from "vitest";
import { encryptToken, decryptToken } from "../convex/lib/tokenEncryption";
afterEach(() => vi.unstubAllEnvs());

test("recoverable handoff secrets use randomized authenticated ciphertext", async () => {
  const secret = "acs_private_handoff_secret";
  const a = await encryptToken(secret),
    b = await encryptToken(secret);
  expect(a).not.toBe(b);
  expect(a).toMatch(/^enc:v1:/);
  expect(a).not.toContain(secret);
  expect(await decryptToken(a)).toBe(secret);
  expect(await decryptToken(b)).toBe(secret);
  await expect(decryptToken(secret)).rejects.toThrow("not encrypted");
  const tampered = a.slice(0, -4) + "AAAA";
  await expect(decryptToken(tampered)).rejects.toThrow();
});

test("a changed encryption key cannot recover outstanding handoff secrets", async () => {
  const encrypted = await encryptToken("ss_private");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", btoa("x".repeat(32)));
  await expect(decryptToken(encrypted)).rejects.toThrow("Failed to decrypt");
});
