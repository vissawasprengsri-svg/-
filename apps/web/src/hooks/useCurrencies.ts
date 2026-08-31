import { useEffect, useState } from 'react';
import { formatCurrency, toMajorString } from '@finance/shared';
import { api } from '../api/client';

interface CurrencyMeta {
  code: string;
  symbol: string;
  minorUnit: number;
}

/**
 * Loads currency metadata once so any amount can be displayed with the
 * right symbol and decimal places. Formatting still goes through the
 * exact string-based `toMajorString`/`formatCurrency` from @finance/shared
 * — only the final, already-correct decimal string is handed to
 * `Intl.NumberFormat`, so no float ever touches the stored minor-unit value.
 */
export function useCurrencies() {
  const [byCode, setByCode] = useState<Record<string, CurrencyMeta>>({});

  useEffect(() => {
    api
      .listCurrencies()
      .then((res) => {
        setByCode(Object.fromEntries(res.currencies.map((c) => [c.code, c])));
      })
      .catch(() => {});
  }, []);

  function format(amountMinor: string, currencyCode: string, locale: string): string {
    const meta = byCode[currencyCode];
    if (!meta) return amountMinor;
    const major = toMajorString(amountMinor, meta.minorUnit);
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: meta.minorUnit,
        maximumFractionDigits: meta.minorUnit,
      }).format(Number(major));
    } catch {
      return formatCurrency(amountMinor, meta.symbol, meta.minorUnit);
    }
  }

  return { byCode, format };
}
