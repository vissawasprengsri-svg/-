import { useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, CreditCard, HandCoins, Landmark, TrendingUp, RefreshCw, Plus, X } from 'lucide-react';
import type { TransactionType } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useCategories';
import { useDebts } from '../hooks/useDebts';
import { PaymentPicker } from '../components/PaymentPicker';
import { todayStr } from '../utils/date';

const TYPES: TransactionType[] = ['income', 'personal_expense', 'pending_claim', 'investment', 'debt_payment', 'loan_given', 'transfer'];
const TYPE_ICON: Record<TransactionType, React.ReactNode> = {
  income: <ArrowUpCircle size={18} />,
  personal_expense: <ArrowDownCircle size={18} />,
  pending_claim: <Landmark size={18} />,
  investment: <TrendingUp size={18} />,
  debt_payment: <CreditCard size={18} />,
  loan_given: <HandCoins size={18} />,
  transfer: <RefreshCw size={18} />,
};

interface DraftRow {
  key: string;
  amount: string;
  description: string;
  note: string;
  date: string;
  time: string;
  accountId: string | null;
  toAccountId: string | null;
  buyer: 'self' | 'staff';
  awaitingBill: boolean;
  categoryId: string | null;
  direction: 'buy' | 'sell';
  debtId: string | null;
}

function blankRow(date: string): DraftRow {
  return {
    key: crypto.randomUUID(),
    amount: '',
    description: '',
    note: '',
    date,
    time: '',
    accountId: null,
    toAccountId: null,
    buyer: 'self',
    awaitingBill: false,
    categoryId: null,
    direction: 'buy',
    debtId: null,
  };
}

interface Props {
  presetType: TransactionType;
  onDone: () => void;
  onError: (message: string) => void;
}

