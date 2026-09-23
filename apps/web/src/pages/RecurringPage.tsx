import { useEffect, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import type { RecurrenceFreq, RecurringRule } from '@finance/shared';
import { fromMajorInput } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { ConfirmModal } from '../components/ConfirmModal';
import { useI18n } from '../i18n/I18nContext';
import { useAccounts } from '../hooks/useAccounts';
import { useCurrencies } from '../hooks/useCurrencies';
import { todayStr } from '../utils/date';

const FREQUENCIES: RecurrenceFreq[] = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
const LEAD_DAYS_OPTIONS = [0, 1, 3, 7] as const;

const EMPTY_FORM = {
  description: '',
  note: '',
  amount: '',
  accountId: '',
  frequency: 'monthly' as RecurrenceFreq,
  startDate: todayStr(),
  notifyLeadDays: 3,
  autoCreate: true,
};

export function RecurringPage({ onError }: { onError: (message: string) => void }) {
  const { t, locale, baseCurrency } = useI18n();
  const { accounts } = useAccounts(onError);
  const { byCode, format: formatMoney } = useCurrencies();
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const accountOptions = accounts.filter((a) => !a.isArchived);

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

  function startEdit(rule: RecurringRule) {
    setEditingId(rule.id);
    setForm({
      description: rule.template.description ?? '',
      note: rule.template.note ?? '',
      amount: rule.template.amountMajor,
      accountId: rule.template.accountId ?? '',
      frequency: rule.frequency,
      startDate: rule.startDate,
      notifyLeadDays: rule.notifyLeadDays,
      autoCreate: rule.autoCreate,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function save() {
    if (!form.description.trim() || !form.amount) {
      onError(t('form.invalidAmount'));
      return;
    }
    const template = {
      type: 'personal_expense' as const,
      amountMajor: form.amount,
      currencyCode: baseCurrency,
      description: form.description.trim(),
      note: form.note.trim() || undefined,
      accountId: form.accountId || null,
    };
    try {
      if (editingId) {
        await api.updateRecurringRule(editingId, {
          template,
          frequency: form.frequency,
          startDate: form.startDate,
          notifyLeadDays: form.notifyLeadDays,
          autoCreate: form.autoCreate,
        });
      } else {
        await api.createRecurringRule({
          template,
          frequency: form.frequency,
          startDate: form.startDate,
          notifyLeadDays: form.notifyLeadDays,
          autoCreate: form.autoCreate,
        });
      }
      cancelEdit();
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
    setConfirmDeleteId(null);
    try {
      await api.deleteRecurringRule(id);
      if (editingId === id) cancelEdit();
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function payNow(rule: RecurringRule) {
    try {
      await api.payRecurringRuleNow(rule.id);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  return (
    <div className="stack">
      <section className="form-card">
        <h2>{editingId ? t('recurring.editTitle') : t('recurring.newTitle')}</h2>
        <label>
          <span>{t('recurring.description')}</span>
          <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </label>
        <label>
          <span>{t('recurring.note')}</span>
          <input type="text" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </label>
        <div className="form-row">
          <label>
            <span>
              {t('recurring.amount')} ({baseCurrency})
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
        <div className="form-row">
          <label>
            <span>{t('recurring.account')}</span>
            <select value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}>
              <option value="">{t('categorize.noAccount')}</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('recurring.startDate')}</span>
            <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </label>
        </div>
        <label>
          <span>{t('recurring.notifyLeadDays')}</span>
          <select
            value={form.notifyLeadDays}
            onChange={(e) => setForm((f) => ({ ...f, notifyLeadDays: Number(e.target.value) }))}
          >
            {LEAD_DAYS_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {t(`recurring.leadDays${days}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>{t('recurring.mode')}</span>
          <label className="radio-row">
            <input type="radio" checked={form.autoCreate} onChange={() => setForm((f) => ({ ...f, autoCreate: true }))} />
            {t('recurring.modeAuto')}
          </label>
          <label className="radio-row">
            <input type="radio" checked={!form.autoCreate} onChange={() => setForm((f) => ({ ...f, autoCreate: false }))} />
            {t('recurring.modeManual')}
          </label>
        </div>
        <div className="modal-actions">
          {editingId && (
            <button type="button" className="secondary-btn" onClick={cancelEdit}>
              {t('recurring.cancelEdit')}
            </button>
          )}
          <button className="submit" onClick={save}>
            {editingId ? t('recurring.save') : t('recurring.create')}
          </button>
        </div>
      </section>

      <ul className="list">
        {rules.length === 0 && <li className="empty">{t('recurring.empty')}</li>}
        {rules.map((r) => {
          const isDue = r.nextRunDate !== null && r.nextRunDate <= todayStr();
          const showPayNow = !r.autoCreate && r.isActive && isDue;
          const amountLabel = formatMoney(
            fromMajorInput(r.template.amountMajor, byCode[r.template.currencyCode]?.minorUnit ?? 2),
            r.template.currencyCode,
            locale
          );
          return (
            <li key={r.id} className="row">
              <div className="row-info">
                <span className="desc">{r.template.description || t(`recurring.freq.${r.frequency}`)}</span>
                <span className="meta">
                  {t(`recurring.freq.${r.frequency}`)} · {r.nextRunDate && r.isActive ? t('recurring.nextRun', { date: r.nextRunDate }) : t('budgets.inactive')} ·{' '}
                  {t('recurring.occurrences', { count: r.occurrencesCount })}
                  {r.template.note && ` · ${r.template.note}`}
                </span>
              </div>
              <span className="amt">{amountLabel}</span>
              {showPayNow && (
                <button className="received-btn" onClick={() => payNow(r)}>
                  <Check size={14} /> {t('recurring.payNowAmount', { amount: amountLabel })}
                </button>
              )}
              <button className="restore" onClick={() => toggle(r)}>
                {r.isActive ? t('recurring.pause') : t('recurring.resume')}
              </button>
              <button className="icon-btn" onClick={() => startEdit(r)} aria-label={t('recurring.edit')}>
                <Pencil size={14} />
              </button>
              <button className="del" onClick={() => setConfirmDeleteId(r.id)}>
                {t('recurring.delete')}
              </button>
            </li>
          );
        })}
      </ul>

      <ConfirmModal
        isOpen={confirmDeleteId !== null}
        message={t('confirm.recurringMessage')}
        onConfirm={() => confirmDeleteId && remove(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
