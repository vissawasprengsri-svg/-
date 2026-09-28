import { useEffect, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  CreditCard,
  HandCoins,
  Landmark,
  LayoutGrid,
  Pencil,
  Plus,
  TrendingUp,
  Trash2,
  X,
} from 'lucide-react';
import type { MonthlySummary, Transaction, TransactionType, UpcomingBill } from '@finance/shared';
import { add, compare, formatCurrency, toMajorString, zero } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { ConfirmModal } from '../components/ConfirmModal';
import { AccountCardVisual } from '../components/AccountCardVisual';
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
  onGoSettings: () => void;
  onGoReports: () => void;
  onDeleted: (tx: Transaction, undo: () => Promise<void>) => void;
  onError: (message: string) => void;
  refreshSignal: number;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function HomeDashboard({ onQuickAdd, onGoCategorize, onGoClaims, onGoSettings, onGoReports, onDeleted, onError, refreshSignal }: Props) {
  const { t, formatDate } = useI18n();
  const { accounts, refresh: refreshAccounts } = useAccounts(onError);
  const { debts, refresh: refreshDebts } = useDebts(onError);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [monthSummary, setMonthSummary] = useState<MonthlySummary | null>(null);
  const [outstanding, setOutstanding] = useState(zero());
  const [unsortedCount, setUnsortedCount] = useState(0);
  const [bills, setBills] = useState<UpcomingBill[]>([]);
  const [payingBillId, setPayingBillId] = useState<string | null>(null);
  const [payAccountId, setPayAccountId] = useState('');
  const [showAddBill, setShowAddBill] = useState(false);
  // null while jotting a new bill; the bill's id while editing an existing one —
  // the same form serves both, so only the submit target differs.
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [newBillTitle, setNewBillTitle] = useState('');
  const [newBillAmount, setNewBillAmount] = useState('');
  const [newBillDueDate, setNewBillDueDate] = useState('');
  const [newBillNote, setNewBillNote] = useState('');
  const [confirmDeleteTx, setConfirmDeleteTx] = useState<Transaction | null>(null);
  const [confirmDeleteBillId, setConfirmDeleteBillId] = useState<string | null>(null);

  async function refresh() {
    try {
      const [tx, summary, unsorted, upcomingBills, month] = await Promise.all([
        // Only "recent" is ever shown here, so ask the API for exactly that
        // page instead of pulling a full (now-unbounded) list and slicing client-side.
        api.listTransactions({ limit: 8 }),
        api.getClaimsSummary(),
        api.listUnsortedExpenses(),
        api.listUpcomingBills(),
        api.monthlyReport(currentMonth()),
        refreshAccounts(),
        refreshDebts(),
      ]);
      setRecent(tx.transactions);
      setOutstanding(summary.summary.totalOutstanding);
      setUnsortedCount(unsorted.transactions.length);
      setBills(upcomingBills.bills);
      setMonthSummary(month.summary);
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
  // Top 5 by spend — a glance, not the full breakdown (that's what the Reports
  // tab's "ดูทั้งหมด" link is for). Percentage is of the month's *total*
  // expense, same denominator ReportsPage's full bars use, so a figure here
  // means the same thing if the person checks it against Reports.
  const topCategories = [...(monthSummary?.byCategory ?? [])].sort((a, b) => (BigInt(a.total) < BigInt(b.total) ? 1 : -1)).slice(0, 5);

  async function remove(tx: Transaction) {
    setConfirmDeleteTx(null);
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

  function daysUntil(dueDate: string): number {
    const today = new Date(new Date().toDateString());
    const due = new Date(`${dueDate}T00:00:00`);
    return Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  }

  function startPayBill(bill: UpcomingBill) {
    setPayingBillId(bill.id);
    setPayAccountId(accounts[0]?.id ?? '');
  }

  async function confirmPayBill(id: string) {
    if (!payAccountId) return;
    try {
      await api.payUpcomingBill(id, payAccountId);
      setPayingBillId(null);
      setPayAccountId('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function removeBill(id: string) {
    setConfirmDeleteBillId(null);
    try {
      await api.deleteUpcomingBill(id);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  function closeBillForm() {
    setShowAddBill(false);
    setEditingBillId(null);
    setNewBillTitle('');
    setNewBillAmount('');
    setNewBillDueDate('');
    setNewBillNote('');
  }

  function startEditBill(bill: UpcomingBill) {
    setEditingBillId(bill.id);
    setShowAddBill(true);
    setPayingBillId(null);
    setNewBillTitle(bill.title);
    setNewBillAmount(toMajorString(bill.amount, 2));
    setNewBillDueDate(bill.dueDate);
    setNewBillNote(bill.note ?? '');
  }

  async function saveBill() {
    if (!newBillTitle.trim() || !newBillAmount || !newBillDueDate) return;
    const payload = {
      title: newBillTitle.trim(),
      amountMajor: newBillAmount,
      dueDate: newBillDueDate,
      note: newBillNote.trim() || null,
    };
    try {
      if (editingBillId) {
        await api.updateUpcomingBill(editingBillId, payload);
      } else {
        await api.createUpcomingBill(payload);
      }
      closeBillForm();
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  return (
    <div className="stack">
      <div className="cards-row-head">
        <h2>{t('home.cardsTitle')}</h2>
        <button type="button" className="linklike" onClick={onGoSettings}>
          {t('home.manage')}
        </button>
      </div>
      <div className="cards-row">
        {accounts
          .filter((a) => !a.isArchived)
          .map((a) => (
            <AccountCardVisual key={a.id} account={a} />
          ))}
        <button type="button" className="card-visual-add" onClick={onGoSettings}>
          <Plus size={22} />
          {t('home.addCard')}
        </button>
      </div>

      <div className="summary-grid">
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
      </div>

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

      <div className="categorize-bar">
        <h2 style={{ margin: 0 }}>{t('home.upcomingBillsTitle')}</h2>
        <button type="button" className="secondary-btn" onClick={() => (showAddBill ? closeBillForm() : setShowAddBill(true))}>
          {t('home.addBill')}
        </button>
      </div>

      {showAddBill && (
        <div className="claim-group">
          {editingBillId && <strong className="bill-form-title">{t('home.editBillTitle')}</strong>}
          <input
            autoFocus
            type="text"
            placeholder={t('home.billTitlePlaceholder')}
            value={newBillTitle}
            onChange={(e) => setNewBillTitle(e.target.value)}
          />
          <div className="form-row">
            <label>
              <span>{t('form.amountLabel')}</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder={t('categorize.amountPlaceholder')}
                value={newBillAmount}
                onChange={(e) => setNewBillAmount(e.target.value)}
              />
            </label>
            <label>
              <span>{t('home.billDueDate')}</span>
              <input type="date" value={newBillDueDate} onChange={(e) => setNewBillDueDate(e.target.value)} />
            </label>
          </div>
          <input
            type="text"
            placeholder={t('form.notePlaceholder')}
            value={newBillNote}
            onChange={(e) => setNewBillNote(e.target.value)}
          />
          <div className="modal-actions">
            <button type="button" className="secondary-btn" onClick={closeBillForm}>
              {t('home.cancel')}
            </button>
            <button type="button" className="primary-btn" onClick={saveBill}>
              {editingBillId ? t('home.saveBill') : t('form.submit')}
            </button>
          </div>
        </div>
      )}

      <ul className="list">
        {bills.length === 0 && <li className="empty">{t('home.upcomingBillsEmpty')}</li>}
        {bills.map((bill) => {
          const days = daysUntil(bill.dueDate);
          const badgeClass = days < 0 ? 'status-chip bill-overdue' : days === 0 ? 'status-chip bill-today' : 'status-chip';
          const badgeText = days < 0 ? t('home.billOverdue', { days: Math.abs(days) }) : days === 0 ? t('home.billDueToday') : t('home.billDueIn', { days });
          return (
            <li key={bill.id} className="row">
              <CalendarClock size={18} className={days < 0 ? 'ic-red' : 'ic-amber'} />
              <div className="row-info">
                <span className="desc">{bill.title}</span>
                <span className="meta">
                  {formatDate(bill.dueDate)} · <i className={badgeClass}>{badgeText}</i>
                  {bill.note && ` · ${bill.note}`}
                </span>
              </div>
              <span className="amt expense">{formatCurrency(bill.amount, '฿', 2)}</span>
              {payingBillId === bill.id ? (
                <>
                  <select value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)}>
                    <option value="">{t('home.payFrom')}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <button className="icon-btn" onClick={() => confirmPayBill(bill.id)} disabled={!payAccountId}>
                    <Check size={14} />
                  </button>
                  <button className="icon-btn" onClick={() => setPayingBillId(null)}>
                    <X size={14} />
                  </button>
                </>
              ) : (
                <>
                  <button className="received-btn" onClick={() => startPayBill(bill)}>
                    <Check size={14} /> {t('home.markPaid')}
                  </button>
                  <button className="icon-btn" onClick={() => startEditBill(bill)} aria-label={t('home.editBill')}>
                    <Pencil size={14} />
                  </button>
                  <button className="icon-btn" onClick={() => setConfirmDeleteBillId(bill.id)}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <div className="dashboard-grid">
        <div className="panel-main">
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
                <button className="icon-btn" onClick={() => setConfirmDeleteTx(tx)}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">{t('home.undoHint')}</p>
        </div>

        <div className="panel-right">
          <div className="card category-summary-card">
            <div className="category-summary-head">
              <h2>{t('reports.byCategory')}</h2>
              <button type="button" className="linklike" onClick={onGoReports}>
                {t('home.viewAll')}
              </button>
            </div>
            {topCategories.length === 0 ? (
              <p className="empty-sm">{t('reports.noData')}</p>
            ) : (
              <ul className="category-bars category-bars-compact">
                {topCategories.map((c) => {
                  const pct =
                    monthSummary && compare(monthSummary.expense, '0') > 0
                      ? Number((BigInt(c.total) * 100n) / BigInt(monthSummary.expense))
                      : 0;
                  return (
                    <li key={c.categoryId ?? 'none'} className="cat-bar-block">
                      <div className="cat-bar-row">
                        <span className="cat-label">{c.categoryName || t('reports.uncategorized')}</span>
                        <div className="cat-bar">
                          <div className="cat-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="cat-amt">{formatCurrency(c.total, '฿', 2)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmDeleteTx !== null}
        message={t('confirm.transactionMessage')}
        onConfirm={() => confirmDeleteTx && remove(confirmDeleteTx)}
        onCancel={() => setConfirmDeleteTx(null)}
      />
      <ConfirmModal
        isOpen={confirmDeleteBillId !== null}
        message={t('confirm.billMessage')}
        onConfirm={() => confirmDeleteBillId && removeBill(confirmDeleteBillId)}
        onCancel={() => setConfirmDeleteBillId(null)}
      />
    </div>
  );
}
