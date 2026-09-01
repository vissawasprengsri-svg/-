import { useEffect, useState } from 'react';
import type { Transaction } from '@finance/shared';
import { formatCurrency } from '@finance/shared';
import { api, ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';

export function TrashSection({ onError, onRestored }: { onError: (message: string) => void; onRestored: () => void }) {
  const { t, formatDate } = useI18n();
  const [trash, setTrash] = useState<Transaction[]>([]);

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

  async function restore(id: string) {
    try {
      await api.restoreFromTrash(id);
      await refresh();
      onRestored();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  return (
    <section className="form-card">
      <h2>
        {t('settings.sections.trash')}
        {trash.length > 0 ? ` (${trash.length})` : ''}
      </h2>
      <p className="hint">{t('trash.hint')}</p>
      {trash.length === 0 ? (
        <p className="empty-sm">{t('trash.empty')}</p>
      ) : (
        <ul className="list">
          {trash.map((tx) => (
            <li key={tx.id} className="row">
              <div className="row-info">
                <span className="desc">{tx.description || t(`txType.${tx.type}`)}</span>
                <span className="meta">{tx.deletedAt && t('trash.deletedOn', { date: formatDate(tx.deletedAt) })}</span>
              </div>
              <span className="amt">{formatCurrency(tx.amount, '฿', 2)}</span>
              <button className="restore-btn" onClick={() => restore(tx.id)}>
                {t('trash.restore')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
