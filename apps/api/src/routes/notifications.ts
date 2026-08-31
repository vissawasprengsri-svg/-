import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { dismiss, listNotifications, markAllRead, markRead, unreadCount } from '../services/notificationService.js';
import { runNotificationChecksForUser } from '../domain/notifications/runChecks.js';
import { sendWeeklyDigest } from '../domain/notifications/digest.js';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const notifications = await withTransaction((client) => listNotifications(client, req.userId));
    res.json({ notifications });
  })
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const count = await withTransaction((client) => unreadCount(client, req.userId));
    res.json({ count });
  })
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const notification = await withTransaction((client) => markRead(client, req.userId, req.params.id!));
    res.json({ notification });
  })
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const count = await withTransaction((client) => markAllRead(client, req.userId));
    res.json({ count });
  })
);

notificationsRouter.post(
  '/:id/dismiss',
  asyncHandler(async (req, res) => {
    const notification = await withTransaction((client) => dismiss(client, req.userId, req.params.id!));
    res.json({ notification });
  })
);

/**
 * Manually fires the rule engine for the current user. In production this
 * is what a scheduled job (cron / pg_cron) calls periodically — exposed
 * here too so it can be triggered on demand without waiting for a
 * scheduler to be wired up.
 */
notificationsRouter.post(
  '/run-checks',
  asyncHandler(async (req, res) => {
    const result = await withTransaction((client) => runNotificationChecksForUser(client, req.userId));
    res.json(result);
  })
);

notificationsRouter.post(
  '/send-digest',
  asyncHandler(async (req, res) => {
    const result = await withTransaction((client) => sendWeeklyDigest(client, req.userId));
    res.json(result);
  })
);
