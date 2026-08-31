import type { NextFunction, Request, Response } from 'express';

const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

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
 * Real auth lands in a later phase. For now this resolves the acting user
 * from a header (falling back to the seeded dev user) and requires every
 * client to send a stable session id — the undo/redo stack and the "ลบแล้ว
 * — เลิกทำ" toast are both scoped per session.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  req.userId = (req.header('x-user-id') || DEV_USER_ID).trim();
  const sessionId = req.header('x-session-id');
  if (!sessionId) {
    res.status(400).json({ error: { code: 'MISSING_SESSION_ID', message: 'x-session-id header is required' } });
    return;
  }
  req.sessionId = sessionId;
  next();
}
