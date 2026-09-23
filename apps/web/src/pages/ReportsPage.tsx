import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Pencil, Trash2, X } from 'lucide-react';
import type { CategoryBreakdownItem, MonthlySummary, Transaction, TrendPoint } from '@finance/shared';
import { compare, formatCurrency, toMajorString } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { useCurrencies } from '../hooks/useCurrencies';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useCategories';
import { formatAmountDisplay, sanitizeAmountInput } from '../utils/amountFormat';
import { toLocalDateStr } from '../utils/date';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** [first day, last day] of a "YYYY-MM" month string, as YYYY-MM-DD — the same
 * range monthlySummary aggregates server-side, reproduced here so the
 * drill-down list matches exactly what a bar's total was computed from. */
function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = toLocalDateStr(new Date(y!, m!, 0));
  return { from, to };
}

export function ReportsPage({ onError }: { onError: (message: string) => void }) {
  const { t, locale, baseCurrency, formatDate } = useI18n();
  const { format: formatMoney } = useCurrencies();
  const { accounts } = useAccounts(onError);
  const { categories } = useCategories('personal_expense', onError);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [points, setPoints] = useState<TrendPoint[]>([]);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [categoryItems, setCategoryItems] = useState<Transaction[]>([]);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editAccountId, setEditAccountId] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState<string | null>(null);

  const accountOptions = accounts.filter((a) => !a.isArchived);

  async function refreshSummary() {
    try {
      const [s, p] = await Promise.all([api.monthlyReport(currentMonth()), api.trendReport(6)]);
      setSummary(s.summary);
      setPoints(p.points);
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  useEffect(() => {
    refreshSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCategoryItems(c: CategoryBreakdownItem) {
    if (!summary) return;
    try {
      const { from, to } = monthRange(summary.month);
      // The API can't filter for "category is null" (only "any" vs "this one"),
      // so the uncategorized bucket is isolated client-side from the same
      // month-wide personal_expense set monthlySummary itself aggregates —
      // that's also why this fetches the whole month rather than trusting a
      // per-category filter for every bucket, so both cases go through one path.
      const all = await api.searchAllTransactions({ type: 'personal_expense', dateFrom: from, dateTo: to });
      setCategoryItems(all.filter((tx) => tx.categoryId === c.categoryId));
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  function toggleExpand(c: CategoryBreakdownItem) {
    const key = c.categoryId ?? 'none';
    setEditingTxId(null);
    setConfirmDeleteTxId(null);
    if (expandedKey === key) {
      setExpandedKey(null);
      setCategoryItems([]);
      return;
    }
    setExpandedKey(key);
    loadCategoryItems(c);
  }

  function startEditTx(tx: Transaction) {
    setEditingTxId(tx.id);
    setConfirmDeleteTxId(null);
    setEditDesc(tx.description ?? '');
    setEditAmount(toMajorString(tx.amount, 2));
    setEditAccountId(tx.accountId ?? '');
    setEditCategoryId(tx.categoryId ?? '');
    setEditDate(tx.transactionDate);
    if (tx.occurredAt) {
      const d = new Date(tx.occurredAt);
      setEditTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    } else {
      setEditTime('');
    }
  }

  async function afterMutation(c: CategoryBreakdownItem | null) {
    await refreshSummary();
    if (c) await loadCategoryItems(c);
  }

  function currentBucket(): CategoryBreakdownItem | null {
    return summary?.byCategory.find((c) => (c.categoryId ?? 'none') === expandedKey) ?? null;
  }

  async function saveEditTx(tx: Transaction) {
    setEditingTxId(null);
    try {
      await api.updateTransactionDetails(tx.id, {
        amountMajor: editAmount || '0',
        description: editDesc,
        transactionDate: editDate,
        occurredAt: editTime ? new Date(`${editDate}T${editTime}`).toISOString() : null,
      });
      const newAccountId = editAccountId || null;
      if (newAccountId !== (tx.accountId ?? null)) {
        await api.updateTransactionAccount(tx.id, newAccountId);
      }
      const newCategoryId = editCategoryId || null;
      if (newCategoryId !== (tx.categoryId ?? null)) {
        await api.setTransactionCategory(tx.id, newCategoryId);
      }
      await afterMutation(currentBucket());
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function removeTx(tx: Transaction) {
    setConfirmDeleteTxId(null);
    try {
      await api.deleteTransaction(tx.id);
      await afterMutation(currentBucket());
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  const maxTrend = points.reduce((max, p) => {
    const inc = BigInt(p.income);
    const exp = BigInt(p.expense);
    const bigger = inc > exp ? inc : exp;
    return bigger > max ? bigger : max;
  }, 1n);

  return (
    <div className="stack">
      <section className="form-card">
        <h2>{t('reports.monthTitle')}</h2>
        {!summary ? (
          <p className="hint">{t('settings.loading')}</p>
        ) : (
          <>
            <div className="report-summary-row">
              <div>
                <span className="hint">{t('reports.income')}</span>
                <strong className="report-figure income">{formatMoney(summary.income, baseCurrency, locale)}</strong>
              </div>
              <div>
                <span className="hint">{t('reports.expense')}</span>
                <strong className="report-figure expense">{formatMoney(summary.expense, baseCurrency, locale)}</strong>
              </div>
              <div>
                <span className="hint">{t('reports.netCashFlow')}</span>
                <strong className={`report-figure ${compare(summary.netCashFlow, '0') >= 0 ? 'income' : 'expense'}`}>
                  {formatMoney(summary.netCashFlow, baseCurrency, locale)}
                </strong>
              </div>
            </div>

            <h3 className="hint">{t('reports.byCategory')}</h3>
            <p className="hint">{t('reports.drillHint')}</p>
            {summary.byCategory.length === 0 ? (
              <p className="empty-sm">{t('reports.noData')}</p>
            ) : (
              <ul className="category-bars">
                {summary.byCategory.map((c) => {
                  const key = c.categoryId ?? 'none';
                  const pct = compare(summary.expense, '0') > 0 ? Number((BigInt(c.total) * 100n) / BigInt(summary.expense)) : 0;
                  const expanded = expandedKey === key;
                  return (
                    <li key={key} className="cat-bar-block">
                      <button type="button" className="cat-bar-row" onClick={() => toggleExpand(c)}>
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="cat-label">{c.categoryName || t('reports.uncategorized')}</span>
                        <div className="cat-bar">
                          <div className="cat-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="cat-amt">{formatMoney(c.total, baseCurrency, locale)}</span>
                      </button>

                      {expanded && (
                        <ul className="list drilldown-list">
                          {categoryItems.length === 0 && <li className="empty-sm">{t('settings.loading')}</li>}
                          {categoryItems.map((tx) =>
                            editingTxId === tx.id ? (
                              <li key={tx.id} className="row edit-row">
                                <input
                                  autoFocus
                                  className="rename-input"
                                  placeholder={t('categorize.descriptionPlaceholder')}
                                  value={editDesc}
                                  onChange={(e) => setEditDesc(e.target.value)}
                                />
                                <input type="date" style={{ maxWidth: 140 }} value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                                <input type="time" style={{ maxWidth: 110 }} value={editTime} onChange={(e) => setEditTime(e.target.value)} />
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="meta-input"
                                  placeholder={t('categorize.amountPlaceholder')}
                                  value={formatAmountDisplay(editAmount)}
                                  onChange={(e) => setEditAmount(sanitizeAmountInput(e.target.value))}
                                />
                                <select value={editAccountId} onChange={(e) => setEditAccountId(e.target.value)}>
                                  <option value="">{t('categorize.noAccount')}</option>
                                  {accountOptions.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.name}
                                    </option>
                                  ))}
                                </select>
                                <select value={editCategoryId} onChange={(e) => setEditCategoryId(e.target.value)}>
                                  <option value="">{t('categorize.unsorted')}</option>
                                  {categories.map((cat) => (
                                    <option key={cat.id} value={cat.id}>
                                      {cat.name}
                                    </option>
                                  ))}
                                </select>
                                {confirmDeleteTxId === tx.id ? (
                                  <span className="confirm-text">
                                    {t('categorize.confirmDeleteTransaction')}
                                    <button type="button" className="danger-btn" onClick={() => removeTx(tx)}>
                                      {t('categorize.confirmDeleteYes')}
                                    </button>
                                    <button type="button" onClick={() => setConfirmDeleteTxId(null)}>
                                      {t('categorize.cancel')}
                                    </button>
                                  </span>
                                ) : (
                                  <>
                                    <button className="icon-btn" onClick={() => saveEditTx(tx)}>
                                      <Check size={14} />
                                    </button>
                                    <button className="icon-btn" onClick={() => setEditingTxId(null)}>
                                      <X size={14} />
                                    </button>
                                    <button className="icon-btn" aria-label={t('form.removeRow')} onClick={() => setConfirmDeleteTxId(tx.id)}>
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                )}
                              </li>
                            ) : (
                              <li key={tx.id} className="row">
                                <div className="row-info">
                                  <span className="desc">{tx.description || t(`txType.${tx.type}`)}</span>
                                  <span className="meta">{formatDate(tx.transactionDate)}</span>
                                </div>
                                <span className="amt">{formatCurrency(tx.amount, '฿', 2)}</span>
                                <button className="icon-btn" onClick={() => startEditTx(tx)}>
                                  <Pencil size={14} />
                                </button>
                              </li>
                            )
                          )}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="form-card">
        <h2>{t('reports.trendTitle')}</h2>
        {points.length === 0 ? (
          <p className="empty-sm">{t('reports.noData')}</p>
        ) : (
          <div className="trend-chart">
            {points.map((p) => {
              const incomeH = Number((BigInt(p.income) * 100n) / maxTrend);
              const expenseH = Number((BigInt(p.expense) * 100n) / maxTrend);
              return (
                <div key={p.month} className="trend-col">
                  <div className="trend-bars">
                    <div className="trend-bar income" style={{ height: `${incomeH}%` }} title={formatMoney(p.income, baseCurrency, locale)} />
                    <div className="trend-bar expense" style={{ height: `${expenseH}%` }} title={formatMoney(p.expense, baseCurrency, locale)} />
                  </div>
                  <span className="trend-label">{p.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="trend-legend">
          <span>
            <i className="legend-dot income" /> {t('reports.income')}
          </span>
          <span>
            <i className="legend-dot expense" /> {t('reports.expense')}
          </span>
        </div>
      </section>
    </div>
  );
}
