import { useState } from 'react';
import { Landmark, Trash2 } from 'lucide-react';
import { toMajorString } from '@finance/shared';
import { api, ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { useDebts } from '../../hooks/useDebts';
import { AmountEditInput } from '../../components/AmountEditInput';
import { ReorderableList } from '../../components/ReorderableList';
import { formatAmountDisplay, sanitizeAmountInput } from '../../utils/amountFormat';
import { applyLocalOrder, saveLocalOrder } from '../../utils/localOrder';

const DEV_BASE_CURRENCY = 'THB';
const DEBT_ORDER_KEY = 'finance.debts-order';

export function DebtsSection({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  const { debts, refresh } = useDebts(onError);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [, setOrderVersion] = useState(0);

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

  const orderedDebts = applyLocalOrder(debts, DEBT_ORDER_KEY);

  function reorder(orderedIds: string[]) {
    saveLocalOrder(DEBT_ORDER_KEY, orderedIds);
    setOrderVersion((v) => v + 1);
  }

  return (
    <section className="form-card">
      <h2>{t('settings.sections.debts')}</h2>
      <div className="add-inline-row">
        <input type="text" placeholder={t('settings.addDebtNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
        <input
          type="text"
          inputMode="decimal"
          placeholder={t('settings.addDebtAmountPlaceholder')}
          style={{ maxWidth: 110 }}
          value={formatAmountDisplay(amount)}
          onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" onClick={add}>
          {t('settings.add')}
        </button>
      </div>
      {debts.length === 0 && <p className="empty-sm">—</p>}
      <ReorderableList
        items={orderedDebts}
        className="list"
        itemClassName="card-row"
        onReorder={reorder}
        renderItem={(d, dragHandle) => (
          <>
            <div className="card-row-top">
              {dragHandle}
              <Landmark size={18} className="ic-amber" />
              <span className="card-row-name">{d.name}</span>
              <button className="icon-btn" onClick={() => archive(d.id)}>
                <Trash2 size={14} />
              </button>
            </div>
            <div className="card-row-fields">
              <label>
                {t('settings.balance')}{' '}
                <AmountEditInput defaultValue={toMajorString(d.currentBalance, 2)} onCommit={(raw) => updateBalance(d.id, raw)} />
              </label>
            </div>
          </>
        )}
      />
    </section>
  );
}
