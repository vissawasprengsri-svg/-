import { useEffect, useState } from 'react';
import { Check, CheckCircle2, ChevronDown, ChevronRight, Clock, PackageCheck, Trash2 } from 'lucide-react';
import type { ClaimBatch, ClaimsSummary } from '@finance/shared';
import { CLAIM_STATUS_ORDER, formatCurrency } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';

export function ClaimsPage({ onError, onChanged }: { onError: (message: string) => void; onChanged: () => void }) {
  const { t, formatDate } = useI18n();
  const [summary, setSummary] = useState<ClaimsSummary | null>(null);
  const [batches, setBatches] = useState<ClaimBatch[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState<string | null>(null);

  async function refresh() {
    try {
      const [summaryRes, batchRes] = await Promise.all([api.getClaimsSummary(), api.listClaimBatches()]);
      setSummary(summaryRes.summary);
      setBatches(batchRes.batches);
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

  async function submitBatch() {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      await api.createClaimBatch(Array.from(selected));
      setSelected(new Set());
      await refresh();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function removeBatch(id: string) {
    setConfirmDeleteBatch(null);
    try {
      await api.deleteClaimBatch(id);
      await refresh();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

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
          <div className="claim-grid">
            {summary.folderGroups.map((g) => {
              // Categories created/edited before the custom label existed only
              // have the fixed enum value — fall back to its translated text.
              const label = g.statusLabel ?? (g.defaultClaimStatus ? t(`claimStatus.${g.defaultClaimStatus}`) : null);
              return (
              <div key={g.categoryId ?? 'none'} className="claim-group">
                <div className="claim-group-head">
                  <span>
                    {g.categoryName} {label && <i className="status-chip">{label}</i>}
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
              );
            })}
          </div>
        </>
      )}

      <h2>{t('claims.claimTitle')}</h2>
      {selected.size > 0 && (
        <div className="bulk-move-bar">
          <span>{t('claims.batchSelected', { count: selected.size })}</span>
          <button type="button" className="primary-btn" onClick={submitBatch} disabled={submitting}>
            <PackageCheck size={14} /> {submitting ? t('data.importing') : t('claims.submitBatch')}
          </button>
          <button type="button" className="secondary-btn" onClick={() => setSelected(new Set())}>
            {t('categorize.cancel')}
          </button>
        </div>
      )}
      {summary.claimGroups.length === 0 && <p className="empty">{t('claims.claimEmpty')}</p>}
      <div className="claim-grid">
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
                // Only bills still waiting to be filed can join a batch — anything
                // already submitted belongs to one, and the API would reject it.
                const batchable = tx.status === 'pending' && !tx.claimBatchId;
                return (
                  <li key={tx.id} className="claim-row">
                    {batchable && (
                      <input type="checkbox" checked={selected.has(tx.id)} onChange={() => toggleSelect(tx.id)} />
                    )}
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
      </div>

      <h2>{t('claims.batchHistoryTitle')}</h2>
      {batches.length === 0 && <p className="empty">{t('claims.batchEmpty')}</p>}
      <div className="claim-grid">
        {batches.map((batch) => (
          <div key={batch.id} className="claim-group">
            <div
              className="claim-group-head batch-head"
              role="button"
              tabIndex={0}
              onClick={() => setExpandedBatch((cur) => (cur === batch.id ? null : batch.id))}
              onKeyDown={(e) => e.key === 'Enter' && setExpandedBatch((cur) => (cur === batch.id ? null : batch.id))}
            >
              {expandedBatch === batch.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              <span className="batch-ref">{batch.referenceNo ?? batch.title}</span>
              <i className={`status-chip settle-${batch.settlement}`}>{t(`claims.settlement.${batch.settlement}`)}</i>
              <b>{formatCurrency(batch.totalAmount, '฿', 2)}</b>
            </div>
            <p className="claim-meta">
              {t('claims.batchMeta', {
                count: batch.itemCount,
                received: batch.receivedCount,
                date: batch.submittedAt ? formatDate(batch.submittedAt.slice(0, 10)) : '-',
              })}
            </p>
            {expandedBatch === batch.id && (
              <>
                <ul className="list">
                  {batch.items.map((tx) => (
                    <li key={tx.id} className="claim-row">
                      <div className="claim-info">
                        <span className="claim-desc">{tx.description || t('form.descriptionPlaceholder')}</span>
                        <span className="claim-meta">{formatDate(tx.transactionDate)}</span>
                      </div>
                      <span className="claim-amt">{formatCurrency(tx.amount, '฿', 2)}</span>
                      <span className="status-chip">{tx.status && t(`claimStatus.${tx.status}`)}</span>
                    </li>
                  ))}
                </ul>
                {batch.receivedCount === 0 &&
                  (confirmDeleteBatch === batch.id ? (
                    <span className="confirm-text">
                      {t('claims.confirmDeleteBatch')}
                      <button type="button" className="danger-btn" onClick={() => removeBatch(batch.id)}>
                        {t('categorize.confirmDeleteYes')}
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteBatch(null)}>
                        {t('categorize.cancel')}
                      </button>
                    </span>
                  ) : (
                    <button className="del" onClick={() => setConfirmDeleteBatch(batch.id)}>
                      <Trash2 size={13} /> {t('claims.deleteBatch')}
                    </button>
                  ))}
              </>
            )}
          </div>
        ))}
      </div>

      <h2>{t('claims.loanTitle')}</h2>
      {summary.loanGroups.length === 0 && <p className="empty">{t('claims.loanEmpty')}</p>}
      <div className="claim-grid">
        {summary.loanGroups.map((g) => (
          <div key={g.categoryId ?? 'none'} className="claim-group">
            <div className="claim-group-head">
              <span>{g.categoryName}</span>
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
                  <div className="claim-actions">
                    <span className="status-chip">{t('claims.outstanding')}</span>
                    <button className="received-btn" onClick={() => markReceived(tx.id)}>
                      <Check size={14} /> {t('claims.repaid')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <h2>{t('claims.completedTitle')}</h2>
      {summary.completedGroups.length === 0 && <p className="empty">{t('claims.completedEmpty')}</p>}
      <div className="claim-grid">
        {summary.completedGroups.map((g) => (
          <div key={g.categoryId ?? 'none'} className="claim-group completed">
            <div className="claim-group-head">
              <span>
                <CheckCircle2 size={15} /> {g.categoryName}
              </span>
              <b>{formatCurrency(g.total, '฿', 2)}</b>
            </div>
            <ul className="list">
              {g.items.map((tx) => (
                <li key={tx.id} className="claim-row">
                  <div className="claim-info">
                    <span className="claim-desc">{tx.description || t('form.descriptionPlaceholder')}</span>
                    <span className="claim-meta">
                      {tx.receivedAt ? t('claims.receivedOn', { date: formatDate(tx.receivedAt.slice(0, 10)) }) : formatDate(tx.transactionDate)}
                    </span>
                    {tx.claimReceivedAccountName && (
                      <span className="claim-meta">{t('claims.receivedInto', { account: tx.claimReceivedAccountName })}</span>
                    )}
                  </div>
                  <span className="claim-amt">{formatCurrency(tx.amount, '฿', 2)}</span>
                  <span className="status-chip settle-paid">{t('claims.received')}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
