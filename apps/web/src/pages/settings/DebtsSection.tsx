import { useState } from 'react';
import { Landmark, Trash2 } from 'lucide-react';
import { toMajorString } from '@finance/shared';
import { api, ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { useDebts } from '../../hooks/useDebts';

const DEV_BASE_CURRENCY = 'THB';

export function DebtsSection({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  const { debts, refresh } = useDebts(onError);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');

  async function add() {
    if (!name.trim()) return;
    try {
      await api.createDebt({ name: name.trim(), currencyCode: DEV_BASE_CURRENCY, balanceMajor: amount || '0' });
      setName('');
      setAmount('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function updateBalance(id: string, balanceMajor: string) {
    try {
      await api.updateDebtBalance(id, balanceMajor || '0');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function archive(id: string) {
    try {
      await api.archiveDebt(id);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  return (
    <section className="form-card">
      <h2>{t('settings.sections.debts')}</h2>
      <div className="add-inline-row">
        <input type="text" placeholder={t('settings.addDebtNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
        <input
          type="number"
          placeholder={t('settings.addDebtAmountPlaceholder')}
          style={{ maxWidth: 110 }}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" onClick={add}>
          {t('settings.add')}
        </button>
      </div>
      {debts.length === 0 && <p className="empty-sm">—</p>}
      <ul className="list">
        {debts.map((d) => (
          <li key={d.id} className="card-row">
            <div className="card-row-top">
              <Landmark size={18} className="ic-amber" />
              <span className="card-row-name">{d.name}</span>
              <button className="icon-btn" onClick={() => archive(d.id)}>
                <Trash2 size={14} />
              </button>
            </div>
            <div className="card-row-fields">
              <label>
                {t('settings.balance')}{' '}
                <input type="number" min="0" defaultValue={toMajorString(d.currentBalance, 2)} onBlur={(e) => updateBalance(d.id, e.target.value)} />
              </label>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
