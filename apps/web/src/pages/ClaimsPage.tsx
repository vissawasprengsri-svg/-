import { useEffect, useState } from 'react';
import { Check, Clock } from 'lucide-react';
import type { ClaimsSummary } from '@finance/shared';
import { CLAIM_STATUS_ORDER, formatCurrency } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';

export function ClaimsPage({ onError, onChanged }: { onError: (message: string) => void; onChanged: () => void }) {
  const { t, formatDate } = useI18n();
  const [summary, setSummary] = useState<ClaimsSummary | null>(null);

  async function refresh() {
    try {
      const res = await api.getClaimsSummary();
      setSummary(res.summary);
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function markReceived(id: string) {
    try {
      await api.setClaimReceived(id, true);
      await refresh();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function advanceStatus(id: string, current: string | null) {
    const idx = CLAIM_STATUS_ORDER.indexOf(current as (typeof CLAIM_STATUS_ORDER)[number]);
    const next = CLAIM_STATUS_ORDER[idx + 1];
    if (!next) return;
    try {
      await api.setClaimStatus(id, next);
      await refresh();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  if (!summary) return <p className="hint">{t('settings.loading')}</p>;

  return (
    <div className="stack">
      <div className="card card-amber">
        <Clock size={20} />
        <div>
          <span className="card-label">{t('claims.title')}</span>
          <span className="card-amount-sm">{formatCurrency(summary.totalOutstanding, '฿', 2)}</span>
        </div>
      </div>

      {summary.folderGroups.length > 0 && (
        <>
          <h2>{t('claims.folderTitle')}</h2>
          {summary.folderGroups.map((g) => (
            <div key={g.categoryId ?? 'none'} className="claim-group">
              <div className="claim-group-head">
                <span>
                  {g.categoryName} {g.defaultClaimStatus && <i className="status-chip">{t(`claimStatus.${g.defaultClaimStatus}`)}</i>}
                </span>
                <b>{formatCurrency(g.total, '฿', 2)}</b>
              </div>
              <ul className="list">
                {g.items.map((tx) => (
                  <li key={tx.id} className="claim-row">
                    <div className="claim-info">
                      <span className="claim-desc">{tx.description || t('form.descriptionPlaceholder')}</span>
                      <span className="claim-meta">{formatDate(tx.transactionDate)}</span>
                    </div>
                    <span className="claim-amt">{formatCurrency(tx.amount, '฿', 2)}</span>
                    <button className="received-btn" onClick={() => markReceived(tx.id)}>
                      <Check size={14} /> {t('claims.received')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      <h2>{t('claims.claimTitle')}</h2>
      {summary.claimGroups.length === 0 && <p className="empty">{t('claims.claimEmpty')}</p>}
      {summary.claimGroups.map((g) => (
        <div key={g.categoryId ?? 'none'} className="claim-group">
          <div className="claim-group-head">
            <span>{g.categoryName}</span>
            <b>{formatCurrency(g.total, '฿', 2)}</b>
          </div>
          <ul className="list">
            {g.items.map((tx) => {
              const nextIdx = CLAIM_STATUS_ORDER.indexOf(tx.status as (typeof CLAIM_STATUS_ORDER)[number]) + 1;
              const next = CLAIM_STATUS_ORDER[nextIdx];
              return (
                <li key={tx.id} className="claim-row">
                  <div className="claim-info">
                    <span className="claim-desc">{tx.description || t('form.descriptionPlaceholder')}</span>
                    <span className="claim-meta">{formatDate(tx.transactionDate)}</span>
                  </div>
                  <span className="claim-amt">{formatCurrency(tx.amount, '฿', 2)}</span>
                  <div className="claim-actions">
                    <span className="status-chip">{tx.status && t(`claimStatus.${tx.status}`)}</span>
                    {next && (
                      <button className="received-btn" onClick={() => advanceStatus(tx.id, tx.status)}>
                        <Check size={14} /> {t(`claimStatus.${next}`)}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <h2>{t('claims.loanTitle')}</h2>
      {summary.loans.length === 0 ? (
        <p className="empty">{t('claims.loanEmpty')}</p>
      ) : (
        <ul className="list">
          {summary.loans.map((tx) => (
            <li key={tx.id} className="claim-row">
              <div className="claim-info">
                <span className="claim-desc">{tx.description || t('form.descriptionPlaceholder')}</span>
                <span className="claim-meta">{formatDate(tx.transactionDate)}</span>
              </div>
              <span className="claim-amt">{formatCurrency(tx.amount, '฿', 2)}</span>
              <div className="claim-actions">
                <span className="status-chip">{t('claims.outstanding')}</span>
                <button className="received-btn" onClick={() => markReceived(tx.id)}>
                  <Check size={14} /> {t('claims.repaid')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
