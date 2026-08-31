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
  isArchived: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
  icon: string | null;
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
  categoryId?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  debtId?: string | null;
  status?: ClaimStatus | null;
  buyer?: string | null;
  direction?: InvestmentDirection | null;
  clientId: string; // client-generated UUID, used for idempotent dedupe
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

export interface TransactionSearchFilters {
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  categoryId?: string;
  type?: TransactionType;
  status?: ClaimStatus;
  amountMinMajor?: string;
  amountMaxMajor?: string;
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
