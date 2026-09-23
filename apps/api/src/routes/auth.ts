import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { clearSessionCookie, hashPassword, setSessionCookie, signSessionToken, verifyPassword } from '../domain/auth.js';
import { Errors } from '../domain/errors.js';

export const authRouter = Router();

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
}

async function listUsers(): Promise<UserRow[]> {
  const res = await pool.query<UserRow>(
    'SELECT id, email, display_name, password_hash FROM users WHERE deleted_at IS NULL ORDER BY created_at'
  );
  return res.rows;
}

/**
 * Failed-login throttle, in memory and per source address. This is a
 * single-user app on one box, so a Map is the right size of solution — it
 * exists to make offline-style guessing against the login endpoint useless,
 * not to survive a restart or coordinate across replicas.
 */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; firstAt: number }>();

function throttleKey(ip: string | undefined): string {
  return ip ?? 'unknown';
}

function isThrottled(ip: string | undefined): boolean {
  const entry = attempts.get(throttleKey(ip));
  if (!entry) return false;
  if (Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.delete(throttleKey(ip));
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip: string | undefined): void {
  const key = throttleKey(ip);
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  entry.count += 1;
}

/**
 * Boot probe for the web app: tells it whether to render the login form, the
 * first-run "choose a password" form, or go straight to the dashboard. Always
 * 200 so a logged-out first load isn't reported as an error.
 */
authRouter.get(
  '/session',
  asyncHandler(async (req, res) => {
    const users = await listUsers();
    const needsSetup = users.length === 1 && users[0]!.password_hash === null;

    if (!req.userId) {
      res.json({ authenticated: false, needsSetup });
      return;
    }
    const user = users.find((u) => u.id === req.userId);
    if (!user) {
      res.json({ authenticated: false, needsSetup });
      return;
    }
    res.json({ authenticated: true, needsSetup: false, user: { id: user.id, email: user.email, displayName: user.display_name } });
  })
);

const passwordSchema = z.object({ password: z.string().min(8, 'Password must be at least 8 characters') });

/**
 * First-run setup: claims the seeded account by giving it a password. Only
 * possible while exactly one user exists *and* has no password yet, so it
 * closes itself off permanently the moment it's used — it can't be replayed
 * later to take over an account that already has one.
 */
authRouter.post(
  '/setup',
  asyncHandler(async (req, res) => {
    const { password } = passwordSchema.parse(req.body);
    const users = await listUsers();
    if (users.length !== 1 || users[0]!.password_hash !== null) {
      throw Errors.validation('Setup has already been completed — sign in instead.');
    }
    const user = users[0]!;
    const hash = await hashPassword(password);
    await withTransaction(async (client) => {
      // Guarded again inside the transaction so two concurrent setup calls
      // can't both pass the check above and race to set a password.
      const updated = await client.query(
        'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2 AND password_hash IS NULL',
        [hash, user.id]
      );
      if (updated.rowCount === 0) throw Errors.validation('Setup has already been completed — sign in instead.');
    });

    setSessionCookie(res, await signSessionToken(user.id));
    res.json({ authenticated: true, user: { id: user.id, email: user.email, displayName: user.display_name } });
  })
);

const loginSchema = z.object({ email: z.string().email().optional(), password: z.string().min(1) });

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    if (isThrottled(req.ip)) throw Errors.tooManyAttempts();
    const { email, password } = loginSchema.parse(req.body);

    const users = await listUsers();
    // Single-user install: the email field is optional, since there's only one
    // account it could possibly be.
    const user = email ? users.find((u) => u.email.toLowerCase() === email.toLowerCase()) : users.length === 1 ? users[0] : undefined;

    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!ok || !user) {
      recordFailure(req.ip);
      // Same message either way: don't leak which emails exist.
      throw Errors.invalidCredentials();
    }

    attempts.delete(throttleKey(req.ip));
    setSessionCookie(res, await signSessionToken(user.id));
    res.json({ authenticated: true, user: { id: user.id, email: user.email, displayName: user.display_name } });
  })
);

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
