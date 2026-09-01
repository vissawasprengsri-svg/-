import { useEffect, useState } from 'react';
import type { Budget } from '@finance/shared';
import { compare } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { useCurrencies } from '../hooks/useCurrencies';
import { endOfMonthStr, todayStr } from '../utils/date';

const DEV_BASE_CURRENCY = 'THB';

export function BudgetsPage({ onError }: { onError: (message: string) => void }) {
  const { t, locale } = useI18n();
  const { format: formatMoney } = useCurrencies();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [form, setForm] = useState({ name: '', amount: '', periodStart: todayStr(), periodEnd: endOfMonthStr(), rollover: false });

  async function refresh() {
    try {
      const res = await api.listBudgets();
      setBudgets(res.budgets);
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function create() {
    if (!form.name.trim() || !form.amount) {
      onError(t('form.invalidAmount'));
      return;
    }
    try {
      await api.createBudget({
        name: form.name.trim(),
        amountMajor: form.amount,
        currencyCode: DEV_BASE_CURRENCY,
        periodType: 'monthly',
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        rollover: form.rollover,
      });
      setForm({ name: '', amount: '', periodStart: todayStr(), periodEnd: endOfMonthStr(), rollover: false });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function archive(id: string) {
    try {
      await api.archiveBudget(id);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  return (
    <div className="stack">
      <section className="form-card">
        <h2>{t('budgets.newTitle')}</h2>
        <label>
          <span>{t('budgets.name')}</span>
          <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </label>
        <div className="form-row">
          <label>
            <span>
              {t('budgets.amount')} ({DEV_BASE_CURRENCY})
            </span>
            <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </label>
        </div>
        <div className="form-row">
          <label>
            <span>{t('budgets.periodStart')}</span>
            <input type="date" value={form.periodStart} onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))} />
          </label>
          <label>
            <span>{t('budgets.periodEnd')}</span>
            <input type="date" value={form.periodEnd} onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} />
          </label>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.rollover} onChange={(e) => setForm((f) => ({ ...f, rollover: e.target.checked }))} />
          <span>{t('budgets.rollover')}</span>
        </label>
        <button className="submit" onClick={create}>
          {t('budgets.create')}
        </button>
      </section>

      <ul className="list">
        {budgets.length === 0 && <li className="empty">{t('budgets.empty')}</li>}
        {budgets.map((b) => {
          const pct = compare(b.amount, '0') > 0 ? Math.min(100, Number((BigInt(b.spent) * 100n) / BigInt(b.amount))) : 0;
          return (
            <li key={b.id} className="budget-row">
              <div className="budget-row-head">
                <span className="desc">
                  {b.name} {!b.isActive && <em className="inactive-badge">{t('budgets.inactive')}</em>}
                </span>
                {b.isActive && (
                  <button className="del" onClick={() => archive(b.id)}>
                    {t('budgets.archive')}
                  </button>
                )}
              </div>
              <div className="budget-bar">
                <div className={`budget-bar-fill ${pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="meta">{t('budgets.spentOf', { spent: formatMoney(b.spent, b.currencyCode, locale), amount: formatMoney(b.amount, b.currencyCode, locale) })}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
