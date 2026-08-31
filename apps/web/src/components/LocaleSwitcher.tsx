import { SUPPORTED_LOCALES, type LocaleCode } from '@finance/shared';
import { useI18n } from '../i18n/I18nContext';

const LABEL: Record<LocaleCode, string> = { 'th-TH': 'ไทย', 'en-US': 'English' };

export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <select className="locale-switcher" value={locale} onChange={(e) => setLocale(e.target.value as LocaleCode)} aria-label="Language">
      {SUPPORTED_LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {LABEL[l.code]}
        </option>
      ))}
    </select>
  );
}
