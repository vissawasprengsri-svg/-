import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response } from 'express';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

// OWASP-range scrypt parameters (N=2^16). Stored alongside each hash rather than
// hardcoded at verify time so these can be raised later without invalidating
// passwords hashed under the old cost.
const SCRYPT = { N: 65536, r: 8, p: 1 };
const KEY_LEN = 64;

/**
 * scrypt needs roughly `128 * N * r` bytes, which at these parameters is ~64MB —
 * over Node's 32MB default guard, so it has to be raised explicitly or the KDF
 * throws instead of hashing. Doubled for headroom.
 */
function maxmemFor(n: number, r: number): number {
  return 256 * n * r;
}

export const SESSION_COOKIE = 'finance_session';
const TOKEN_TTL = '30d';

/** `scrypt$N$r$p$salt$hash`, all base64 — self-describing so old hashes stay verifiable. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, { ...SCRYPT, maxmem: maxmemFor(SCRYPT.N, SCRYPT.r) });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64!, 'base64');
  const derived = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64!, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: maxmemFor(Number(n), Number(r)),
  });
  // Constant-time: a length mismatch alone must not short-circuit early.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * The signing key. Deliberately throws rather than falling back to a default:
 * a predictable secret would let anyone mint a token for any user, which is
 * the exact hole this module exists to close.
 */
function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET is missing or too short (needs >= 32 chars). Generate one and put it in apps/api/.env');
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secretKey());
}

/** Returns the user id the token was issued for, or null if it's missing/expired/forged. */
export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Minimal single-cookie reader — avoids pulling in cookie-parser for one lookup. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * `Lax` is the right default: it still rides along on normal navigation but
 * blocks the classic cross-site form/link CSRF pattern, and it's all a
 * same-origin deployment (frontend and API behind the same domain) needs.
 *
 * A *split* deployment — frontend on Vercel, API on Render, different domains
 * — breaks under `Lax`, silently: browsers don't attach a `Lax` cookie to a
 * fetch/XHR call made from a different site at all, only to top-level
 * navigations. Every API request would still succeed at the network level and
 * still get a 401 back, which looks exactly like "login isn't working" with
 * nothing in the browser console pointing at the cookie. `None` fixes that,
 * but browsers refuse to set a `None` cookie that isn't also `Secure` — so
 * this is opt-in via CROSS_ORIGIN_COOKIES, not automatic, since flipping it
 * on same-origin deployment would trade away CSRF protection for nothing.
 */
function sessionCookieSameSite(): 'lax' | 'none' {
  return process.env.CROSS_ORIGIN_COOKIES === 'true' ? 'none' : 'lax';
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // not readable from JS, so XSS can't lift the token
    sameSite: sessionCookieSameSite(),
    secure: process.env.COOKIE_SECURE === 'true', // on once served over HTTPS
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: sessionCookieSameSite(),
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
  });
}
