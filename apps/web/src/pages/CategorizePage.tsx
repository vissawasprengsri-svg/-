import { useEffect, useState } from 'react';
import type { Transaction } from '@finance/shared';
import { formatCurrency } from '@finance/shared';
import { X } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { useCategories } from '../hooks/useCategories';

export function CategorizePage({ onError, onChanged }: { onError: (message: string) => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { categories, refresh: refreshCategories } = useCategories('personal_expense', onError);
  const [unsorted, setUnsorted] = useState<Transaction[]>([]);
  const [allExpenses, setAllExpenses] = useState<Transaction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewCategoryId, setViewCategoryId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');

  async function refresh() {
    try {
      const [u, all] = await Promise.all([api.listUnsortedExpenses(), api.searchTransactions({ type: 'personal_expense' })]);
      setUnsorted(u.transactions);
      setAllExpenses(all.transactions);
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
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
      await api.createCategory({ name, appliesTo: ['personal_expense'] });
      setNewCategoryName('');
      await refreshCategories();
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
    setViewCategoryId((v) => (v === categoryId ? null : categoryId));
  }

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
        {categories.map((c) => (
          <button
            type="button"
            key={c.id}
            className={`cat-pill ${viewCategoryId === c.id ? 'active' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, c.id)}
            onClick={() => onColumnClick(c.id)}
          >
            {c.name}
            {c.isClaimable && <i className="pill-status">💰</i>}{' '}
            <em>{categoryCounts.get(c.id) ?? 0}</em>
          </button>
        ))}
      </div>

      <div className="add-inline-row">
        <input
          type="text"
          placeholder={t('settings.addCategoryNamePlaceholder')}
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCategory()}
        />
        <button type="button" onClick={addCategory}>
          {t('settings.add')}
        </button>
      </div>

      {viewCategoryId !== null && viewCategory && (
        <div className="cat-detail">
          <div className="cat-detail-head">
            <strong>{viewCategory.name}</strong>
            <button type="button" onClick={() => setViewCategoryId(null)}>
              <X size={14} /> {t('categorize.viewClose')}
            </button>
          </div>
          {viewItems.length === 0 ? (
            <p className="empty-sm">{t('categorize.emptyCategory')}</p>
          ) : (
            <ul className="list">
              {viewItems.map((tx) => (
                <li key={tx.id} draggable onDragStart={(e) => onDragStart(e, tx.id)} className="row draggable">
                  <div className="row-info">
                    <span className="desc">{tx.description || t(`txType.${tx.type}`)}</span>
                    <span className="meta">{tx.transactionDate}</span>
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
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="queue">
        {unsorted.map((tx) => (
          <li
            key={tx.id}
            draggable
            onDragStart={(e) => onDragStart(e, tx.id)}
            onClick={() => setSelectedId((s) => (s === tx.id ? null : tx.id))}
            className={`queue-item ${selectedId === tx.id ? 'selected' : ''}`}
          >
            <span className="chip-amt">{formatCurrency(tx.amount, '฿', 2)}</span>
            <span className="chip-desc">{tx.description || t(`txType.${tx.type}`)}</span>
            <span className="chip-meta">{tx.transactionDate}</span>
          </li>
        ))}
        {unsorted.length === 0 && <p className="empty">{t('categorize.queueEmpty')}</p>}
      </ul>
    </div>
  );
}
