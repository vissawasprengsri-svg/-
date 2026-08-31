import type { NotifSeverity } from '@finance/shared';

/**
 * Real push (FCM/APNs) and email (SMTP/SES) delivery need provider
 * credentials this environment doesn't have. These stubs are the
 * integration point: swap the body of `send` for a real provider call
 * without touching any caller. Until then they log intent so the flow is
 * observable end to end, and the caller still records that a send was
 * attempted.
 */
export interface PushPayload {
  userId: string;
  title: string;
  body: string;
  severity: NotifSeverity;
  deepLink: string | null;
}

export interface PushChannel {
  send(payload: PushPayload): Promise<{ delivered: boolean }>;
}

export const consoleLogPushChannel: PushChannel = {
  async send(payload) {
    console.log(`[push:stub] -> user ${payload.userId}: ${payload.title} — ${payload.body}`);
    return { delivered: true };
  },
};

export interface DigestEmailPayload {
  userId: string;
  email: string;
  weekOf: string;
  groups: Array<{ ruleCode: string; title: string; count: number; items: string[] }>;
}

export interface EmailChannel {
  sendWeeklyDigest(payload: DigestEmailPayload): Promise<{ delivered: boolean }>;
}

export const consoleLogEmailChannel: EmailChannel = {
  async sendWeeklyDigest(payload) {
    console.log(`[email:stub] weekly digest -> ${payload.email} (${payload.groups.length} groups)`);
    return { delivered: true };
  },
};
