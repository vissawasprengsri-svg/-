import type {
  AccountWithCard,
  Budget,
  Category,
  ClaimBatch,
  ClaimsSummary,
  ClaimStatus,
  CreateTransactionInput,
  CreateUpcomingBillInput,
  Debt,
  LocaleCode,
  MonthlySummary,
  NotificationItem,
  NotificationPreference,
  NotificationRuleCode,
  RecurringRule,
  RecurringTemplate,
  RecurrenceFreq,
  Transaction,
  TransactionPage,
  TransactionSearchFilters,
  TransactionType,
  TrendPoint,
  UpcomingBill,
  UserSettings,
} from '@finance/shared';

// Empty by default: every request stays a relative `/api/...` path, which is
// what local dev (via vite.config.ts's proxy) and a same-origin deployment
// (frontend and API behind one reverse-proxied domain) both need. Set
// VITE_API_URL only for a split deployment — frontend and API on separate
// domains (e.g. Vercel + Render) — to the API's own origin, no trailing
// slash and no `/api` suffix (that part is still added below).
const API_BASE = import.meta.env.VITE_API_URL ?? '';

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

/**
 * Fired when the API rejects a request as signed-out (expired or cleared
 * session cookie). App.tsx listens and swaps in the login screen, so every
 * caller doesn't have to handle re-authentication itself.
 */
export const UNAUTHENTICATED_EVENT = 'finance:unauthenticated';

