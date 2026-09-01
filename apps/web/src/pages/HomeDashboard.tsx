import { useEffect, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronRight,
  Clock,
  CreditCard,
  HandCoins,
  Landmark,
  LayoutGrid,
  TrendingUp,
  Trash2,
} from 'lucide-react';
import type { Transaction, TransactionType } from '@finance/shared';
import { add, compare, formatCurrency, zero } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { useAccounts } from '../hooks/useAccounts';
import { useDebts } from '../hooks/useDebts';

const TYPE_ICON: Record<TransactionType, React.ReactNode> = {
  income: <ArrowUpCircle size={18} className="ic-green" />,
  personal_expense: <ArrowDownCircle size={18} className="ic-red" />,
  pending_claim: <Landmark size={18} className="ic-amber" />,
  investment: <TrendingUp size={18} className="ic-blue" />,
  debt_payment: <CreditCard size={18} className="ic-purple" />,
  loan_given: <HandCoins size={18} className="ic-amber" />,
  transfer: <TrendingUp size={18} className="ic-blue" />,
};

interface Props {
  onQuickAdd: (type: TransactionType) => void;
  onGoCategorize: () => void;
  onGoClaims: () => void;
  onDeleted: (tx: Transaction, undo: () => Promise<void>) => void;
  onError: (message: string) => void;
  refreshSignal: number;
}

export function HomeDashboard({ onQuickAdd, onGoCategorize, onGoClaims, onDeleted, onError, refreshSignal }: Props) {
  const { t, formatDate } = useI18n();
  const { accounts, refresh: refreshAccounts } = useAccounts(onError);
  const { debts, refresh: refreshDebts } = useDebts(onError);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [outstanding, setOutstanding] = useState(zero());
  const [unsortedCount, setUnsortedCount] = useState(0);

  async function refresh() {
    try {
      const [tx, summary, unsorted] = await Promise.all([
        api.listTransactions(),
        api.getClaimsSummary(),
        api.listUnsortedExpenses(),
        refreshAccounts(),
        refreshDebts(),
      ]);
      setRecent(tx.transactions.slice(0, 8));
      setOutstanding(summary.summary.totalOutstanding);
      setUnsortedCount(unsorted.transactions.length);
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const availableCash = accounts.filter((a) => a.kind !== 'credit_card').reduce((sum, a) => add(sum, a.currentBalance), zero());
  const debtTotal = debts.reduce((sum, d) => add(sum, d.currentBalance), zero());

  async function remove(tx: Transaction) {
    try {
      await api.deleteTransaction(tx.id);
      await refresh();
      onDeleted(tx, async () => {
        await api.undo();
        await refresh();
      });
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  return (
    <div className="stack">
      <div className="card card-main">
        <span className="card-label">{t('home.availableNow')}</span>
        <span className="card-amount">{formatCurrency(availableCash, '฿', 2)}</span>
      </div>

      <div className="card card-amber" onClick={onGoClaims}>
        <Clock size={20} />
        <div>
          <span className="card-label">{t('home.outstanding')}</span>
          <span className="card-amount-sm">{formatCurrency(outstanding, '฿', 2)}</span>
        </div>
        <ChevronRight size={18} className="chevron" />
      </div>

      {compare(debtTotal, '0') > 0 && (
        <div className="card card-purple">
          <Landmark size={20} />
          <div>
            <span className="card-label">{t('home.debtTotal')}</span>
            <span className="card-amount-sm">{formatCurrency(debtTotal, '฿', 2)}</span>
          </div>
        </div>
      )}

      {unsortedCount > 0 && (
        <div className="card card-blue" onClick={onGoCategorize}>
          <LayoutGrid size={20} />
          <div>
            <span className="card-label">{t('home.unsortedCount')}</span>
            <span className="card-amount-sm">{t('home.items', { count: unsortedCount })}</span>
          </div>
          <ChevronRight size={18} className="chevron" />
        </div>
      )}

      <div className="quick-grid">
        <button onClick={() => onQuickAdd('income')}>
          <ArrowUpCircle size={20} />
          {t('txType.income')}
        </button>
        <button onClick={() => onQuickAdd('personal_expense')}>
          <ArrowDownCircle size={20} />
          {t('txType.personal_expense')}
        </button>
        <button onClick={() => onQuickAdd('pending_claim')}>
          <Landmark size={20} />
          {t('txType.pending_claim')}
        </button>
        <button onClick={() => onQuickAdd('investment')}>
          <TrendingUp size={20} />
          {t('txType.investment')}
        </button>
        <button onClick={() => onQuickAdd('debt_payment')}>
          <CreditCard size={20} />
          {t('txType.debt_payment')}
        </button>
        <button onClick={() => onQuickAdd('loan_given')}>
          <HandCoins size={20} />
          {t('txType.loan_given')}
        </button>
      </div>

      <h2>{t('home.recent')}</h2>
      <ul className="list">
        {recent.length === 0 && <li className="empty">{t('home.empty')}</li>}
        {recent.map((tx) => (
          <li key={tx.id} className="row">
            {TYPE_ICON[tx.type]}
            <div className="row-info">
              <span className="desc">{tx.description || t(`txType.${tx.type}`)}</span>
              <span className="meta">
                {formatDate(tx.transactionDate)} · {tx.categoryName || t(`txType.${tx.type}`)}
              </span>
            </div>
            <span className={`amt ${tx.type === 'income' ? 'income' : 'expense'}`}>{formatCurrency(tx.amount, '฿', 2)}</span>
            <button className="icon-btn" onClick={() => remove(tx)}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">{t('home.undoHint')}</p>
    </div>
  );
}
