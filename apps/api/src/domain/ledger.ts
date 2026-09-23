import { negate, type MoneyMinor } from '@finance/shared';
import type { Transaction } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import type { DeltaSnapshot } from './commandStore.js';
import { Errors } from './errors.js';

interface LedgerEffect {
  kind: 'account' | 'debt';
  id: string;
  delta: MoneyMinor; // signed, in the target row's own currency minor units
}

/**
 * Every account/debt uses one consistent sign convention: positive delta
 * means the balance figure goes up (cash in, or debt principal growing),
 * negative means it goes down. For a credit-card-kind account this makes
 * a purchase push current_balance negative — i.e. "amount owed" is
 * `ABS(current_balance)`, which is exactly what `v_account_balances`
 * (see schema.sql) already assumes for its available-credit calculation.
 */
export function computeLedgerEffects(tx: Pick<Transaction, 'type' | 'amount' | 'accountId' | 'toAccountId' | 'debtId' | 'direction'>): LedgerEffect[] {
  const effects: LedgerEffect[] = [];
  switch (tx.type) {
    case 'income':
      if (tx.accountId) effects.push({ kind: 'account', id: tx.accountId, delta: tx.amount });
      break;
    case 'personal_expense':
    case 'pending_claim':
    case 'loan_given':
      if (tx.accountId) effects.push({ kind: 'account', id: tx.accountId, delta: negate(tx.amount) });
      break;
    case 'investment':
      if (tx.accountId) {
        const inflow = tx.direction === 'sell' || tx.direction === 'dividend';
        effects.push({ kind: 'account', id: tx.accountId, delta: inflow ? tx.amount : negate(tx.amount) });
      }
      break;
    case 'debt_payment':
      if (tx.accountId) effects.push({ kind: 'account', id: tx.accountId, delta: negate(tx.amount) });
      if (tx.debtId) effects.push({ kind: 'debt', id: tx.debtId, delta: negate(tx.amount) });
      break;
    case 'transfer':
      if (tx.accountId) effects.push({ kind: 'account', id: tx.accountId, delta: negate(tx.amount) });
      if (tx.toAccountId) effects.push({ kind: 'account', id: tx.toAccountId, delta: tx.amount });
      break;
  }
  return effects;
}

/**
 * Applies a list of ledger effects and returns the DeltaSnapshots needed to
 * record them as part of an undoable command. `sign` lets callers apply
 * the effects forward (creating/restoring a transaction) or in reverse
 * (deleting one, or reversing a claim reimbursement).
 *
 * Balances are moved with a single `balance = balance + delta` statement
 * rather than read-then-write: the addition happens inside the row lock
 * Postgres takes for the UPDATE, and the recorded snapshot is the delta
 * itself, so undo/redo re-applies it against whatever the balance has
 * become instead of overwriting it with a stale absolute figure (see
 * DeltaSnapshot in commandStore.ts).
 */
export async function applyLedgerEffects(
  client: DbClient,
  effects: LedgerEffect[],
  sign: 1 | -1
): Promise<DeltaSnapshot[]> {
  const snapshots: DeltaSnapshot[] = [];
  for (const effect of effects) {
    const table = effect.kind === 'account' ? 'accounts' : 'debts';
    const delta = sign === 1 ? effect.delta : negate(effect.delta);
    const res = await client.query(
      `UPDATE "${table}" SET current_balance = current_balance + $1::bigint WHERE id = $2`,
      [delta, effect.id]
    );
    if (res.rowCount === 0) {
      // Defence in depth, and deliberately not a silent `continue`: skipping
      // would book the transaction while leaving the balance short by exactly
      // its amount, with nothing recorded to trace the gap back to later.
      //
      // Nothing should reach this today — every id that gets here arrives on a
      // column with a foreign key (account_id, to_account_id, debt_id,
      // claim_received_account_id), and accounts/debts are only soft-deleted,
      // so the row is still physically there and the UPDATE above matches it on
      // id alone by design. It exists so that a future path without that
      // protection fails loudly instead of quietly mis-stating a balance.
      throw Errors.validation(`Cannot move balance: ${effect.kind} ${effect.id} does not exist`);
    }
    snapshots.push({ kind: 'delta', table, id: effect.id, column: 'current_balance', delta });
  }
  return snapshots;
}
