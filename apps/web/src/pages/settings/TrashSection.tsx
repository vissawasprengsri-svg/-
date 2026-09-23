import { useEffect, useState } from 'react';
import type { Transaction } from '@finance/shared';
import { formatCurrency } from '@finance/shared';
import { api, ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';

export function TrashSection({ onError, onRestored }: { onError: (message: string) => void; onRestored: () => void }) {
  const { t, formatDate } = useI18n();
  const [trash, setTrash] = useState<Transaction[]>([]);
  const [confirm, setConfirm] = useState<{ id: string; action: 'restore' | 'purge' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<'restore' | 'purge' | null>(null);

  async function refresh() {
    try {
      const res = await api.listTrash();
      setTrash(res.transactions);
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function restore(id: string) {
    setConfirm(null);
    try {
      await api.restoreFromTrash(id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await refresh();
      onRestored();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function purge(id: string) {
    setConfirm(null);
    try {
      await api.purgeFromTrash(id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function bulkRestore() {
    setBulkConfirm(null);
    for (const id of selected) {
      try {
        await api.restoreFromTrash(id);
      } catch (err) {
        if (err instanceof ApiError) onError(err.message);
        break;
      }
    }
    setSelected(new Set());
    await refresh();
    onRestored();
  }

  async function bulkPurge() {
    setBulkConfirm(null);
    for (const id of selected) {
      try {
        await api.purgeFromTrash(id);
      } catch (err) {
        if (err instanceof ApiError) onError(err.message);
        break;
      }
    }
    setSelected(new Set());
    await refresh();
  }

  return (
    <section className="form-card">
      <h2>
        {t('settings.sections.trash')}
        {trash.length > 0 ? ` (${trash.length})` : ''}
      </h2>
      <p className="hint">{t('trash.hint')}</p>
      {selected.size > 0 && (
        <div className="bulk-move-bar">
          {bulkConfirm ? (
            <span className="confirm-text">
              {t(bulkConfirm === 'purge' ? 'trash.confirmPurgeBulk' : 'trash.confirmRestoreBulk', { count: selected.size })}
              <button type="button" className="danger-btn" onClick={() => (bulkConfirm === 'purge' ? bulkPurge() : bulkRestore())}>
                {t('categorize.confirmDeleteYes')}
              </button>
              <button type="button" onClick={() => setBulkConfirm(null)}>
                {t('categorize.cancel')}
              </button>
            </span>
          ) : (
            <>
              <span>{t('categorize.selectedCount', { count: selected.size })}</span>
              <button type="button" className="restore-btn" onClick={() => setBulkConfirm('restore')}>
                {t('trash.restoreSelected')}
              </button>
              <button type="button" className="del" onClick={() => setBulkConfirm('purge')}>
                {t('trash.purgeSelected')}
              </button>
              <button type="button" className="secondary-btn" onClick={() => setSelected(new Set())}>
                {t('categorize.cancel')}
              </button>
            </>
          )}
        </div>
      )}
      {trash.length === 0 ? (
        <p className="empty-sm">{t('trash.empty')}</p>
      ) : (
        <ul className="list">
          {trash.map((tx) => (
            <li key={tx.id} className="row">
              <input type="checkbox" checked={selected.has(tx.id)} onChange={() => toggleSelect(tx.id)} />
              <div className="row-info">
                <span className="desc">{tx.description || t(`txType.${tx.type}`)}</span>
                <span className="meta">{tx.deletedAt && t('trash.deletedOn', { date: formatDate(tx.deletedAt) })}</span>
              </div>
              <span className="amt">{formatCurrency(tx.amount, '฿', 2)}</span>
              {confirm?.id === tx.id ? (
                <span className="confirm-text">
                  {t(confirm.action === 'purge' ? 'trash.confirmPurge' : 'trash.confirmRestore')}
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => (confirm.action === 'purge' ? purge(tx.id) : restore(tx.id))}
                  >
                    {t('categorize.confirmDeleteYes')}
                  </button>
                  <button type="button" onClick={() => setConfirm(null)}>
                    {t('categorize.cancel')}
                  </button>
                </span>
              ) : (
                <>
                  <button className="restore-btn" onClick={() => setConfirm({ id: tx.id, action: 'restore' })}>
                    {t('trash.restore')}
                  </button>
                  <button className="del" onClick={() => setConfirm({ id: tx.id, action: 'purge' })}>
                    {t('trash.purge')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
