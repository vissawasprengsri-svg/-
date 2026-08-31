import { useEffect, useState } from 'react';
import type { RecurrenceFreq, RecurringRule } from '@finance/shared';
import { fromMajorInput } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { useCurrencies } from '../hooks/useCurrencies';
import { todayStr } from '../utils/date';

const DEV_ACCOUNT_ID = '00000000-0000-0000-0000-000000000002';
const DEV_BASE_CURRENCY = 'THB';
const FREQUENCIES: RecurrenceFreq[] = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];

export function RecurringPage({ onError }: { onError: (message: string) => void }) {
  const { t, locale } = useI18n();
  const { byCode, format: formatMoney } = useCurrencies();
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [form, setForm] = useState({ description: '', amount: '', frequency: 'monthly' as RecurrenceFreq, startDate: todayStr() });

  async function refresh() {
    try {
      const res = await api.listRecurringRules();
      setRules(res.rules);
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function create() {
    if (!form.description.trim() || !form.amount) {
      onError(t('form.invalidAmount'));
      return;
    }
    try {
      await api.createRecurringRule({
        template: {
          type: 'personal_expense',
          amountMajor: form.amount,
          currencyCode: DEV_BASE_CURRENCY,
          description: form.description.trim(),
          accountId: DEV_ACCOUNT_ID,
        },
        frequency: form.frequency,
        startDate: form.startDate,
      });
      setForm({ description: '', amount: '', frequency: 'monthly', startDate: todayStr() });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function toggle(rule: RecurringRule) {
    try {
      await api.setRecurringRuleActive(rule.id, !rule.isActive);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteRecurringRule(id);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  return (
    <div className="stack">
      <section className="form-card">
        <h2>{t('recurring.newTitle')}</h2>
        <label>
          <span>{t('recurring.description')}</span>
          <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </label>
        <div className="form-row">
          <label>
            <span>
              {t('recurring.amount')} ({DEV_BASE_CURRENCY})
            </span>
            <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </label>
          <label>
            <span>{t('recurring.frequency')}</span>
            <select value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as RecurrenceFreq }))}>
              {FREQUENCIES.map((freq) => (
                <option key={freq} value={freq}>
                  {t(`recurring.freq.${freq}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span>{t('recurring.startDate')}</span>
          <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
        </label>
        <button className="submit" onClick={create}>
          {t('recurring.create')}
        </button>
      </section>

      <ul className="list">
        {rules.length === 0 && <li className="empty">{t('recurring.empty')}</li>}
        {rules.map((r) => (
          <li key={r.id} className="row">
            <div className="row-info">
              <span className="desc">{r.template.description || t(`recurring.freq.${r.frequency}`)}</span>
              <span className="meta">
                {t(`recurring.freq.${r.frequency}`)} · {r.nextRunDate && r.isActive ? t('recurring.nextRun', { date: r.nextRunDate }) : t('budgets.inactive')} ·{' '}
                {t('recurring.occurrences', { count: r.occurrencesCount })}
              </span>
            </div>
            <span className="amt">
              {formatMoney(
                fromMajorInput(r.template.amountMajor, byCode[r.template.currencyCode]?.minorUnit ?? 2),
                r.template.currencyCode,
                locale
              )}
            </span>
            <button className="restore" onClick={() => toggle(r)}>
              {r.isActive ? t('recurring.pause') : t('recurring.resume')}
            </button>
            <button className="del" onClick={() => remove(r.id)}>
              {t('recurring.delete')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
