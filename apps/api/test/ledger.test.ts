import { describe, expect, it } from 'vitest';
import { computeLedgerEffects } from '../src/domain/ledger.js';

const ACCOUNT = 'acc-1';
const TO_ACCOUNT = 'acc-2';
const DEBT = 'debt-1';

describe('computeLedgerEffects (pure money-impact calculation, per transaction type)', () => {
  it('income credits the account', () => {
    const effects = computeLedgerEffects({
      type: 'income',
      amount: '10000',
      accountId: ACCOUNT,
      toAccountId: null,
      debtId: null,
      direction: null,
    });
    expect(effects).toEqual([{ kind: 'account', id: ACCOUNT, delta: '10000' }]);
  });

  it('personal_expense debits the account', () => {
    const effects = computeLedgerEffects({
      type: 'personal_expense',
      amount: '5000',
      accountId: ACCOUNT,
      toAccountId: null,
      debtId: null,
      direction: null,
    });
    expect(effects).toEqual([{ kind: 'account', id: ACCOUNT, delta: '-5000' }]);
  });

  it('personal_expense with no account produces no ledger effect (e.g. unsorted cash tracked elsewhere)', () => {
    const effects = computeLedgerEffects({
      type: 'personal_expense',
      amount: '5000',
      accountId: null,
      toAccountId: null,
      debtId: null,
      direction: null,
    });
    expect(effects).toEqual([]);
  });

  it('pending_claim debits the paying account up front (reimbursed later on claim-status update)', () => {
    const effects = computeLedgerEffects({
      type: 'pending_claim',
      amount: '2500',
      accountId: ACCOUNT,
      toAccountId: null,
      debtId: null,
      direction: null,
    });
    expect(effects).toEqual([{ kind: 'account', id: ACCOUNT, delta: '-2500' }]);
  });

  it('loan_given debits the lending account', () => {
    const effects = computeLedgerEffects({
      type: 'loan_given',
      amount: '3000',
      accountId: ACCOUNT,
      toAccountId: null,
      debtId: null,
      direction: null,
    });
    expect(effects).toEqual([{ kind: 'account', id: ACCOUNT, delta: '-3000' }]);
  });

  it('investment buy debits, sell and dividend credit, fee debits', () => {
    const base = { amount: '1000', accountId: ACCOUNT, toAccountId: null, debtId: null } as const;
    expect(computeLedgerEffects({ type: 'investment', ...base, direction: 'buy' })).toEqual([
      { kind: 'account', id: ACCOUNT, delta: '-1000' },
    ]);
    expect(computeLedgerEffects({ type: 'investment', ...base, direction: 'sell' })).toEqual([
      { kind: 'account', id: ACCOUNT, delta: '1000' },
    ]);
    expect(computeLedgerEffects({ type: 'investment', ...base, direction: 'dividend' })).toEqual([
      { kind: 'account', id: ACCOUNT, delta: '1000' },
    ]);
    expect(computeLedgerEffects({ type: 'investment', ...base, direction: 'fee' })).toEqual([
      { kind: 'account', id: ACCOUNT, delta: '-1000' },
    ]);
  });

  it('debt_payment debits the paying account and reduces the debt balance', () => {
    const effects = computeLedgerEffects({
      type: 'debt_payment',
      amount: '4000',
      accountId: ACCOUNT,
      toAccountId: null,
      debtId: DEBT,
      direction: null,
    });
    expect(effects).toEqual([
      { kind: 'account', id: ACCOUNT, delta: '-4000' },
      { kind: 'debt', id: DEBT, delta: '-4000' },
    ]);
  });

  it('debt_payment without a linked account only reduces the debt', () => {
    const effects = computeLedgerEffects({
      type: 'debt_payment',
      amount: '4000',
      accountId: null,
      toAccountId: null,
      debtId: DEBT,
      direction: null,
    });
    expect(effects).toEqual([{ kind: 'debt', id: DEBT, delta: '-4000' }]);
  });

  it('transfer debits the source account and credits the destination for the exact same amount', () => {
    const effects = computeLedgerEffects({
      type: 'transfer',
      amount: '7500',
      accountId: ACCOUNT,
      toAccountId: TO_ACCOUNT,
      debtId: null,
      direction: null,
    });
    expect(effects).toEqual([
      { kind: 'account', id: ACCOUNT, delta: '-7500' },
      { kind: 'account', id: TO_ACCOUNT, delta: '7500' },
    ]);
    // Zero-sum: the transfer must never create or destroy money.
    const net = effects.reduce((s, e) => s + BigInt(e.delta), 0n);
    expect(net).toBe(0n);
  });
});
