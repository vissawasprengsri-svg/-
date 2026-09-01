import { useState } from 'react';
import { CreditCard, Trash2, Wallet } from 'lucide-react';
import { toMajorString } from '@finance/shared';
import { api, ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { useAccounts } from '../../hooks/useAccounts';

const DEV_BASE_CURRENCY = 'THB';

export function AccountsSection({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  const { accounts, refresh } = useAccounts(onError);
  const [newAccountName, setNewAccountName] = useState('');
  const [newCardName, setNewCardName] = useState('');

  const nonCards = accounts.filter((a) => a.kind !== 'credit_card' && !a.isArchived);
  const cards = accounts.filter((a) => a.kind === 'credit_card' && !a.isArchived);

  async function addAccount() {
    const name = newAccountName.trim();
    if (!name) return;
    try {
      await api.createAccount({ name, kind: 'cash', currencyCode: DEV_BASE_CURRENCY });
      setNewAccountName('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function addCard() {
    const name = newCardName.trim();
    if (!name) return;
    try {
      await api.createAccount({ name, kind: 'credit_card', currencyCode: DEV_BASE_CURRENCY });
      setNewCardName('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function archive(id: string) {
    try {
      await api.archiveAccount(id);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function setLimit(id: string, limitMajor: string) {
    try {
      await api.updateCreditLimit(id, limitMajor || '0');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  return (
    <section className="form-card">
      <h2>{t('settings.sections.accounts')}</h2>
      <div className="add-inline-row">
        <input
          type="text"
          placeholder={t('settings.addAccountPlaceholder')}
          value={newAccountName}
          onChange={(e) => setNewAccountName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addAccount()}
        />
        <button type="button" onClick={addAccount}>
          {t('settings.add')}
        </button>
      </div>
      {nonCards.length === 0 && <p className="empty-sm">{t('form.cash')}</p>}
      <ul className="list">
        {nonCards.map((a) => (
          <li key={a.id} className="row">
            <Wallet size={18} className="ic-green" />
            <div className="row-info">
              <span className="desc">{a.name}</span>
              <span className="meta">{toMajorString(a.currentBalance, 2)} {a.currencyCode}</span>
            </div>
            <button className="icon-btn" onClick={() => archive(a.id)}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>

      <h3 className="sub-title">{t('settings.cardKind')}</h3>
      <div className="add-inline-row">
        <input
          type="text"
          placeholder={t('settings.addCardPlaceholder')}
          value={newCardName}
          onChange={(e) => setNewCardName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCard()}
        />
        <button type="button" onClick={addCard}>
          {t('settings.add')}
        </button>
      </div>
      {cards.length === 0 && <p className="empty-sm">—</p>}
      <ul className="list">
        {cards.map((c) => {
          const used = c.currentBalance.startsWith('-') ? c.currentBalance.slice(1) : c.currentBalance;
          const limit = c.creditLimit ?? '0';
          const pct = limit !== '0' ? Math.min(100, Number((BigInt(used) * 100n) / BigInt(limit))) : 0;
          return (
            <li key={c.id} className="card-row">
              <div className="card-row-top">
                <CreditCard size={18} className="ic-blue" />
                <span className="card-row-name">{c.name}</span>
                <button className="icon-btn" onClick={() => archive(c.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
              {limit !== '0' && (
                <div className="card-row-bar">
                  <div className="card-row-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              )}
              <div className="card-row-fields">
                <span>
                  {t('settings.usedSoFar')} {toMajorString(used, 2)}
                  {limit !== '0' ? ` / ${toMajorString(limit, 2)}` : ''}
                </span>
                <label>
                  {t('settings.creditLimit')}{' '}
                  <input
                    type="number"
                    min="0"
                    defaultValue={limit !== '0' ? toMajorString(limit, 2) : ''}
                    placeholder="0"
                    onBlur={(e) => setLimit(c.id, e.target.value)}
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
