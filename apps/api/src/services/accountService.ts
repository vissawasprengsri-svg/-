import { fromMajorInput, type AccountWithCard } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import { Errors } from '../domain/errors.js';

async function getCurrencyMinorUnit(client: DbClient, code: string): Promise<number> {
  const res = await client.query<{ minor_unit: number }>('SELECT minor_unit FROM currencies WHERE code = $1', [code]);
  return res.rows[0]?.minor_unit ?? 2;
}

function mapRow(row: Record<string, unknown>): AccountWithCard {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    kind: row.kind as AccountWithCard['kind'],
    currencyCode: row.currency_code as string,
    openingBalance: String(row.opening_balance),
    currentBalance: String(row.current_balance),
    icon: (row.icon as string | null) ?? null,
    color: (row.color as string | null) ?? null,
    isArchived: Boolean(row.is_archived),
    sortOrder: Number(row.sort_order),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at as string).toISOString() : null,
    creditLimit: row.credit_limit === null || row.credit_limit === undefined ? null : String(row.credit_limit),
    dueDay: row.due_day === null || row.due_day === undefined ? null : Number(row.due_day),
    statementDay: row.statement_day === null || row.statement_day === undefined ? null : Number(row.statement_day),
  };
}

export async function listAccounts(client: DbClient, userId: string): Promise<AccountWithCard[]> {
  const res = await client.query(
    `SELECT a.*, cc.credit_limit, cc.due_day, cc.statement_day
     FROM accounts a
     LEFT JOIN credit_cards cc ON cc.account_id = a.id
     WHERE a.user_id = $1 AND a.deleted_at IS NULL
     ORDER BY a.is_archived, a.sort_order, a.created_at`,
    [userId]
  );
  return res.rows.map(mapRow);
}

export interface CreateAccountInput {
  name: string;
  kind: AccountWithCard['kind'];
  currencyCode: string;
  openingBalanceMajor?: string;
  creditLimitMajor?: string;
  dueDay?: number | null;
  statementDay?: number | null;
}

export async function createAccount(client: DbClient, userId: string, input: CreateAccountInput): Promise<AccountWithCard> {
  const minorUnit = await getCurrencyMinorUnit(client, input.currencyCode);
  const openingMinor = input.openingBalanceMajor ? fromMajorInput(input.openingBalanceMajor, minorUnit) : '0';
  const res = await client.query(
    `INSERT INTO accounts (user_id, name, kind, currency_code, opening_balance, current_balance)
     VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
    [userId, input.name, input.kind, input.currencyCode, openingMinor]
  );
  const accountId = res.rows[0].id;

  if (input.kind === 'credit_card') {
    const limitMinor = input.creditLimitMajor ? fromMajorInput(input.creditLimitMajor, minorUnit) : '0';
    await client.query(
      'INSERT INTO credit_cards (account_id, credit_limit, due_day, statement_day) VALUES ($1,$2,$3,$4)',
      [accountId, limitMinor, input.dueDay ?? null, input.statementDay ?? null]
    );
  }

  const list = await listAccounts(client, userId);
  const created = list.find((a) => a.id === accountId);
  if (!created) throw Errors.notFound('account');
  return created;
}

export async function archiveAccount(client: DbClient, userId: string, id: string): Promise<void> {
  const res = await client.query(
    'UPDATE accounts SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, userId]
  );
  if (res.rowCount === 0) throw Errors.notFound('account');
}

export async function updateCreditLimit(client: DbClient, userId: string, accountId: string, limitMajor: string): Promise<void> {
  const accountRes = await client.query<{ currency_code: string }>(
    'SELECT currency_code FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND kind = $3',
    [accountId, userId, 'credit_card']
  );
  if (accountRes.rows.length === 0) throw Errors.notFound('credit card account');
  const minorUnit = await getCurrencyMinorUnit(client, accountRes.rows[0]!.currency_code);
  const limitMinor = fromMajorInput(limitMajor, minorUnit);
  await client.query('UPDATE credit_cards SET credit_limit = $1 WHERE account_id = $2', [limitMinor, accountId]);
}

/**
 * Directly overwrites a non-card account's running balance (e.g. entering
 * a starting cash balance after the fact, or correcting drift). Mirrors
 * `debtService.updateBalance` — a plain overwrite rather than an inserted
 * transaction, since there's no ledger-affecting event to record here.
 */
export async function updateAccountBalance(client: DbClient, userId: string, accountId: string, balanceMajor: string): Promise<void> {
  const accountRes = await client.query<{ currency_code: string; kind: string }>(
    'SELECT currency_code, kind FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [accountId, userId]
  );
  if (accountRes.rows.length === 0) throw Errors.notFound('account');
  if (accountRes.rows[0]!.kind === 'credit_card') throw Errors.validation('use the credit limit field for credit card accounts');
  const minorUnit = await getCurrencyMinorUnit(client, accountRes.rows[0]!.currency_code);
  const balanceMinor = fromMajorInput(balanceMajor, minorUnit);
  await client.query('UPDATE accounts SET current_balance = $1 WHERE id = $2', [balanceMinor, accountId]);
}

/**
 * Persists a manual display order for a set of accounts (e.g. the cash/bank
 * list and the credit-card list are reordered independently). Cross-group
 * ordering doesn't matter: `listAccounts` sorts everything by `sort_order`
 * once, and the UI splits the result by kind afterwards, so two accounts of
 * different kinds sharing a sort_order value never causes a visible tie.
 */
export async function reorderAccounts(client: DbClient, userId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await client.query('UPDATE accounts SET sort_order = $1 WHERE id = $2 AND user_id = $3', [i, orderedIds[i], userId]);
  }
}
