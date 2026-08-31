import { Router } from 'express';
import { z } from 'zod';
import { NOTIFICATION_RULE_CODES, SUPPORTED_LOCALES } from '@finance/shared';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPreferences, getUserSettings, updatePreference, updateUserSettings } from '../domain/notifications/preferences.js';
import { Errors } from '../domain/errors.js';

export const settingsRouter = Router();

const settingsPatchSchema = z.object({
  claimOverdueDays: z.number().int().positive().optional(),
  cardUsageAlertPct: z.number().int().min(1).max(100).optional(),
  budgetAlertPcts: z.array(z.number().int().positive()).optional(),
  dailyReminderTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

settingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await withTransaction((client) => getUserSettings(client, req.userId));
    res.json({ settings });
  })
);

settingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const patch = settingsPatchSchema.parse(req.body);
    const settings = await withTransaction((client) => updateUserSettings(client, req.userId, patch));
    res.json({ settings });
  })
);

settingsRouter.get(
  '/notification-preferences',
  asyncHandler(async (req, res) => {
    const preferences = await withTransaction((client) => getPreferences(client, req.userId));
    res.json({ preferences });
  })
);

const preferencePatchSchema = z.object({
  inAppEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  leadDays: z.array(z.number().int().positive()).optional(),
});

const localeCodes = SUPPORTED_LOCALES.map((l) => l.code) as [string, ...string[]];

settingsRouter.get(
  '/locale',
  asyncHandler(async (req, res) => {
    const result = await withTransaction((client) =>
      client.query('SELECT locale, timezone, base_currency FROM users WHERE id = $1', [req.userId])
    );
    const row = result.rows[0];
    if (!row) throw Errors.notFound('user');
    res.json({ locale: row.locale, timezone: row.timezone, baseCurrency: row.base_currency });
  })
);

const localePatchSchema = z.object({
  locale: z.enum(localeCodes).optional(),
  timezone: z.string().min(1).optional(),
});

settingsRouter.put(
  '/locale',
  asyncHandler(async (req, res) => {
    const patch = localePatchSchema.parse(req.body);
    const entries = Object.entries(patch) as [string, string][];
    if (entries.length === 0) {
      res.json({ ok: true });
      return;
    }
    const setClause = entries.map(([key], i) => `${key} = $${i + 2}`).join(', ');
    const values = entries.map(([, v]) => v);
    await withTransaction((client) =>
      client.query(`UPDATE users SET ${setClause}, updated_at = now() WHERE id = $1`, [req.userId, ...values])
    );
    res.json({ ok: true });
  })
);

settingsRouter.put(
  '/notification-preferences/:ruleCode',
  asyncHandler(async (req, res) => {
    const ruleCode = req.params.ruleCode as (typeof NOTIFICATION_RULE_CODES)[number];
    if (!NOTIFICATION_RULE_CODES.includes(ruleCode)) {
      throw Errors.validation(`Unknown notification rule code: ${req.params.ruleCode}`);
    }
    const patch = preferencePatchSchema.parse(req.body);
    await withTransaction((client) => updatePreference(client, req.userId, ruleCode, patch));
    const preferences = await withTransaction((client) => getPreferences(client, req.userId));
    res.json({ preferences });
  })
);
