import type { MoneyMinor } from './money.js';

export type TransactionType =
  | 'income'
  | 'personal_expense'
  | 'pending_claim'
  | 'investment'
  | 'debt_payment'
  | 'loan_given'
  | 'transfer';

export type ClaimStatus = 'awaiting_bill' | 'pending' | 'claimed' | 'received' | 'rejected' | 'cancelled';

/** Phase 3 starts with th + en; each entry also carries text direction so RTL locales slot in later without a rewrite. */
export const SUPPORTED_LOCALES = [
  { code: 'th-TH', dir: 'ltr' },
  { code: 'en-US', dir: 'ltr' },
] as const;
export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]['code'];

export type AccountKind = 'cash' | 'bank' | 'ewallet' | 'credit_card';

/** Purely cosmetic — which network badge to draw on the account's dashboard card. */
export type AccountNetwork = 'visa' | 'mastercard' | 'jcb' | 'amex' | 'unionpay' | 'truemoney' | 'other';

export type InvestmentDirection = 'buy' | 'sell' | 'dividend' | 'fee';

export type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'status_change';

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  minorUnit: number;
  isActive: boolean;
}

export interface Account {
  id: string;
  userId: string;
  name: string;
  kind: AccountKind;
  currencyCode: string;
  openingBalance: MoneyMinor;
  currentBalance: MoneyMinor;
  icon: string | null;
  color: string | null;
  /** Last 4 digits shown on the dashboard's card visual — display only, never the full number. */
  last4: string | null;
  network: AccountNetwork | null;
  isArchived: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Account + its credit_cards row (when kind='credit_card'), as returned by GET /api/accounts. */
export interface AccountWithCard extends Account {
  creditLimit: MoneyMinor | null;
  dueDay: number | null;
  statementDay: number | null;
}

export interface Debt {
  id: string;
  userId: string;
  name: string;
  currencyCode: string;
  principalAmount: MoneyMinor;
  currentBalance: MoneyMinor;
  counterparty: string | null;
  isReceivable: boolean;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Category {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  appliesTo: TransactionType[];
  defaultClaimStatus: ClaimStatus | null;
  isClaimable: boolean;
  /** Free-text override for the status pill shown wherever this category's claim status appears, e.g. "รอรวมยอด". Falls back to defaultClaimStatus's fixed label when unset. */
  statusLabel: string | null;
  color: string | null;
  sortOrder: number;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;

  amount: MoneyMinor;
  currencyCode: string;
  exchangeRate: string;
  baseAmount: MoneyMinor;
  baseCurrencyCode: string;

  description: string | null;
  note: string | null;
  merchant: string | null;
  transactionDate: string;
  occurredAt: string | null;

  categoryId: string | null;
  /** Denormalized, joined at read-time for display — not a stored column. */
  categoryName: string | null;
  categoryIsClaimable: boolean;
  accountId: string | null;
  toAccountId: string | null;
  debtId: string | null;
  recurringRuleId: string | null;
  claimBatchId: string | null;

  status: ClaimStatus | null;
  buyer: string | null;
  claimReceived: boolean;
  claimDueDate: string | null;
  claimedAt: string | null;
  receivedAt: string | null;
  claimReceivedAccountId: string | null;
  /** Denormalized, joined at read-time for display — not a stored column. */
  claimReceivedAccountName: string | null;

  direction: InvestmentDirection | null;

  idempotencyKey: string | null;
  clientId: string | null;
  version: number;

  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: AuditAction;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  diffJson: Record<string, unknown> | null;
  actorId: string | null;
  createdAt: string;
}

/** Input payload for creating a transaction via the API. */
export interface CreateTransactionInput {
  type: TransactionType;
  amountMajor: string; // decimal string in major units, e.g. "150.50"
  currencyCode: string;
  description?: string;
  note?: string;
  merchant?: string;
  transactionDate: string; // YYYY-MM-DD
  occurredAt?: string | null; // full ISO instant, for recording time-of-day
  categoryId?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  debtId?: string | null;
  status?: ClaimStatus | null;
  buyer?: string | null;
  direction?: InvestmentDirection | null;
  clientId: string; // client-generated UUID, used for idempotent dedupe
}

export interface UpcomingBill {
  id: string;
  userId: string;
  title: string;
  amount: MoneyMinor;
  currencyCode: string;
  dueDate: string; // YYYY-MM-DD
  note: string | null;
  isPaid: boolean;
  paidAt: string | null;
  transactionId: string | null;
  createdAt: string;
  deletedAt: string | null;
}

/** Input payload for jotting down a new upcoming bill. */
export interface CreateUpcomingBillInput {
  title: string;
  amountMajor: string; // decimal string in major units, e.g. "150.50"
  currencyCode?: string;
  dueDate: string; // YYYY-MM-DD
  note?: string | null;
}

export interface ClaimGroup {
  categoryId: string | null;
  categoryName: string;
  defaultClaimStatus: ClaimStatus | null;
  statusLabel: string | null;
  total: MoneyMinor;
  items: Transaction[];
}

export interface ClaimsSummary {
  totalOutstanding: MoneyMinor;
  folderGroups: ClaimGroup[]; // personal_expense filed under a claimable category
  claimGroups: ClaimGroup[]; // full pending_claim records
  loanGroups: ClaimGroup[]; // loan_given not yet repaid, grouped by category like the others
  completedGroups: ClaimGroup[]; // personal_expense/loan_given already received, most recent first
}

export interface Budget {
  id: string;
  userId: string;
  categoryId: string | null;
  name: string;
  amount: MoneyMinor;
  currencyCode: string;
  periodType: RecurrenceFreq;
  periodStart: string;
  periodEnd: string;
  rollover: boolean;
  alertPcts: number[];
  isActive: boolean;
  createdAt: string;
  deletedAt: string | null;
  /** Computed, not stored: sum of matching personal_expense transactions in the period. */
  spent: MoneyMinor;
}

export type RecurrenceFreq = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringTemplate {
  type: TransactionType;
  amountMajor: string;
  currencyCode: string;
  description?: string;
  note?: string;
  categoryId?: string | null;
  accountId?: string | null;
}

export interface RecurringRule {
  id: string;
  userId: string;
  template: RecurringTemplate;
  frequency: RecurrenceFreq;
  intervalCount: number;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  startDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
  occurrencesCount: number;
  nextRunDate: string | null;
  lastRunAt: string | null;
  autoCreate: boolean;
  notifyLeadDays: number;
  isActive: boolean;
  createdAt: string;
  deletedAt: string | null;
}

export interface CategoryBreakdownItem {
  categoryId: string | null;
  categoryName: string;
  total: MoneyMinor;
}

export interface MonthlySummary {
  month: string; // YYYY-MM
  income: MoneyMinor;
  expense: MoneyMinor;
  netCashFlow: MoneyMinor;
  byCategory: CategoryBreakdownItem[];
}

export interface TrendPoint {
  month: string;
  income: MoneyMinor;
  expense: MoneyMinor;
}

/**
 * A set of pending_claim transactions submitted for reimbursement together.
 *
 * `status` is the stored `claim_status` enum, reused here: 'claimed' means the
 * batch has been handed in, 'received' that it was paid back in full. Partial
 * payment has no enum value of its own, so `settlement` is derived at read time
 * from how many of the batch's own items have been marked received — that can't
 * drift out of sync with the items the way a stored flag would.
 */
export interface ClaimBatch {
  id: string;
  referenceNo: string | null;
  title: string;
  status: ClaimStatus;
  settlement: 'submitted' | 'partially_paid' | 'paid';
  totalAmount: MoneyMinor;
  receivedAmount: MoneyMinor;
  currencyCode: string;
  itemCount: number;
  receivedCount: number;
  submittedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  items: Transaction[];
}

export interface TransactionSearchFilters {
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  categoryId?: string;
  type?: TransactionType;
  status?: ClaimStatus;
  /** Hides rows already reimbursed (claim_received = true, or pending_claim status = 'received') —
   * for the "active work" views (CategorizePage) where a received item is done and archived, not
   * for historical/reporting views that need the full picture regardless of receive status. */
  excludeReceived?: boolean;
  amountMinMajor?: string;
  amountMaxMajor?: string;
  /** Page size; server clamps to a sane max. Omit for the server's default. */
  limit?: number;
  /** Opaque value from a previous page's `nextCursor` — fetches the page after it. */
  cursor?: string;
}

/** Keyset-paginated transaction list: `nextCursor` is null once there's nothing more to fetch. */
export interface TransactionPage {
  transactions: Transaction[];
  nextCursor: string | null;
}

export const CLAIM_STATUS_ORDER: ClaimStatus[] = ['awaiting_bill', 'pending', 'claimed', 'received'];

export type NotifSeverity = 'info' | 'warning' | 'critical';

export const NOTIFICATION_RULE_CODES = [
  'CLAIM_OVERDUE',
  'CREDIT_CARD_DUE_SOON',
  'BUDGET_THRESHOLD',
  'CREDIT_CARD_NEAR_LIMIT',
  'LOAN_OVERDUE',
  'DAILY_LOG_REMINDER',
  'RECURRING_DUE_SOON',
  'BILL_DUE_SOON',
] as const;
export type NotificationRuleCode = (typeof NOTIFICATION_RULE_CODES)[number];

export interface NotificationItem {
  id: string;
  userId: string;
  ruleCode: NotificationRuleCode | null;
  severity: NotifSeverity;
  title: string;
  body: string;
  deepLink: string | null;
  entityType: string | null;
  entityId: string | null;
  scheduledAt: string;
  sentAt: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  ruleCode: NotificationRuleCode;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
  leadDays: number[];
}

export interface UserSettings {
  claimOverdueDays: number;
  cardUsageAlertPct: number;
  budgetAlertPcts: number[];
  dailyReminderTime: string | null; // "HH:MM"
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

export interface UserLocaleSettings {
  locale: LocaleCode;
  timezone: string;
  baseCurrency: string;
}
