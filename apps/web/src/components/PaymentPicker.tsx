import { Banknote, CreditCard, Wallet } from 'lucide-react';
import type { AccountWithCard } from '@finance/shared';
import { useI18n } from '../i18n/I18nContext';
import { accountAccentColor } from '../utils/accountColor';

/** Same accent color the account's dashboard card uses — active fills solid, inactive gets a colored left edge. */
function accentStyle(color: string, active: boolean): React.CSSProperties {
  return active ? { background: color, borderColor: color } : { borderInlineStart: `3px solid ${color}` };
}

export function PaymentPicker({
  value,
  accounts,
  onChange,
  onManage,
}: {
  value: string | null;
  accounts: AccountWithCard[];
  onChange: (accountId: string) => void;
  onManage: () => void;
}) {
  const { t } = useI18n();
  const nonCards = accounts.filter((a) => a.kind !== 'credit_card' && !a.isArchived);
  const cards = accounts.filter((a) => a.kind === 'credit_card' && !a.isArchived);

  return (
    <div className="payment-picker">
      {nonCards.length === 0 && (
        <button type="button" className={value === null ? 'active' : ''} onClick={() => onChange('')}>
          <Banknote size={14} /> {t('form.cash')}
        </button>
      )}
      {nonCards.map((a) => (
        <button
          type="button"
          key={a.id}
          className={value === a.id ? 'active' : ''}
          style={accentStyle(accountAccentColor(a), value === a.id)}
          onClick={() => onChange(a.id)}
        >
          <Wallet size={14} /> {a.name}
        </button>
      ))}
      {cards.map((c) => (
        <button
          type="button"
          key={c.id}
          className={value === c.id ? 'active' : ''}
          style={accentStyle(accountAccentColor(c), value === c.id)}
          onClick={() => onChange(c.id)}
        >
          <CreditCard size={14} /> {c.name}
        </button>
      ))}
      <button type="button" className="manage-btn" onClick={onManage}>
        {t('form.manageAccounts')}
      </button>
    </div>
  );
}
