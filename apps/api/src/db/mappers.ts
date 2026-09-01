import type { Transaction } from '@finance/shared';

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Maps a raw snake_case Postgres row from `transactions` to the wire shape. */
export function mapTransactionRow(row: Record<string, unknown>): Transaction {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as Transaction['type'],
    amount: String(row.amount),
    currencyCode: row.currency_code as string,
    exchangeRate: String(row.exchange_rate),
    baseAmount: String(row.base_amount),
    baseCurrencyCode: row.base_currency_code as string,
    description: (row.description as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    merchant: (row.merchant as string | null) ?? null,
    transactionDate: iso(row.transaction_date)!.slice(0, 10),
    occurredAt: iso(row.occurred_at),
    categoryId: (row.category_id as string | null) ?? null,
    categoryName: (row.category_name as string | null) ?? null,
    categoryIsClaimable: Boolean(row.category_is_claimable),
    accountId: (row.account_id as string | null) ?? null,
    toAccountId: (row.to_account_id as string | null) ?? null,
    debtId: (row.debt_id as string | null) ?? null,
    recurringRuleId: (row.recurring_rule_id as string | null) ?? null,
    claimBatchId: (row.claim_batch_id as string | null) ?? null,
    status: (row.status as Transaction['status']) ?? null,
    buyer: (row.buyer as string | null) ?? null,
    claimReceived: Boolean(row.claim_received),
    claimDueDate: iso(row.claim_due_date),
    claimedAt: iso(row.claimed_at),
    receivedAt: iso(row.received_at),
    direction: (row.direction as Transaction['direction']) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    version: Number(row.version),
    createdAt: iso(row.created_at)!,
    createdBy: (row.created_by as string | null) ?? null,
    updatedAt: iso(row.updated_at)!,
    deletedAt: iso(row.deleted_at),
    deletedBy: (row.deleted_by as string | null) ?? null,
  };
}
