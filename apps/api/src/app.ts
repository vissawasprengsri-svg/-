import express from 'express';
import { requestContext } from './middleware/context.js';
import { errorHandler } from './middleware/errorHandler.js';
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

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

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

  app.use(errorHandler);
  return app;
}
