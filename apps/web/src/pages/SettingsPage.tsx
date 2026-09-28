import { useEffect, useState } from 'react';
import { ArrowLeft, LogOut } from 'lucide-react';
import type { NotificationPreference, NotificationRuleCode, UserSettings } from '@finance/shared';
import { NOTIFICATION_RULE_CODES } from '@finance/shared';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { AccountsSection } from './settings/AccountsSection';
import { DebtsSection } from './settings/DebtsSection';
import { CategoriesSection } from './settings/CategoriesSection';
import { TrashSection } from './settings/TrashSection';
import { DataSection } from './settings/DataSection';
import { LocaleSection } from './settings/LocaleSection';
import { AppearanceSection } from './settings/AppearanceSection';
import { BudgetsPage } from './BudgetsPage';
import { RecurringPage } from './RecurringPage';

function NotificationSettingsSection({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [preferences, setPreferences] = useState<Record<NotificationRuleCode, NotificationPreference> | null>(null);
  const [checkResult, setCheckResult] = useState('');

  async function refresh() {
    try {
      const [s, p] = await Promise.all([api.getSettings(), api.getNotificationPreferences()]);
      setSettings(s.settings);
      setPreferences(p.preferences);
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function saveSettings(patch: Partial<UserSettings>) {
    try {
      const res = await api.updateSettings(patch);
      setSettings(res.settings);
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  async function togglePref(ruleCode: NotificationRuleCode, field: 'inAppEnabled' | 'pushEnabled' | 'emailEnabled', value: boolean) {
    try {
      const res = await api.updateNotificationPreference(ruleCode, { [field]: value });
      setPreferences(res.preferences);
    } catch (err) {
      if (err instanceof ApiError) onError(err.message);
    }
  }

  if (!settings || !preferences) return <p className="hint">{t('settings.loading')}</p>;

  return (
    <>
      <section className="form-card">
        <h2>{t('settings.thresholdsTitle')}</h2>
        <div className="form-row">
          <label>
            <span>{t('settings.claimOverdueDays')}</span>
            <input type="number" value={settings.claimOverdueDays} onChange={(e) => saveSettings({ claimOverdueDays: Number(e.target.value) })} />
          </label>
          <label>
            <span>{t('settings.cardUsageAlertPct')}</span>
            <input type="number" value={settings.cardUsageAlertPct} onChange={(e) => saveSettings({ cardUsageAlertPct: Number(e.target.value) })} />
          </label>
        </div>
        <div className="form-row">
          <label>
            <span>{t('settings.dailyReminderTime')}</span>
            <input type="time" value={settings.dailyReminderTime ?? ''} onChange={(e) => saveSettings({ dailyReminderTime: e.target.value || null })} />
          </label>
        </div>
        <div className="form-row">
          <label>
            <span>{t('settings.quietHoursStart')}</span>
            <input type="time" value={settings.quietHoursStart ?? ''} onChange={(e) => saveSettings({ quietHoursStart: e.target.value || null })} />
          </label>
          <label>
            <span>{t('settings.quietHoursEnd')}</span>
            <input type="time" value={settings.quietHoursEnd ?? ''} onChange={(e) => saveSettings({ quietHoursEnd: e.target.value || null })} />
          </label>
        </div>
        <p className="hint">{t('settings.quietHoursHint')}</p>
      </section>

      <section className="form-card">
        <h2>{t('settings.prefTitle')}</h2>
        <div className="table-scroll">
          <table className="pref-table">
            <thead>
              <tr>
                <th>{t('settings.colType')}</th>
                <th>{t('settings.colInApp')}</th>
                <th>{t('settings.colPush')}</th>
                <th>{t('settings.colEmail')}</th>
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_RULE_CODES.map((code) => {
                const pref = preferences[code];
                return (
                  <tr key={code}>
                    <td>{t(`rule.${code}`)}</td>
                    <td>
                      <input type="checkbox" checked={pref.inAppEnabled} onChange={(e) => togglePref(code, 'inAppEnabled', e.target.checked)} />
                    </td>
                    <td>
                      <input type="checkbox" checked={pref.pushEnabled} onChange={(e) => togglePref(code, 'pushEnabled', e.target.checked)} />
                    </td>
                    <td>
                      <input type="checkbox" checked={pref.emailEnabled} onChange={(e) => togglePref(code, 'emailEnabled', e.target.checked)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="form-card">
        <h2>{t('settings.testTitle')}</h2>
        <p className="hint">{t('settings.testHint')}</p>
        <button
          className="submit"
          onClick={async () => {
            try {
              const res = await api.runNotificationChecks();
              setCheckResult(t('settings.runChecksResult', { created: res.created, pushed: res.pushed }));
            } catch (err) {
              if (err instanceof ApiError) onError(err.message);
            }
          }}
        >
          {t('settings.runChecks')}
        </button>
        {checkResult && <p className="hint">{checkResult}</p>}
      </section>
    </>
  );
}

export function SettingsPage({
  onClose,
  onError,
  onChanged,
  onLogout,
  uiScale,
  onUIScaleChange,
}: {
  onClose: () => void;
  onError: (message: string) => void;
  onChanged: () => void;
  onLogout: () => void;
  uiScale: number;
  onUIScaleChange: (scale: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="settings-overlay">
      <div className="settings-header">
        {/* Back-style, not an X: this sits at the near (left) edge next to the
            title on purpose — a close button parked at the far top-right
            corner is a long, deliberate mouse trip on a wide desktop window,
            for no benefit over putting it where the eye already is. */}
        <button className="icon-btn back-btn" onClick={onClose} aria-label={t('settings.close')}>
          <ArrowLeft size={20} />
        </button>
        <h1>{t('settings.title')}</h1>
      </div>
      <div className="settings-body stack">
        <AccountsSection onError={onError} />
        <DebtsSection onError={onError} />
        <CategoriesSection onError={onError} />
        <div className="settings-subsection">
          <h1 className="settings-section-title">{t('settings.sections.budgets')}</h1>
          <BudgetsPage onError={onError} />
        </div>
        <div className="settings-subsection">
          <h1 className="settings-section-title">{t('settings.sections.recurring')}</h1>
          <RecurringPage onError={onError} />
        </div>
        <NotificationSettingsSection onError={onError} />
        <AppearanceSection scale={uiScale} onChange={onUIScaleChange} />
        <LocaleSection />
        <DataSection onError={onError} onImported={onChanged} />
        <TrashSection onError={onError} onRestored={onChanged} />
        <section className="form-card">
          <h2>{t('auth.accountSection')}</h2>
          <button className="submit" onClick={onLogout}>
            <LogOut size={16} /> {t('auth.logout')}
          </button>
        </section>
      </div>
    </div>
  );
}
