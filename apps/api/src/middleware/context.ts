import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE, readCookie, verifySessionToken } from '../domain/auth.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
      sessionId: string;
    }
  }
}

/**
 * Dev/test-only auth bypass so Claude (and local devs) can drive the API and
 * UI without a real login.
 *
 * This has to be switched ON deliberately (ENABLE_DEV_AUTH_BYPASS=true) rather
 * than switched off by a production marker. Keying it off `NODE_ENV !==
 * 'production'` alone means every way of *failing* to configure a deployment —
 * an unset variable, a typo, a host that defaults NODE_ENV to something else —
 * fails toward an open door with no password on it. Requiring an explicit,
 * uniquely-named opt-in means a misconfigured deployment gets a locked door
 * instead, which is the safe direction to be wrong in. NODE_ENV is still
 * checked as a second latch, so the flag can't open anything in production
 * even if it leaks into that environment.
 */
export const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';
export const isDevAuthBypass =
  process.env.ENABLE_DEV_AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'production';

if (isDevAuthBypass) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n*** AUTH BYPASS ACTIVE (ENABLE_DEV_AUTH_BYPASS=true) — every request is treated as DEV_USER_ID. ' +
      'Never set this outside local development. ***\n'
  );
}

/**
 * Resolves the acting user from a signed session token — an httpOnly cookie
 * for the web app, or `Authorization: Bearer <token>` for scripts/CLI use.
 *
 * The identity comes from the token's signature, never from a client-supplied
 * id: the previous `x-user-id` header meant anyone who could reach the API
 * could name whichever user they liked and read or edit that person's
 * finances. There is deliberately no fallback user — an unsigned or missing
 * token is a 401, not a quiet downgrade to some default account.
 */
async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.header('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const token = bearer ?? readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Attaches the user (if any) without demanding one. Mounted ahead of the auth
 * routes so `/auth/session` can report "signed in already" or "needs setup",
 * both of which have to be answerable while logged out.
 */
export const optionalAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    if (isDevAuthBypass) {
      req.userId = DEV_USER_ID;
      next();
      return;
    }
    const userId = await resolveUserId(req);
    if (userId) req.userId = userId;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Gate for everything that touches user data. Also requires the client's
 * stable session id, which scopes the undo/redo stack (see commandStore) —
 * that's a grouping key for one browser tab's command history, not an
 * identity, so it stays client-generated.
 */
export const requestContext = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (isDevAuthBypass) {
      req.userId = DEV_USER_ID;
    } else {
      const userId = await resolveUserId(req);
      if (!userId) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue' } });
        return;
      }
      req.userId = userId;
    }

    const sessionId = req.header('x-session-id');
    if (!sessionId) {
      res.status(400).json({ error: { code: 'MISSING_SESSION_ID', message: 'x-session-id header is required' } });
      return;
    }
    req.sessionId = sessionId;
    next();
  } catch (err) {
    next(err);
  }
};
