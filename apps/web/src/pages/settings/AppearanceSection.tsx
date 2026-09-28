import { useI18n } from '../../i18n/I18nContext';

const PRESETS = [0.8, 0.9, 1, 1.1, 1.25];

export function AppearanceSection({ scale, onChange }: { scale: number; onChange: (scale: number) => void }) {
  const { t } = useI18n();
  return (
    <section className="form-card">
      <h2>{t('settings.sections.appearance')}</h2>
      <label className="field">
        <span>{t('settings.uiScaleLabel')}</span>
        <div className="pill-row">
          {PRESETS.map((p) => (
            <button type="button" key={p} className={scale === p ? 'active' : ''} onClick={() => onChange(p)}>
              {Math.round(p * 100)}%
            </button>
          ))}
        </div>
      </label>
      <p className="hint">{t('settings.uiScaleHint')}</p>
    </section>
  );
}
