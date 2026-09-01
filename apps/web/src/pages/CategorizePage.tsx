import { useEffect, useRef, useState } from 'react';
import type { AccountWithCard, ClaimStatus, Transaction } from '@finance/shared';
import { formatCurrency, toMajorString } from '@finance/shared';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { useCategories } from '../hooks/useCategories';
import { useAccounts } from '../hooks/useAccounts';
import { formatAmountDisplay, sanitizeAmountInput } from '../utils/amountFormat';

function AccountSelect({
  value,
  onChange,
  accounts,
  noAccountLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  accounts: AccountWithCard[];
  noAccountLabel: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{noAccountLabel}</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

export function CategorizePage({ onError, onChanged }: { onError: (message: string) => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { categories, refresh: refreshCategories } = useCategories('personal_expense', onError);
  const { accounts } = useAccounts(onError);
  const [unsorted, setUnsorted] = useState<Transaction[]>([]);
  const [allExpenses, setAllExpenses] = useState<Transaction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewCategoryId, setViewCategoryId] = useState<string | null>(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryStatus, setNewCategoryStatus] = useState<ClaimStatus | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editAccountId, setEditAccountId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [confirmDeleteCategoryId, setConfirmDeleteCategoryId] = useState<string | null>(null);
  const latestRequestId = useRef(0);

  function accountName(accountId: string | null): string {
    if (!accountId) return t('categorize.noAccount');
    return accounts.find((a) => a.id === accountId)?.name ?? t('categorize.noAccount');
  }

  async function refresh() {
    const requestId = ++latestRequestId.current;
    try {
      const [u, all] = await Promise.all([api.listUnsortedExpenses(), api.searchTransactions({ type: 'personal_expense' })]);
      // A slower earlier refresh() call can resolve after a newer one (e.g.
      // several edits fired in quick succession) — ignore it so it can't
      // clobber fresher state.
      if (requestId !== latestRequestId.current) return;
      setUnsorted(u.transactions);
      setAllExpenses(all.transactions);
    } catch (err) {
      if (requestId === latestRequestId.current && err instanceof ApiError) onError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function assign(transactionId: string, categoryId: string | null) {
    try {
      await api.setTransactionCategory(transactionId, categoryId);
      setSelectedId(null);
      await refresh();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      await api.createCategory({
        name,
        appliesTo: ['personal_expense'],
        isClaimable: newCategoryStatus !== null,
        defaultClaimStatus: newCategoryStatus,
      });
      setNewCategoryName('');
      setNewCategoryStatus(null);
      setShowAddCategory(false);
      await refreshCategories();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  function startEditCategory(id: string, name: string) {
    setEditingCategoryId(id);
    setEditCategoryName(name);
  }

  async function saveEditCategory(id: string) {
    const name = editCategoryName.trim();
    setEditingCategoryId(null);
    if (!name) return;
    try {
      await api.renameCategory(id, name);
      await refreshCategories();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function deleteCategory(id: string) {
    setConfirmDeleteCategoryId(null);
    try {
      await api.deleteCategory(id);
      if (viewCategoryId === id) setViewCategoryId(null);
      await refreshCategories();
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  function startEditTx(tx: Transaction) {
    setEditingTxId(tx.id);
    setEditAmount(toMajorString(tx.amount, 2));
    setEditDesc(tx.description ?? '');
    setEditAccountId(tx.accountId ?? '');
    setEditDate(tx.transactionDate);
  }

  async function saveEditTx(id: string, originalAccountId: string | null) {
    setEditingTxId(null);
    try {
      await api.updateTransactionDetails(id, { amountMajor: editAmount || '0', description: editDesc, transactionDate: editDate });
      const newAccountId = editAccountId || null;
      if (newAccountId !== originalAccountId) {
        await api.updateTransactionAccount(id, newAccountId);
      }
      await refresh();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  function onDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData('text/plain', id);
  }
  function onDrop(e: React.DragEvent, categoryId: string | null) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) assign(id, categoryId);
  }
  function onColumnClick(categoryId: string | null) {
    if (selectedId) {
      assign(selectedId, categoryId);
      return;
    }
    setConfirmDeleteCategoryId(null);
    setViewCategoryId((v) => (v === categoryId ? null : categoryId));
  }

  const accountOptions = accounts.filter((a) => !a.isArchived);

  const categoryCounts = new Map<string, number>();
  for (const tx of allExpenses) {
    if (tx.categoryId) categoryCounts.set(tx.categoryId, (categoryCounts.get(tx.categoryId) ?? 0) + 1);
  }
  const viewItems = viewCategoryId ? allExpenses.filter((tx) => tx.categoryId === viewCategoryId) : [];
  const viewCategory = categories.find((c) => c.id === viewCategoryId);

  return (
    <div className="stack">
      <div className="categorize-bar">
        <p className="hint">
          {unsorted.length > 0 ? t('categorize.hint', { count: unsorted.length }) : t('categorize.allDone')}
        </p>
        <button type="button" className="add-fab" onClick={() => setShowAddCategory(true)} aria-label={t('categorize.newCategoryTitle')}>
          <Plus size={18} />
        </button>
      </div>

      <div className="cat-pills">
        <button
          type="button"
          className="cat-pill unsorted"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(e, null)}
          onClick={() => onColumnClick(null)}
        >
          {t('categorize.unsorted')} <em>{unsorted.length}</em>
        </button>
        {categories.map((c) =>
          editingCategoryId === c.id ? (
            <span key={c.id} className="cat-pill cat-pill-editing">
              <input
                autoFocus
                className="cat-pill-input"
                value={editCategoryName}
                onChange={(e) => setEditCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEditCategory(c.id);
                  if (e.key === 'Escape') setEditingCategoryId(null);
                }}
              />
              <button type="button" className="pill-icon-btn" onClick={() => saveEditCategory(c.id)}>
                <Check size={13} />
              </button>
              <button type="button" className="pill-icon-btn" onClick={() => setEditingCategoryId(null)}>
                <X size={13} />
              </button>
            </span>
          ) : (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className={`cat-pill ${viewCategoryId === c.id ? 'active' : ''}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, c.id)}
              onClick={() => onColumnClick(c.id)}
              onKeyDown={(e) => e.key === 'Enter' && onColumnClick(c.id)}
            >
              {c.name}
              {c.isClaimable && <i className="pill-status">💰</i>}{' '}
              <em>{categoryCounts.get(c.id) ?? 0}</em>
              <button
                type="button"
                className="pill-icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  startEditCategory(c.id, c.name);
                }}
              >
                <Pencil size={12} />
              </button>
            </div>
          )
        )}
      </div>

      {showAddCategory && (
        <div className="modal-backdrop" onClick={() => setShowAddCategory(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{t('categorize.newCategoryTitle')}</h3>
            <input
              autoFocus
              type="text"
              placeholder={t('settings.addCategoryNamePlaceholder')}
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCategory()}
            />
            <div>
              <p className="hint">{t('categorize.newCategoryStatusLabel')}</p>
              <div className="status-options">
                <button
                  type="button"
                  className={`status-option ${newCategoryStatus === null ? 'active' : ''}`}
                  onClick={() => setNewCategoryStatus(null)}
                >
                  {t('categorize.statusNone')}
                </button>
                {(['awaiting_bill', 'pending', 'claimed'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`status-option ${newCategoryStatus === s ? 'active' : ''}`}
                    onClick={() => setNewCategoryStatus(s)}
                  >
                    {t(`claimStatus.${s}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setShowAddCategory(false)}>
                {t('categorize.cancel')}
              </button>
              <button type="button" className="primary-btn" onClick={addCategory}>
                {t('settings.add')}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewCategoryId !== null && viewCategory && (
        <div className="cat-detail">
          <div className="cat-detail-head">
            <strong>{viewCategory.name}</strong>
            <div className="cat-detail-actions">
              {confirmDeleteCategoryId === viewCategory.id ? (
                <>
                  <span className="confirm-text">{t('categorize.confirmDeleteCategory')}</span>
                  <button type="button" className="danger-btn" onClick={() => deleteCategory(viewCategory.id)}>
                    {t('categorize.confirmDeleteYes')}
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteCategoryId(null)}>
                    {t('categorize.cancel')}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setConfirmDeleteCategoryId(viewCategory.id)}>
                    <Trash2 size={14} /> {t('categorize.deleteCategory')}
                  </button>
                  <button type="button" onClick={() => setViewCategoryId(null)}>
                    <X size={14} /> {t('categorize.viewClose')}
                  </button>
                </>
              )}
            </div>
          </div>
          {viewItems.length === 0 ? (
            <p className="empty-sm">{t('categorize.emptyCategory')}</p>
          ) : (
            <ul className="list">
              {viewItems.map((tx) =>
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
                    <input
                      type="text"
                      inputMode="decimal"
                      className="meta-input"
                      placeholder={t('categorize.amountPlaceholder')}
                      value={formatAmountDisplay(editAmount)}
                      onChange={(e) => setEditAmount(sanitizeAmountInput(e.target.value))}
                    />
                    <AccountSelect
                      value={editAccountId}
                      onChange={setEditAccountId}
                      accounts={accountOptions}
                      noAccountLabel={t('categorize.noAccount')}
                    />
                    <button className="icon-btn" onClick={() => saveEditTx(tx.id, tx.accountId ?? null)}>
                      <Check size={14} />
                    </button>
                    <button className="icon-btn" onClick={() => setEditingTxId(null)}>
                      <X size={14} />
                    </button>
                  </li>
                ) : (
                  <li key={tx.id} draggable onDragStart={(e) => onDragStart(e, tx.id)} className="row draggable">
                    <div className="row-info">
                      <span className="desc">{tx.description || t(`txType.${tx.type}`)}</span>
                      <span className="meta">
                        {tx.transactionDate} · {accountName(tx.accountId)}
                      </span>
                    </div>
                    <select value={tx.categoryId ?? ''} onChange={(e) => assign(tx.id, e.target.value || null)}>
                      <option value="">{t('categorize.unsorted')}</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <span className="amt">{formatCurrency(tx.amount, '฿', 2)}</span>
                    <button className="icon-btn" onClick={() => startEditTx(tx)}>
                      <Pencil size={14} />
                    </button>
                  </li>
                )
              )}
            </ul>
          )}
        </div>
      )}

      <ul className="queue">
        {unsorted.map((tx) =>
          editingTxId === tx.id ? (
            <li key={tx.id} className="queue-item queue-item-editing">
              <input
                autoFocus
                className="rename-input"
                placeholder={t('categorize.descriptionPlaceholder')}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
              />
              <input type="date" style={{ maxWidth: 140 }} value={editDate} onChange={(e) => setEditDate(e.target.value)} />
              <input
                type="text"
                inputMode="decimal"
                className="meta-input"
                placeholder={t('categorize.amountPlaceholder')}
                value={formatAmountDisplay(editAmount)}
                onChange={(e) => setEditAmount(sanitizeAmountInput(e.target.value))}
              />
              <AccountSelect
                      value={editAccountId}
                      onChange={setEditAccountId}
                      accounts={accountOptions}
                      noAccountLabel={t('categorize.noAccount')}
                    />
              <button className="icon-btn" onClick={() => saveEditTx(tx.id, tx.accountId ?? null)}>
                <Check size={14} />
              </button>
              <button className="icon-btn" onClick={() => setEditingTxId(null)}>
                <X size={14} />
              </button>
            </li>
          ) : (
            <li
              key={tx.id}
              draggable
              onDragStart={(e) => onDragStart(e, tx.id)}
              onClick={() => setSelectedId((s) => (s === tx.id ? null : tx.id))}
              className={`queue-item ${selectedId === tx.id ? 'selected' : ''}`}
            >
              <span className="chip-amt">{formatCurrency(tx.amount, '฿', 2)}</span>
              <span className="chip-desc">{tx.description || t(`txType.${tx.type}`)}</span>
              <span className="chip-meta">
                {tx.transactionDate} · {accountName(tx.accountId)}
              </span>
              <button
                type="button"
                className="pill-icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  startEditTx(tx);
                }}
              >
                <Pencil size={12} />
              </button>
            </li>
          )
        )}
        {unsorted.length === 0 && <p className="empty">{t('categorize.queueEmpty')}</p>}
      </ul>
    </div>
  );
}
