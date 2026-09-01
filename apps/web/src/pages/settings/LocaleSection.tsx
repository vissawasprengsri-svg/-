import { useI18n } from '../../i18n/I18nContext';
import { LocaleSwitcher } from '../../components/LocaleSwitcher';

export function LocaleSection() {
  const { t } = useI18n();
  return (
    <section className="form-card">
      <h2>{t('settings.sections.locale')}</h2>
      <label className="field">
        <span>{t('settings.localeLabel')}</span>
        <LocaleSwitcher />
      </label>
    </section>
  );
}
