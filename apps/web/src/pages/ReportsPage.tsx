import { useEffect, useState } from 'react';
import type { MonthlySummary, TrendPoint } from '@finance/shared';
import { compare } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { useCurrencies } from '../hooks/useCurrencies';

const DEV_BASE_CURRENCY = 'THB';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function ReportsPage({ onError }: { onError: (message: string) => void }) {
  const { t, locale } = useI18n();
  const { format: formatMoney } = useCurrencies();
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [points, setPoints] = useState<TrendPoint[]>([]);

  useEffect(() => {
    Promise.all([api.monthlyReport(currentMonth()), api.trendReport(6)])
      .then(([s, p]) => {
        setSummary(s.summary);
        setPoints(p.points);
      })
      .catch((err) => {
        if (err instanceof ApiError) onError(err.message);
      });
  }, []);

  const maxTrend = points.reduce((max, p) => {
    const inc = BigInt(p.income);
    const exp = BigInt(p.expense);
    const bigger = inc > exp ? inc : exp;
    return bigger > max ? bigger : max;
  }, 1n);

  return (
    <div className="stack">
      <section className="form-card">
        <h2>{t('reports.monthTitle')}</h2>
        {!summary ? (
          <p className="hint">{t('settings.loading')}</p>
        ) : (
          <>
            <div className="report-summary-row">
              <div>
                <span className="hint">{t('reports.income')}</span>
                <strong className="report-figure income">{formatMoney(summary.income, DEV_BASE_CURRENCY, locale)}</strong>
              </div>
              <div>
                <span className="hint">{t('reports.expense')}</span>
                <strong className="report-figure expense">{formatMoney(summary.expense, DEV_BASE_CURRENCY, locale)}</strong>
              </div>
              <div>
                <span className="hint">{t('reports.netCashFlow')}</span>
                <strong className={`report-figure ${compare(summary.netCashFlow, '0') >= 0 ? 'income' : 'expense'}`}>
                  {formatMoney(summary.netCashFlow, DEV_BASE_CURRENCY, locale)}
                </strong>
              </div>
            </div>

            <h3 className="hint">{t('reports.byCategory')}</h3>
            {summary.byCategory.length === 0 ? (
              <p className="empty-sm">{t('reports.noData')}</p>
            ) : (
              <ul className="category-bars">
                {summary.byCategory.map((c) => {
                  const pct = compare(summary.expense, '0') > 0 ? Number((BigInt(c.total) * 100n) / BigInt(summary.expense)) : 0;
                  return (
                    <li key={c.categoryId ?? 'none'}>
                      <span className="cat-label">{c.categoryName || t('reports.uncategorized')}</span>
                      <div className="cat-bar">
                        <div className="cat-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="cat-amt">{formatMoney(c.total, DEV_BASE_CURRENCY, locale)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="form-card">
        <h2>{t('reports.trendTitle')}</h2>
        {points.length === 0 ? (
          <p className="empty-sm">{t('reports.noData')}</p>
        ) : (
          <div className="trend-chart">
            {points.map((p) => {
              const incomeH = Number((BigInt(p.income) * 100n) / maxTrend);
              const expenseH = Number((BigInt(p.expense) * 100n) / maxTrend);
              return (
                <div key={p.month} className="trend-col">
                  <div className="trend-bars">
                    <div className="trend-bar income" style={{ height: `${incomeH}%` }} title={formatMoney(p.income, DEV_BASE_CURRENCY, locale)} />
                    <div className="trend-bar expense" style={{ height: `${expenseH}%` }} title={formatMoney(p.expense, DEV_BASE_CURRENCY, locale)} />
                  </div>
                  <span className="trend-label">{p.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="trend-legend">
          <span>
            <i className="legend-dot income" /> {t('reports.income')}
          </span>
          <span>
            <i className="legend-dot expense" /> {t('reports.expense')}
          </span>
        </div>
      </section>
    </div>
  );
}
