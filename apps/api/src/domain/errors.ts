export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const Errors = {
  validation: (message: string) => new AppError('VALIDATION_ERROR', message, 400),
  notFound: (entity: string) => new AppError('NOT_FOUND', `${entity} not found`, 404),
  idempotencyConflict: () =>
    new AppError('IDEMPOTENCY_KEY_CONFLICT', 'This idempotency key was already used with a different request body', 409),
  clientIdReusedAfterDelete: () =>
    new AppError(
      'CLIENT_ID_REUSED_AFTER_DELETE',
      'A transaction with this client id was already created and has since been deleted — submit it as a new entry',
      409
    ),
  nothingToUndo: () => new AppError('NOTHING_TO_UNDO', 'There is nothing left to undo in this session', 409),
  nothingToRedo: () => new AppError('NOTHING_TO_REDO', 'There is nothing left to redo in this session', 409),
  unauthenticated: () => new AppError('UNAUTHENTICATED', 'Sign in to continue', 401),
  invalidCredentials: () => new AppError('INVALID_CREDENTIALS', 'Incorrect password', 401),
  tooManyAttempts: () => new AppError('TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts — try again later', 429),
};
