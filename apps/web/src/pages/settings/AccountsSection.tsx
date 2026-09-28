import { useState } from 'react';
import { CreditCard, Trash2, Wallet } from 'lucide-react';
import type { AccountNetwork } from '@finance/shared';
import { add, formatCurrency, toMajorString, zero } from '@finance/shared';
import { api, ApiError } from '../../api/client';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useI18n } from '../../i18n/I18nContext';
import { useAccounts } from '../../hooks/useAccounts';
import { AmountEditInput } from '../../components/AmountEditInput';
import { ReorderableList } from '../../components/ReorderableList';
import { formatAmountDisplay, sanitizeAmountInput } from '../../utils/amountFormat';
import { accountAccentColor } from '../../utils/accountColor';

const NETWORKS: AccountNetwork[] = ['visa', 'mastercard', 'jcb', 'amex', 'unionpay', 'truemoney', 'other'];

/** Cosmetic-only network picker feeding the dashboard's card visual — see Account.network. */
function NetworkSelect({ value, onChange }: { value: AccountNetwork | null; onChange: (v: AccountNetwork | null) => void }) {
  const { t } = useI18n();
  return (
    <select value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as AccountNetwork | null)}>
      <option value="">{t('settings.networkNone')}</option>
      {NETWORKS.map((n) => (
        <option key={n} value={n}>
          {t(`settings.network${n.charAt(0).toUpperCase()}${n.slice(1)}`)}
        </option>
      ))}
    </select>
  );
}

export function AccountsSection({ onError }: { onError: (message: string) => void }) {
  const { t, baseCurrency } = useI18n();
  const { accounts, refresh } = useAccounts(onError);
  const [newAccountName, setNewAccountName] = useState('');
  const [newOpeningBalance, setNewOpeningBalance] = useState('');
  const [newCardName, setNewCardName] = useState('');
  // Accounts and cards share one archive path, so one confirm target covers both lists.
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);

  const nonCards = accounts.filter((a) => a.kind !== 'credit_card' && !a.isArchived);
  const cards = accounts.filter((a) => a.kind === 'credit_card' && !a.isArchived);
  const totalCash = nonCards.reduce((sum, a) => add(sum, a.currentBalance), zero());

  async function addAccount() {
    const name = newAccountName.trim();
    if (!name) return;
    try {
      await api.createAccount({ name, kind: 'cash', currencyCode: baseCurrency, openingBalanceMajor: newOpeningBalance || undefined });
      setNewAccountName('');
      setNewOpeningBalance('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function setBalance(id: string, balanceMajor: string) {
    try {
      await api.updateAccountBalance(id, balanceMajor || '0');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function addCard() {
    const name = newCardName.trim();
    if (!name) return;
    try {
      await api.createAccount({ name, kind: 'credit_card', currencyCode: baseCurrency });
      setNewCardName('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function archive(id: string) {
    setConfirmArchiveId(null);
    try {
      await api.archiveAccount(id);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function setLast4(id: string, last4: string) {
    const trimmed = last4.trim();
    if (trimmed && !/^\d{4}$/.test(trimmed)) return;
    try {
      await api.updateAccountCardDetails(id, { last4: trimmed || null });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function setNetwork(id: string, network: AccountNetwork | null) {
    try {
      await api.updateAccountCardDetails(id, { network });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function setColor(id: string, color: string) {
    try {
      await api.updateAccountCardDetails(id, { color });
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

  async function reorder(orderedIds: string[]) {
    try {
      await api.reorderAccounts(orderedIds);
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
        <input
          type="text"
          inputMode="decimal"
          placeholder={t('settings.openingBalancePlaceholder')}
          style={{ maxWidth: 130 }}
          value={formatAmountDisplay(newOpeningBalance)}
          onChange={(e) => setNewOpeningBalance(sanitizeAmountInput(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && addAccount()}
        />
        <button type="button" onClick={addAccount}>
          {t('settings.add')}
        </button>
      </div>
      {nonCards.length === 0 && <p className="empty-sm">{t('form.cash')}</p>}
      {nonCards.length > 0 && (
        <div className="total-row">
          <span>{t('settings.totalCash')}</span>
          <span className="amt">{formatCurrency(totalCash, '฿', 2)}</span>
        </div>
      )}
      <ReorderableList
        items={nonCards}
        className="list"
        itemClassName="row"
        onReorder={reorder}
        renderItem={(a, dragHandle) => (
          <>
            {dragHandle}
            <Wallet size={18} className="ic-green" />
            <div className="row-info">
              <span className="desc">{a.name}</span>
            </div>
            <AmountEditInput
              className="meta-input"
              defaultValue={toMajorString(a.currentBalance, 2)}
              onCommit={(raw) => setBalance(a.id, raw)}
            />
            <span className="meta">{a.currencyCode}</span>
            <input
              type="color"
              className="color-swatch-input"
              title={t('settings.cardColor')}
              value={a.color ?? accountAccentColor(a)}
              onChange={(e) => setColor(a.id, e.target.value)}
            />
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              className="last4-input"
              placeholder={t('settings.last4Placeholder')}
              defaultValue={a.last4 ?? ''}
              onBlur={(e) => setLast4(a.id, e.target.value)}
            />
            <NetworkSelect value={a.network} onChange={(n) => setNetwork(a.id, n)} />
            <button className="icon-btn" onClick={() => setConfirmArchiveId(a.id)}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      />

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
      <ReorderableList
        items={cards}
        className="list"
        itemClassName="card-row"
        onReorder={reorder}
        renderItem={(c, dragHandle) => {
          const used = c.currentBalance.startsWith('-') ? c.currentBalance.slice(1) : c.currentBalance;
          const limit = c.creditLimit ?? '0';
          const pct = limit !== '0' ? Math.min(100, Number((BigInt(used) * 100n) / BigInt(limit))) : 0;
          return (
            <>
              <div className="card-row-top">
                {dragHandle}
                <CreditCard size={18} className="ic-blue" />
                <span className="card-row-name">{c.name}</span>
                <button className="icon-btn" onClick={() => setConfirmArchiveId(c.id)}>
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
                  {t('settings.usedSoFar')} {formatAmountDisplay(toMajorString(used, 2))}
                  {limit !== '0' ? ` / ${formatAmountDisplay(toMajorString(limit, 2))}` : ''}
                </span>
                <label>
                  {t('settings.creditLimit')}{' '}
                  <AmountEditInput
                    defaultValue={limit !== '0' ? toMajorString(limit, 2) : ''}
                    placeholder="0"
                    onCommit={(raw) => setLimit(c.id, raw)}
                  />
                </label>
              </div>
              <div className="card-row-fields">
                <input
                  type="color"
                  className="color-swatch-input"
                  title={t('settings.cardColor')}
                  value={c.color ?? accountAccentColor(c)}
                  onChange={(e) => setColor(c.id, e.target.value)}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  className="last4-input"
                  placeholder={t('settings.last4Placeholder')}
                  defaultValue={c.last4 ?? ''}
                  onBlur={(e) => setLast4(c.id, e.target.value)}
                />
                <NetworkSelect value={c.network} onChange={(n) => setNetwork(c.id, n)} />
              </div>
            </>
          );
        }}
      />

      <ConfirmModal
        isOpen={confirmArchiveId !== null}
        title={t('confirm.accountTitle')}
        message={t('confirm.accountMessage')}
        confirmText={t('confirm.accountConfirm')}
        onConfirm={() => confirmArchiveId && archive(confirmArchiveId)}
        onCancel={() => setConfirmArchiveId(null)}
      />
    </section>
  );
}