function handleUnauthenticated(): void {
  window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT));
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
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    // Send/receive the httpOnly session cookie. The token is never readable
    // from JS, so there's nothing here for an XSS payload to steal.
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) handleUnauthenticated();
    throw new ApiError(data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export interface SessionInfo {
  authenticated: boolean;
  needsSetup: boolean;
  user?: { id: string; email: string; displayName: string };
}

export const api = {
  getSession: () => request<SessionInfo>('GET', '/auth/session'),
  setupPassword: (password: string) => request<SessionInfo>('POST', '/auth/setup', { password }),
  login: (password: string, email?: string) => request<SessionInfo>('POST', '/auth/login', { password, email }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),

  listTransactions: (opts: { limit?: number; cursor?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.cursor) params.set('cursor', opts.cursor);
    const qs = params.toString();
    return request<TransactionPage>('GET', `/transactions${qs ? `?${qs}` : ''}`);
  },
  createTransaction: (input: CreateTransactionInput) =>
    request<{ transaction: Transaction; replay: boolean }>('POST', '/transactions', input),
  deleteTransaction: (id: string) => request<{ transaction: Transaction }>('DELETE', `/transactions/${id}`),
  setClaimStatus: (id: string, status: ClaimStatus) =>
    request<{ transaction: Transaction }>('POST', `/transactions/${id}/claim-status`, { status }),
  convertToClaim: (id: string) => request<{ transaction: Transaction }>('POST', `/transactions/${id}/convert-to-claim`),
  convertToLoan: (id: string) => request<{ transaction: Transaction }>('POST', `/transactions/${id}/convert-to-loan`),
  splitTransaction: (id: string, parts: { amountMajor: string; description?: string; note?: string }[]) =>
    request<{ transactions: Transaction[] }>('POST', `/transactions/${id}/split`, { parts }),
  descriptionSuggestions: (type?: TransactionType) =>
    request<{ descriptions: string[] }>('GET', `/transactions/description-suggestions${type ? `?type=${type}` : ''}`),
  listTrash: () => request<{ transactions: Transaction[] }>('GET', '/trash'),
  restoreFromTrash: (id: string) => request<{ transaction: Transaction }>('POST', `/trash/${id}/restore`),
  purgeFromTrash: (id: string) => request<{ ok: true }>('DELETE', `/trash/${id}`),
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
    if (filters.excludeReceived) params.set('excludeReceived', 'true');
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters.cursor) params.set('cursor', filters.cursor);
    const qs = params.toString();
    return request<TransactionPage>('GET', `/transactions/search${qs ? `?${qs}` : ''}`);
  },
  /**
   * Loops `searchTransactions` until `nextCursor` is null, for the handful of
   * call sites (category counts/grouping) that genuinely need every matching
   * row rather than one page of them — see CategorizePage. Bounded pages
   * server-side either way; this just hides the looping from the caller.
   */
  searchAllTransactions: async (filters: TransactionSearchFilters): Promise<Transaction[]> => {
    const all: Transaction[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await api.searchTransactions({ ...filters, cursor, limit: 200 });
      all.push(...page.transactions);
      if (!page.nextCursor) return all;
      cursor = page.nextCursor;
    }
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
    notifyLeadDays?: number;
  }) => request<{ rule: RecurringRule }>('POST', '/recurring-rules', input),
  updateRecurringRule: (
    id: string,
    input: {
      template?: Partial<RecurringTemplate>;
      frequency?: RecurrenceFreq;
      intervalCount?: number;
      startDate?: string;
      endDate?: string | null;
      maxOccurrences?: number | null;
      autoCreate?: boolean;
      notifyLeadDays?: number;
    }
  ) => request<{ rule: RecurringRule }>('PUT', `/recurring-rules/${id}`, input),
  setRecurringRuleActive: (id: string, isActive: boolean) =>
    request<{ rule: RecurringRule }>('PATCH', `/recurring-rules/${id}`, { isActive }),
  deleteRecurringRule: (id: string) => request<void>('DELETE', `/recurring-rules/${id}`),
  runRecurringRulesNow: () => request<{ created: number }>('POST', '/recurring-rules/run-now'),
  payRecurringRuleNow: (id: string) => request<{ rule: RecurringRule }>('POST', `/recurring-rules/${id}/pay-now`),

  monthlyReport: (month: string) => request<{ summary: MonthlySummary }>('GET', `/reports/monthly?month=${month}`),
  trendReport: (months: number) => request<{ points: TrendPoint[] }>('GET', `/reports/trend?months=${months}`),

  exportTransactions: async (): Promise<Blob> => {
    const res = await fetch('/api/transactions/export', {
      headers: { 'x-session-id': getSessionId() },
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? `Request failed (${res.status})`);
    }
    return res.blob();
  },
  importTransactions: (fileBase64: string) =>
    request<{ created: number; errors: Array<{ row: number; message: string }> }>('POST', '/transactions/import', { fileBase64 }),

  listUnsortedExpenses: (type?: TransactionType, excludeReceived?: boolean) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (excludeReceived) params.set('excludeReceived', 'true');
    const qs = params.toString();
    return request<{ transactions: Transaction[] }>('GET', `/transactions/unsorted${qs ? `?${qs}` : ''}`);
  },
  setTransactionCategory: (id: string, categoryId: string | null) =>
    request<{ transaction: Transaction }>('PATCH', `/transactions/${id}/category`, { categoryId }),
  updateTransactionDetails: (
    id: string,
    patch: { amountMajor?: string; description?: string; note?: string; transactionDate?: string; occurredAt?: string | null }
  ) => request<{ transaction: Transaction }>('PATCH', `/transactions/${id}/details`, patch),
  updateTransactionAccount: (id: string, accountId: string | null) =>
    request<{ transaction: Transaction }>('PATCH', `/transactions/${id}/account`, { accountId }),
  setClaimReceived: (id: string, received: boolean) =>
    request<{ transaction: Transaction }>('POST', `/transactions/${id}/claim-received`, { received }),

  getClaimsSummary: () => request<{ summary: ClaimsSummary }>('GET', '/claims-summary'),

  listClaimBatches: () => request<{ batches: ClaimBatch[] }>('GET', '/claim-batches'),
  createClaimBatch: (transactionIds: string[], title?: string) =>
    request<{ batch: ClaimBatch }>('POST', '/claim-batches', { transactionIds, title }),
  deleteClaimBatch: (id: string) => request<{ ok: true }>('DELETE', `/claim-batches/${id}`),

  listAccounts: () => request<{ accounts: AccountWithCard[] }>('GET', '/accounts'),
  createAccount: (input: {
    name: string;
    kind: AccountWithCard['kind'];
    currencyCode: string;
    openingBalanceMajor?: string;
    creditLimitMajor?: string;
    dueDay?: number | null;
    statementDay?: number | null;
    last4?: string | null;
    network?: AccountWithCard['network'];
  }) => request<{ account: AccountWithCard }>('POST', '/accounts', input),
  archiveAccount: (id: string) => request<void>('DELETE', `/accounts/${id}`),
  updateCreditLimit: (id: string, creditLimitMajor: string) =>
    request<{ ok: true }>('PATCH', `/accounts/${id}/credit-limit`, { creditLimitMajor }),
  updateAccountBalance: (id: string, balanceMajor: string) =>
    request<{ ok: true }>('PATCH', `/accounts/${id}/balance`, { balanceMajor }),
  updateAccountCardDetails: (
    id: string,
    input: { last4?: string | null; network?: AccountWithCard['network'] | null; color?: string | null }
  ) => request<{ ok: true }>('PATCH', `/accounts/${id}/card-details`, input),
  reorderAccounts: (orderedIds: string[]) => request<{ ok: true }>('PATCH', '/accounts/reorder', { orderedIds }),

  listDebts: () => request<{ debts: Debt[] }>('GET', '/debts'),
  createDebt: (input: { name: string; currencyCode: string; balanceMajor: string; isReceivable?: boolean }) =>
    request<{ debt: Debt }>('POST', '/debts', input),
  updateDebtBalance: (id: string, balanceMajor: string) => request<{ debt: Debt }>('PATCH', `/debts/${id}/balance`, { balanceMajor }),
  archiveDebt: (id: string) => request<void>('DELETE', `/debts/${id}`),

  listCategories: (appliesTo?: TransactionType) =>
    request<{ categories: Category[] }>('GET', `/categories${appliesTo ? `?appliesTo=${appliesTo}` : ''}`),
  createCategory: (input: { name: string; appliesTo: TransactionType[]; statusLabel?: string | null }) =>
    request<{ category: Category }>('POST', '/categories', input),
  renameCategory: (id: string, name: string) => request<{ category: Category }>('PATCH', `/categories/${id}`, { name }),
  reorderCategories: (orderedIds: string[]) => request<{ ok: true }>('PATCH', '/categories/reorder', { orderedIds }),
  updateCategoryStatusLabel: (id: string, statusLabel: string | null) =>
    request<{ category: Category }>('PATCH', `/categories/${id}/status-label`, { statusLabel }),
  deleteCategory: (id: string) => request<void>('DELETE', `/categories/${id}`),
  receiveCategoryClaims: (categoryId: string, targetAccountId: string) =>
    request<{ ok: true }>('POST', `/categories/${categoryId}/receive-claims`, { targetAccountId }),

  listUpcomingBills: () => request<{ bills: UpcomingBill[] }>('GET', '/upcoming-bills'),
  createUpcomingBill: (input: CreateUpcomingBillInput) => request<{ bill: UpcomingBill }>('POST', '/upcoming-bills', input),
  updateUpcomingBill: (id: string, patch: { title?: string; amountMajor?: string; dueDate?: string; note?: string | null }) =>
    request<{ bill: UpcomingBill }>('PATCH', `/upcoming-bills/${id}`, patch),
  payUpcomingBill: (id: string, accountId: string) =>
    request<{ bill: UpcomingBill }>('POST', `/upcoming-bills/${id}/pay`, { accountId }),
  deleteUpcomingBill: (id: string) => request<void>('DELETE', `/upcoming-bills/${id}`),
};
