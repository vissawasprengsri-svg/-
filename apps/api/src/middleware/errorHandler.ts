import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../domain/errors.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // A schema mismatch is the caller sending the wrong thing, not the server
  // falling over: without this every bad field anywhere in the API surfaced as
  // a 500 "Unexpected server error" with nothing saying which field was wrong.
  if (err instanceof ZodError) {
    const detail = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: detail } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
}

export function asyncHandler<Req extends Request>(
  fn: (req: Req, res: Response) => Promise<void>
): (req: Req, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
