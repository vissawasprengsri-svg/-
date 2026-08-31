import type {
  Budget,
  ClaimStatus,
  CreateTransactionInput,
  LocaleCode,
  MonthlySummary,
  NotificationItem,
  NotificationPreference,
  NotificationRuleCode,
  RecurringRule,
  RecurringTemplate,
  RecurrenceFreq,
  Transaction,
  TransactionSearchFilters,
  TrendPoint,
  UserSettings,
} from '@finance/shared';

const SESSION_KEY = 'finance.session-id';

function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { idempotent?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-session-id': getSessionId(),
  };
  if (opts.idempotent !== false && method !== 'GET') {
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  listTransactions: () => request<{ transactions: Transaction[] }>('GET', '/transactions'),
  createTransaction: (input: CreateTransactionInput) =>
    request<{ transaction: Transaction; replay: boolean }>('POST', '/transactions', input),
  deleteTransaction: (id: string) => request<{ transaction: Transaction }>('DELETE', `/transactions/${id}`),
  setClaimStatus: (id: string, status: ClaimStatus) =>
    request<{ transaction: Transaction }>('POST', `/transactions/${id}/claim-status`, { status }),
  listTrash: () => request<{ transactions: Transaction[] }>('GET', '/trash'),
  restoreFromTrash: (id: string) => request<{ transaction: Transaction }>('POST', `/trash/${id}/restore`),
  undo: () => request<{ commandType: string; transactions: Transaction[] }>('POST', '/undo', {}, { idempotent: false }),
  redo: () => request<{ commandType: string; transactions: Transaction[] }>('POST', '/redo', {}, { idempotent: false }),
  auditHistory: (transactionId: string) => request<{ history: unknown[] }>('GET', `/audit/transactions/${transactionId}`),

  listNotifications: () => request<{ notifications: NotificationItem[] }>('GET', '/notifications'),
  unreadCount: () => request<{ count: number }>('GET', '/notifications/unread-count'),
  markNotificationRead: (id: string) => request<{ notification: NotificationItem }>('POST', `/notifications/${id}/read`),
  markAllNotificationsRead: () => request<{ count: number }>('POST', '/notifications/read-all'),
  dismissNotification: (id: string) => request<{ notification: NotificationItem }>('POST', `/notifications/${id}/dismiss`),
  runNotificationChecks: () => request<{ created: number; pushed: number }>('POST', '/notifications/run-checks'),

  getSettings: () => request<{ settings: UserSettings }>('GET', '/settings'),
  updateSettings: (patch: Partial<UserSettings>) => request<{ settings: UserSettings }>('PUT', '/settings', patch),
  getNotificationPreferences: () =>
    request<{ preferences: Record<NotificationRuleCode, NotificationPreference> }>('GET', '/settings/notification-preferences'),
  updateNotificationPreference: (ruleCode: NotificationRuleCode, patch: Partial<Omit<NotificationPreference, 'ruleCode'>>) =>
    request<{ preferences: Record<NotificationRuleCode, NotificationPreference> }>(
      'PUT',
      `/settings/notification-preferences/${ruleCode}`,
      patch
    ),

  getLocale: () => request<{ locale: LocaleCode; timezone: string; baseCurrency: string }>('GET', '/settings/locale'),
  updateLocale: (patch: { locale?: LocaleCode; timezone?: string }) =>
    request<{ ok: true }>('PUT', '/settings/locale', patch),

  listCurrencies: () =>
    request<{ currencies: Array<{ code: string; name: string; symbol: string; minorUnit: number }> }>('GET', '/currencies'),

  searchTransactions: (filters: TransactionSearchFilters) => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    if (filters.type) params.set('type', filters.type);
    if (filters.status) params.set('status', filters.status);
    if (filters.amountMinMajor) params.set('amountMin', filters.amountMinMajor);
    if (filters.amountMaxMajor) params.set('amountMax', filters.amountMaxMajor);
    const qs = params.toString();
    return request<{ transactions: Transaction[] }>('GET', `/transactions/search${qs ? `?${qs}` : ''}`);
  },

  listBudgets: () => request<{ budgets: Budget[] }>('GET', '/budgets'),
  createBudget: (input: {
    categoryId?: string | null;
    name: string;
    amountMajor: string;
    currencyCode: string;
    periodType: RecurrenceFreq;
    periodStart: string;
    periodEnd: string;
    rollover?: boolean;
    alertPcts?: number[];
  }) => request<{ budget: Budget }>('POST', '/budgets', input),
  archiveBudget: (id: string) => request<void>('DELETE', `/budgets/${id}`),
  rolloverBudgetsNow: () => request<{ rolledOver: number }>('POST', '/budgets/rollover-now'),

  listRecurringRules: () => request<{ rules: RecurringRule[] }>('GET', '/recurring-rules'),
  createRecurringRule: (input: {
    template: RecurringTemplate;
    frequency: RecurrenceFreq;
    intervalCount?: number;
    startDate: string;
    endDate?: string | null;
    maxOccurrences?: number | null;
    autoCreate?: boolean;
  }) => request<{ rule: RecurringRule }>('POST', '/recurring-rules', input),
  setRecurringRuleActive: (id: string, isActive: boolean) =>
    request<{ rule: RecurringRule }>('PATCH', `/recurring-rules/${id}`, { isActive }),
  deleteRecurringRule: (id: string) => request<void>('DELETE', `/recurring-rules/${id}`),
  runRecurringRulesNow: () => request<{ created: number }>('POST', '/recurring-rules/run-now'),

  monthlyReport: (month: string) => request<{ summary: MonthlySummary }>('GET', `/reports/monthly?month=${month}`),
  trendReport: (months: number) => request<{ points: TrendPoint[] }>('GET', `/reports/trend?months=${months}`),
};
