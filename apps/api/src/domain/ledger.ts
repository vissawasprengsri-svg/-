import { add, negate, type MoneyMinor } from '@finance/shared';
import type { Transaction } from '@finance/shared';
import type { DbClient } from '../db/pool.js';
import type { RowSnapshot } from './commandStore.js';

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
 * Applies a list of ledger effects and returns the RowSnapshots needed to
 * record them as part of an undoable command. `sign` lets callers apply
 * the effects forward (creating/restoring a transaction) or in reverse
 * (deleting one, or reversing a claim reimbursement).
 */
export async function applyLedgerEffects(
  client: DbClient,
  effects: LedgerEffect[],
  sign: 1 | -1
): Promise<RowSnapshot[]> {
  const snapshots: RowSnapshot[] = [];
  for (const effect of effects) {
    const table = effect.kind === 'account' ? 'accounts' : 'debts';
    const delta = sign === 1 ? effect.delta : negate(effect.delta);
    const beforeRes = await client.query(`SELECT * FROM "${table}" WHERE id = $1 FOR UPDATE`, [effect.id]);
    const before = beforeRes.rows[0];
    if (!before) continue;
    const balanceField = 'current_balance';
    const newBalance = add(String(before[balanceField]), delta);
    const afterRes = await client.query(`UPDATE "${table}" SET ${balanceField} = $1 WHERE id = $2 RETURNING *`, [
      newBalance,
      effect.id,
    ]);
    snapshots.push({ table, id: effect.id, before, after: afterRes.rows[0] });
  }
  return snapshots;
}
