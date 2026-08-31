import { useCallback, useEffect, useState } from 'react';
import type { Transaction, TransactionType } from '@finance/shared';
import { api, ApiError } from './api/client';
import { Toast, type ToastState } from './components/Toast';
import { NotificationBell } from './components/NotificationBell';
import { LocaleSwitcher } from './components/LocaleSwitcher';
import { SettingsPage } from './pages/SettingsPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { RecurringPage } from './pages/RecurringPage';
import { ReportsPage } from './pages/ReportsPage';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useCurrencies } from './hooks/useCurrencies';
import { useI18n } from './i18n/I18nContext';
import { todayStr } from './utils/date';

const DEV_ACCOUNT_ID = '00000000-0000-0000-0000-000000000002';
const DEV_BASE_CURRENCY = 'THB';

export default function App() {
  const { t, locale, formatDate } = useI18n();
  const { format: formatMoney } = useCurrencies();
  const [tab, setTab] = useState<'dashboard' | 'trash' | 'budgets' | 'recurring' | 'reports' | 'settings'>('dashboard');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [trash, setTrash] = useState<Transaction[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ type: 'personal_expense' as TransactionType, amount: '', description: '', date: todayStr() });
  const [search, setSearch] = useState({ q: '', dateFrom: '', dateTo: '' });

  const hasSearchFilters = search.q.trim() !== '' || search.dateFrom !== '' || search.dateTo !== '';

  const refresh = useCallback(async () => {
    try {
      const listCall = hasSearchFilters
        ? api.searchTransactions({ q: search.q.trim() || undefined, dateFrom: search.dateFrom || undefined, dateTo: search.dateTo || undefined })
        : api.listTransactions();
      const [tx, trashList] = await Promise.all([listCall, api.listTrash()]);
      setTransactions(tx.transactions);
      setTrash(trashList.transactions);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  }, [hasSearchFilters, search]);

  useEffect(() => {
    const timer = setTimeout(refresh, hasSearchFilters ? 300 : 0);
    return () => clearTimeout(timer);
  }, [refresh, hasSearchFilters]);

  useUndoRedo(
    (message) => {
      setToast({ message });
      refresh();
    },
    (message) => setError(message)
  );

  async function submit() {
    setError('');
    if (!form.amount || Number.isNaN(Number(form.amount))) {
      setError(t('form.invalidAmount'));
      return;
    }
    try {
      await api.createTransaction({
        type: form.type,
        amountMajor: form.amount,
        currencyCode: DEV_BASE_CURRENCY,
        description: form.description || undefined,
        transactionDate: form.date,
        accountId: DEV_ACCOUNT_ID,
        clientId: crypto.randomUUID(),
        status: form.type === 'pending_claim' ? 'awaiting_bill' : undefined,
      });
      setForm({ type: form.type, amount: '', description: '', date: todayStr() });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  }

  async function remove(tx: Transaction) {
    try {
      await api.deleteTransaction(tx.id);
      await refresh();
      setToast({
        message: t('dashboard.deleted', { name: tx.description || t(`txType.${tx.type}`) }),
        onUndo: async () => {
          await api.undo();
          await refresh();
        },
      });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  }

  async function restore(id: string) {
    try {
      await api.restoreFromTrash(id);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="mark">฿</span>
        <div className="header-txt">
          <h1>{t('app.title')}</h1>
          <p className="subtitle">{t('app.subtitle')}</p>
        </div>
        <LocaleSwitcher />
        <NotificationBell onError={setError} />
      </header>

      <nav className="tabs">
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>
          {t('tabs.dashboard')}
        </button>
        <button className={tab === 'trash' ? 'active' : ''} onClick={() => setTab('trash')}>
          {t('tabs.trash')} {trash.length > 0 && <em>{trash.length}</em>}
        </button>
        <button className={tab === 'budgets' ? 'active' : ''} onClick={() => setTab('budgets')}>
          {t('tabs.budgets')}
        </button>
        <button className={tab === 'recurring' ? 'active' : ''} onClick={() => setTab('recurring')}>
          {t('tabs.recurring')}
        </button>
        <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>
          {t('tabs.reports')}
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          {t('tabs.settings')}
        </button>
      </nav>

      {error && <div className="error-banner">{error}</div>}

      {tab === 'dashboard' && (
        <main className="stack">
          <section className="form-card">
            <div className="type-select">
              {(['personal_expense', 'income', 'pending_claim'] as TransactionType[]).map((ty) => (
                <button key={ty} className={form.type === ty ? 'active' : ''} onClick={() => setForm((f) => ({ ...f, type: ty }))}>
                  {t(`txType.${ty}`)}
                </button>
              ))}
            </div>
            <div className="form-row">
              <label>
                <span>
                  {t('form.amountLabel')} ({DEV_BASE_CURRENCY})
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </label>
              <label>
                <span>{t('form.dateLabel')}</span>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </label>
            </div>
            <label>
              <span>{t('form.descriptionLabel')}</span>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={t('form.descriptionPlaceholder')}
              />
            </label>
            <button className="submit" onClick={submit}>
              {t('form.submit')}
            </button>
          </section>

          <div className="search-bar">
            <input
              type="text"
              className="search-input"
              placeholder={t('search.placeholder')}
              value={search.q}
              onChange={(e) => setSearch((s) => ({ ...s, q: e.target.value }))}
            />
            <input
              type="date"
              aria-label={t('search.dateFrom')}
              value={search.dateFrom}
              onChange={(e) => setSearch((s) => ({ ...s, dateFrom: e.target.value }))}
            />
            <input
              type="date"
              aria-label={t('search.dateTo')}
              value={search.dateTo}
              onChange={(e) => setSearch((s) => ({ ...s, dateTo: e.target.value }))}
            />
            {hasSearchFilters && (
              <button className="linklike" onClick={() => setSearch({ q: '', dateFrom: '', dateTo: '' })}>
                {t('search.clear')}
              </button>
            )}
          </div>

          <h2>{t('dashboard.recent')}</h2>
          <p className="hint">{t('dashboard.undoHint')}</p>
          <ul className="list">
            {transactions.length === 0 && <li className="empty">{t('dashboard.empty')}</li>}
            {transactions.map((tx) => (
              <li key={tx.id} className="row">
                <div className="row-info">
                  <span className="desc">{tx.description || t(`txType.${tx.type}`)}</span>
                  <span className="meta">
                    {formatDate(tx.transactionDate)} · {t(`txType.${tx.type}`)}
                    {tx.status ? ` · ${tx.status}` : ''}
                  </span>
                </div>
                <span className="amt">{formatMoney(tx.amount, tx.currencyCode, locale)}</span>
                <button className="del" onClick={() => remove(tx)}>
                  {t('dashboard.delete')}
                </button>
              </li>
            ))}
          </ul>
        </main>
      )}

      {tab === 'trash' && (
        <main className="stack">
          <p className="hint">{t('trash.hint')}</p>
          <ul className="list">
            {trash.length === 0 && <li className="empty">{t('trash.empty')}</li>}
            {trash.map((tx) => (
              <li key={tx.id} className="row">
                <div className="row-info">
                  <span className="desc">{tx.description || t(`txType.${tx.type}`)}</span>
                  <span className="meta">
                    {formatDate(tx.transactionDate)} · {tx.deletedAt && t('trash.deletedOn', { date: formatDate(tx.deletedAt) })}
                  </span>
                </div>
                <span className="amt">{formatMoney(tx.amount, tx.currencyCode, locale)}</span>
                <button className="restore" onClick={() => restore(tx.id)}>
                  {t('trash.restore')}
                </button>
              </li>
            ))}
          </ul>
        </main>
      )}

      {tab === 'budgets' && (
        <main>
          <BudgetsPage onError={setError} />
        </main>
      )}

      {tab === 'recurring' && (
        <main>
          <RecurringPage onError={setError} />
        </main>
      )}

      {tab === 'reports' && (
        <main>
          <ReportsPage onError={setError} />
        </main>
      )}

      {tab === 'settings' && (
        <main>
          <SettingsPage onError={setError} />
        </main>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
