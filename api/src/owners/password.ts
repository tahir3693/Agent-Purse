// Password hashing with scrypt (node:crypto, no native deps). Owner-approved
// over argon2/bcrypt. Format: scrypt$N$r$p$saltB64url$hashB64url.
// Passwords and hashes are never logged.

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  keyLen: number;
}

export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 15, r: 8, p: 1, keyLen: 32 };
const MAX_N = 2 ** 20;

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const opts: ScryptOptions = {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 256 * params.N * params.r + 1024 * 1024,
  };
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, params.keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string, params = DEFAULT_SCRYPT): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, params);
  return ["scrypt", params.N, params.r, params.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Constant-time compare. Malformed stored hashes verify false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((x) => Number.isInteger(x) && x > 0) || N > MAX_N) return false;
  const salt = Buffer.from(parts[4]!, "base64url");
  const expected = Buffer.from(parts[5]!, "base64url");
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = await derive(password, salt, { N, r, p, keyLen: expected.length });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}