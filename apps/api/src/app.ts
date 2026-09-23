import express from 'express';
import cors from 'cors';
import { optionalAuth, requestContext } from './middleware/context.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { transactionsRouter } from './routes/transactions.js';
import { trashRouter } from './routes/trash.js';
import { undoRouter } from './routes/undo.js';
import { auditRouter } from './routes/audit.js';
import { notificationsRouter } from './routes/notifications.js';
import { settingsRouter } from './routes/settings.js';
import { exchangeRatesRouter } from './routes/exchangeRates.js';
import { currenciesRouter } from './routes/currencies.js';
import { budgetsRouter } from './routes/budgets.js';
import { recurringRulesRouter } from './routes/recurringRules.js';
import { reportsRouter } from './routes/reports.js';
import { accountsRouter } from './routes/accounts.js';
import { debtsRouter } from './routes/debts.js';
import { categoriesRouter } from './routes/categories.js';
import { claimsSummaryRouter } from './routes/claimsSummary.js';
import { claimBatchesRouter } from './routes/claimBatches.js';
import { upcomingBillsRouter } from './routes/upcomingBills.js';

export function createApp() {
  const app = express();

  // Allow-list rather than `*`: the session cookie only travels on requests
  // with credentials, and a wildcard origin is rejected outright for those.
  // WEB_ORIGIN is this project's own name for it (comma-separated, so a
  // staging + production frontend can both be listed at once); FRONTEND_URL
  // is accepted too since that's the name most hosting-platform deploy guides
  // (Render, Railway, etc.) tell people to set — either works, and both can
  // be set together.
  const originSources = [process.env.WEB_ORIGIN, process.env.FRONTEND_URL].filter((v): v is string => Boolean(v));
  const allowedOrigins =
    originSources.length > 0
      ? originSources.flatMap((v) => v.split(',').map((o) => o.trim())).filter(Boolean)
      : ['http://localhost:5173', 'http://localhost:5174'];
  app.use(cors({ origin: allowedOrigins, credentials: true }));

  // Higher than express's 100kb default: /transactions/import carries a base64-encoded
  // .xlsx file in the JSON body (base64 inflates size ~33%), not just small form fields.
  app.use(express.json({ limit: '25mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Auth endpoints resolve the user when a token is present but never demand
  // one — logging in and first-run setup both happen while signed out.
  app.use('/api/auth', optionalAuth, authRouter);

  // Everything past here requires a valid signed token.
  app.use('/api', requestContext);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/trash', trashRouter);
  app.use('/api', undoRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/exchange-rates', exchangeRatesRouter);
  app.use('/api/currencies', currenciesRouter);
  app.use('/api/budgets', budgetsRouter);
  app.use('/api/recurring-rules', recurringRulesRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/accounts', accountsRouter);
  app.use('/api/debts', debtsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/claims-summary', claimsSummaryRouter);
  app.use('/api/claim-batches', claimBatchesRouter);
  app.use('/api/upcoming-bills', upcomingBillsRouter);

  app.use(errorHandler);
  return app;
}
