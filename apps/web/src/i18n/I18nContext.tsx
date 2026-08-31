import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { SUPPORTED_LOCALES, type LocaleCode } from '@finance/shared';
import { translations, type LocaleTag } from './translations';
import { api } from '../api/client';

const LOCALE_KEY = 'finance.locale';
const DEFAULT_LOCALE: LocaleCode = 'th-TH';

function dirFor(locale: LocaleCode): 'ltr' | 'rtl' {
  return SUPPORTED_LOCALES.find((l) => l.code === locale)?.dir ?? 'ltr';
}

function lookup(dict: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), dict);
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

interface I18nValue {
  locale: LocaleCode;
  dir: 'ltr' | 'rtl';
  timezone: string;
  setLocale: (locale: LocaleCode) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatDate: (isoDate: string) => string;
  formatDateTime: (isoTimestamp: string) => string;
}

const I18nCtx = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(() => (localStorage.getItem(LOCALE_KEY) as LocaleCode) || DEFAULT_LOCALE);
  const [timezone, setTimezone] = useState('Asia/Bangkok');

  // `users.locale`/`users.timezone` are the source of truth; localStorage
  // is just a fast, offline-safe first paint before this resolves.
  useEffect(() => {
    api
      .getLocale()
      .then((res) => {
        setLocaleState(res.locale);
        setTimezone(res.timezone);
      })
      .catch(() => {
        // API unreachable: keep the localStorage/default fallback.
      });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale.split('-')[0]!;
    document.documentElement.dir = dirFor(locale);
    localStorage.setItem(LOCALE_KEY, locale);
  }, [locale]);

  function setLocale(next: LocaleCode) {
    setLocaleState(next);
    api.updateLocale({ locale: next }).catch(() => {
      // Best-effort sync; the UI already switched language locally.
    });
  }

  const value = useMemo<I18nValue>(() => {
    const dict = translations[locale as LocaleTag] ?? translations[DEFAULT_LOCALE];
    return {
      locale,
      dir: dirFor(locale),
      timezone,
      setLocale,
      t: (key, vars) => {
        const found = lookup(dict, key.split('.'));
        return typeof found === 'string' ? interpolate(found, vars) : key;
      },
      // `isoDate` here is always a pure calendar date (YYYY-MM-DD, e.g.
      // transaction_date) with no time component — it means "this happened
      // on the 31st" independent of anyone's timezone. Parsing it as a UTC
      // instant and then re-projecting into `timezone` for display can flip
      // it to the previous/next day depending on the viewer's offset, so we
      // build the Date from its literal y/m/d and never apply a timeZone.
      formatDate: (isoDate) => {
        const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
        return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(y!, m! - 1, d!));
      },
      formatDateTime: (isoTimestamp) =>
        new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(isoTimestamp)),
    };
  }, [locale, timezone]);

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