export function AddTransactionPage({ presetType, onDone, onError }: Props) {
  const { t, baseCurrency } = useI18n();
  const { accounts, refresh: refreshAccounts } = useAccounts(onError);
  const { categories: claimCategories } = useCategories('pending_claim', onError);
  const { categories: loanCategories } = useCategories('loan_given', onError);
  const { debts } = useDebts(onError);

  const [type, setType] = useState<TransactionType>(presetType);
  const [rows, setRows] = useState<DraftRow[]>([blankRow(todayStr())]);
  const [descriptionSuggestions, setDescriptionSuggestions] = useState<string[]>([]);

  useEffect(() => resetForm(presetType), [presetType]);

  // Suggestions are scoped to the active type — "แท็กซี่" among expenses isn't
  // relevant when the tab is switched to income, so they're refetched on type change.
  useEffect(() => {
    let cancelled = false;
    api
      .descriptionSuggestions(type)
      .then((res) => {
        if (!cancelled) setDescriptionSuggestions(res.descriptions);
      })
      .catch(() => {
        // Suggestions are a convenience, not core functionality — a failed fetch
        // just means an empty datalist, not an error worth interrupting the form for.
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  function resetForm(nextType: TransactionType) {
    setType(nextType);
    setRows([blankRow(todayStr())]);
  }

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((rs) => [...rs, blankRow(rs[rs.length - 1]?.date ?? todayStr())]);
  }

  function removeRow(key: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  }

  function validateRow(row: DraftRow): string | null {
    const amt = Number(row.amount);
    if (!row.amount || !(amt > 0)) return t('form.invalidAmount');
    if (!row.date) return t('form.invalidDate');
    if (type === 'debt_payment' && !row.debtId) return t('form.debtPicker');
    if (type === 'transfer' && (!row.accountId || !row.toAccountId || row.accountId === row.toAccountId)) return t('form.transferTo');
    return null;
  }

  async function submit() {
    for (const row of rows) {
      const validationError = validateRow(row);
      if (validationError) {
        onError(validationError);
        return;
      }
    }

    const remaining = [...rows];
    while (remaining.length > 0) {
      const row = remaining[0]!;
      try {
        await api.createTransaction({
          type,
          amountMajor: row.amount,
          currencyCode: baseCurrency,
          description: row.description.trim() || undefined,
          note: row.note.trim() || undefined,
          transactionDate: row.date,
          occurredAt: row.time ? new Date(`${row.date}T${row.time}`).toISOString() : undefined,
          accountId: row.accountId || undefined,
          toAccountId: type === 'transfer' ? row.toAccountId : undefined,
          debtId: type === 'debt_payment' ? row.debtId : undefined,
          status: type === 'pending_claim' ? (row.awaitingBill ? 'awaiting_bill' : 'pending') : undefined,
          buyer: type === 'pending_claim' ? row.buyer : undefined,
          categoryId: type === 'pending_claim' || type === 'loan_given' ? row.categoryId : undefined,
          direction: type === 'investment' ? row.direction : undefined,
          clientId: crypto.randomUUID(),
        });
        remaining.shift();
        setRows([...remaining]);
      } catch (err) {
        if (err instanceof ApiError) onError(err.message);
        return;
      }
    }

    setRows([blankRow(todayStr())]);
    await refreshAccounts();
    onDone();
  }

  return (
    <div className="form-page">
      <div className="type-select">
        {TYPES.map((ty) => (
          <button key={ty} className={type === ty ? 'active' : ''} onClick={() => resetForm(ty)}>
            {TYPE_ICON[ty]}
            {t(`txType.${ty}`)}
          </button>
        ))}
      </div>

      {rows.map((row) => (
        <div key={row.key} className="batch-row">
          {rows.length > 1 && (
            <button type="button" className="remove-row-btn" aria-label={t('form.removeRow')} onClick={() => removeRow(row.key)}>
              <X size={14} />
            </button>
          )}

          <div className="batch-row-top">
            <input
              type="text"
              className="desc-input"
              placeholder={t('form.descriptionPlaceholder')}
              value={row.description}
              onChange={(e) => updateRow(row.key, { description: e.target.value })}
              list="description-suggestions"
              autoComplete="off"
            />
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className="amount-input"
              placeholder="0.00"
              value={row.amount}
              onChange={(e) => updateRow(row.key, { amount: e.target.value })}
            />
          </div>

          <input
            type="text"
            className="note-input"
            placeholder={t('form.notePlaceholder')}
            value={row.note}
            onChange={(e) => updateRow(row.key, { note: e.target.value })}
          />

          <div className="batch-row-bottom">
            <label className="field date-field">
              <span>{t('form.dateLabel')}</span>
              <input type="date" value={row.date} onChange={(e) => updateRow(row.key, { date: e.target.value })} />
            </label>
            <label className="field time-field">
              <span>{t('form.timeLabel')}</span>
              <input type="time" value={row.time} onChange={(e) => updateRow(row.key, { time: e.target.value })} />
            </label>

            {(type === 'personal_expense' || type === 'income' || type === 'loan_given' || type === 'investment') && (
              <label className="field">
                {/* Money flows the opposite way for income (and for an investment sell/dividend)
                    than it does for an expense — "pay with" is backwards for those, so the label
                    tracks which direction this row actually moves money in. */}
                <span>
                  {type === 'income' || (type === 'investment' && row.direction === 'sell') ? t('form.receiveInto') : t('form.payWith')}
                </span>
                <PaymentPicker value={row.accountId} accounts={accounts} onChange={(v) => updateRow(row.key, { accountId: v })} onManage={onDone} />
                {type === 'personal_expense' && <span className="hint">{t('form.payWithHint')}</span>}
              </label>
            )}

            {type === 'loan_given' && (
              <label className="field">
                <span>{t('form.category')}</span>
                <select value={row.categoryId ?? ''} onChange={(e) => updateRow(row.key, { categoryId: e.target.value || null })}>
                  <option value="">{t('form.noCategory')}</option>
                  {loanCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {type === 'pending_claim' && (
              <>
                <label className="field">
                  <span>{t('form.buyer')}</span>
                  <div className="pill-row">
                    <button type="button" className={row.buyer === 'self' ? 'active' : ''} onClick={() => updateRow(row.key, { buyer: 'self' })}>
                      {t('form.buyerSelf')}
                    </button>
                    <button type="button" className={row.buyer === 'staff' ? 'active' : ''} onClick={() => updateRow(row.key, { buyer: 'staff' })}>
                      {t('form.buyerStaff')}
                    </button>
                  </div>
                </label>
                <label className="field">
                  <span>{t('form.claimInitialStatus')}</span>
                  <div className="pill-row">
                    <button type="button" className={!row.awaitingBill ? 'active' : ''} onClick={() => updateRow(row.key, { awaitingBill: false })}>
                      {t('form.claimHasBill')}
                    </button>
                    <button type="button" className={row.awaitingBill ? 'active' : ''} onClick={() => updateRow(row.key, { awaitingBill: true })}>
                      {t('form.claimAwaitingBill')}
                    </button>
                  </div>
                </label>
                <label className="field">
                  <span>{t('form.category')}</span>
                  <select value={row.categoryId ?? ''} onChange={(e) => updateRow(row.key, { categoryId: e.target.value || null })}>
                    <option value="">{t('form.noCategory')}</option>
                    {claimCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t('form.payWith')}</span>
                  <PaymentPicker value={row.accountId} accounts={accounts} onChange={(v) => updateRow(row.key, { accountId: v })} onManage={onDone} />
                </label>
              </>
            )}

            {type === 'investment' && (
              <label className="field">
                <span>{t('form.direction')}</span>
                <div className="pill-row">
                  <button type="button" className={row.direction === 'buy' ? 'active' : ''} onClick={() => updateRow(row.key, { direction: 'buy' })}>
                    {t('form.directionBuy')}
                  </button>
                  <button type="button" className={row.direction === 'sell' ? 'active' : ''} onClick={() => updateRow(row.key, { direction: 'sell' })}>
                    {t('form.directionSell')}
                  </button>
                </div>
              </label>
            )}

            {type === 'debt_payment' &&
              (debts.length === 0 ? (
                <p className="hint">
                  {t('form.noDebts')} —{' '}
                  <button className="linklike" onClick={onDone}>
                    {t('form.goToSettings')}
                  </button>
                </p>
              ) : (
                <>
                  <label className="field">
                    <span>{t('form.debtPicker')}</span>
                    <select value={row.debtId ?? ''} onChange={(e) => updateRow(row.key, { debtId: e.target.value || null })}>
                      <option value="">--</option>
                      {debts.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>{t('form.payWith')}</span>
                    <PaymentPicker value={row.accountId} accounts={accounts} onChange={(v) => updateRow(row.key, { accountId: v })} onManage={onDone} />
                  </label>
                </>
              ))}

            {type === 'transfer' && (
              <>
                <label className="field">
                  <span>{t('form.payWith')}</span>
                  <PaymentPicker value={row.accountId} accounts={accounts} onChange={(v) => updateRow(row.key, { accountId: v })} onManage={onDone} />
                </label>
                <label className="field">
                  <span>{t('form.transferTo')}</span>
                  <select value={row.toAccountId ?? ''} onChange={(e) => updateRow(row.key, { toAccountId: e.target.value || null })}>
                    <option value="">--</option>
                    {accounts
                      .filter((a) => a.id !== row.accountId)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
          </div>
        </div>
      ))}

      <button type="button" className="add-fab add-row-btn" aria-label={t('form.addRow')} onClick={addRow}>
        <Plus size={18} />
      </button>

      <button className="submit" onClick={submit}>
        {t('form.submit')}
      </button>

      <datalist id="description-suggestions">
        {descriptionSuggestions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </div>
  );
}
