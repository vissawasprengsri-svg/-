import { useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, CreditCard, HandCoins, Landmark, TrendingUp, RefreshCw } from 'lucide-react';
import type { TransactionType } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useCategories';
import { useDebts } from '../hooks/useDebts';
import { PaymentPicker } from '../components/PaymentPicker';
import { todayStr } from '../utils/date';

const DEV_BASE_CURRENCY = 'THB';
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

interface Props {
  presetType: TransactionType;
  onDone: () => void;
  onError: (message: string) => void;
}

export function AddTransactionPage({ presetType, onDone, onError }: Props) {
  const { t } = useI18n();
  const { accounts, refresh: refreshAccounts } = useAccounts(onError);
  const { categories: claimCategories } = useCategories('pending_claim', onError);
  const { debts } = useDebts(onError);

  const [type, setType] = useState<TransactionType>(presetType);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayStr());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [buyer, setBuyer] = useState<'self' | 'staff'>('self');
  const [awaitingBill, setAwaitingBill] = useState(false);
  const [claimCategoryId, setClaimCategoryId] = useState<string | null>(null);
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [debtId, setDebtId] = useState<string | null>(null);

  useEffect(() => setType(presetType), [presetType]);

  function reset(nextType: TransactionType) {
    setType(nextType);
    setAmount('');
    setDescription('');
    setDate(todayStr());
    setAccountId(null);
    setToAccountId(null);
    setBuyer('self');
    setAwaitingBill(false);
    setClaimCategoryId(null);
    setDirection('buy');
    setDebtId(null);
  }

  async function submit() {
    const amt = Number(amount);
    if (!amount || !(amt > 0)) {
      onError(t('form.invalidAmount'));
      return;
    }
    if (!date) {
      onError(t('form.invalidDate'));
      return;
    }
    if (type === 'debt_payment' && !debtId) {
      onError(t('form.debtPicker'));
      return;
    }
    if (type === 'transfer' && (!accountId || !toAccountId || accountId === toAccountId)) {
      onError(t('form.transferTo'));
      return;
    }

    try {
      await api.createTransaction({
        type,
        amountMajor: amount,
        currencyCode: DEV_BASE_CURRENCY,
        description: description.trim() || undefined,
        transactionDate: date,
        accountId: accountId || undefined,
        toAccountId: type === 'transfer' ? toAccountId : undefined,
        debtId: type === 'debt_payment' ? debtId : undefined,
        status: type === 'pending_claim' ? (awaitingBill ? 'awaiting_bill' : 'pending') : undefined,
        buyer: type === 'pending_claim' ? buyer : undefined,
        categoryId: type === 'pending_claim' ? claimCategoryId : undefined,
        direction: type === 'investment' ? direction : undefined,
        clientId: crypto.randomUUID(),
      });
      reset(type);
      await refreshAccounts();
      onDone();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  return (
    <div className="form-page">
      <div className="type-select">
        {TYPES.map((ty) => (
          <button key={ty} className={type === ty ? 'active' : ''} onClick={() => reset(ty)}>
            {TYPE_ICON[ty]}
            {t(`txType.${ty}`)}
          </button>
        ))}
      </div>

      <label className="field">
        <span>
          {t('form.amountLabel')} ({DEV_BASE_CURRENCY})
        </span>
        <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>

      <label className="field">
        <span>{t('form.descriptionLabel')}</span>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('form.descriptionPlaceholder')} />
      </label>

      <label className="field">
        <span>{t('form.dateLabel')}</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      {(type === 'personal_expense' || type === 'income' || type === 'loan_given' || type === 'investment') && (
        <label className="field">
          <span>{t('form.payWith')}</span>
          <PaymentPicker value={accountId} accounts={accounts} onChange={setAccountId} onManage={onDone} />
          {type === 'personal_expense' && <span className="hint">{t('form.payWithHint')}</span>}
        </label>
      )}

      {type === 'pending_claim' && (
        <>
          <label className="field">
            <span>{t('form.buyer')}</span>
            <div className="pill-row">
              <button type="button" className={buyer === 'self' ? 'active' : ''} onClick={() => setBuyer('self')}>
                {t('form.buyerSelf')}
              </button>
              <button type="button" className={buyer === 'staff' ? 'active' : ''} onClick={() => setBuyer('staff')}>
                {t('form.buyerStaff')}
              </button>
            </div>
          </label>
          <label className="field">
            <span>{t('form.claimInitialStatus')}</span>
            <div className="pill-row">
              <button type="button" className={!awaitingBill ? 'active' : ''} onClick={() => setAwaitingBill(false)}>
                {t('form.claimHasBill')}
              </button>
              <button type="button" className={awaitingBill ? 'active' : ''} onClick={() => setAwaitingBill(true)}>
                {t('form.claimAwaitingBill')}
              </button>
            </div>
          </label>
          <label className="field">
            <span>{t('form.category')}</span>
            <select value={claimCategoryId ?? ''} onChange={(e) => setClaimCategoryId(e.target.value || null)}>
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
            <PaymentPicker value={accountId} accounts={accounts} onChange={setAccountId} onManage={onDone} />
          </label>
        </>
      )}

      {type === 'investment' && (
        <label className="field">
          <span>{t('form.direction')}</span>
          <div className="pill-row">
            <button type="button" className={direction === 'buy' ? 'active' : ''} onClick={() => setDirection('buy')}>
              {t('form.directionBuy')}
            </button>
            <button type="button" className={direction === 'sell' ? 'active' : ''} onClick={() => setDirection('sell')}>
              {t('form.directionSell')}
            </button>
          </div>
        </label>
      )}

      {type === 'debt_payment' &&
        (debts.length === 0 ? (
          <p className="hint">
            {t('form.noDebts')} — <button className="linklike" onClick={onDone}>{t('form.goToSettings')}</button>
          </p>
        ) : (
          <>
            <label className="field">
              <span>{t('form.debtPicker')}</span>
              <select value={debtId ?? ''} onChange={(e) => setDebtId(e.target.value || null)}>
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
              <PaymentPicker value={accountId} accounts={accounts} onChange={setAccountId} onManage={onDone} />
            </label>
          </>
        ))}

      {type === 'transfer' && (
        <>
          <label className="field">
            <span>{t('form.payWith')}</span>
            <PaymentPicker value={accountId} accounts={accounts} onChange={setAccountId} onManage={onDone} />
          </label>
          <label className="field">
            <span>{t('form.transferTo')}</span>
            <select value={toAccountId ?? ''} onChange={(e) => setToAccountId(e.target.value || null)}>
              <option value="">--</option>
              {accounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}

      <button className="submit" onClick={submit}>
        {t('form.submit')}
      </button>
    </div>
  );
}
