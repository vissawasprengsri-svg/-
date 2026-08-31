/**
 * Formats a Date as YYYY-MM-DD using its LOCAL calendar fields. Never use
 * `date.toISOString().slice(0, 10)` for "today"/date-picker defaults —
 * that converts to UTC first, which silently rolls the date back (or
 * forward) by one whenever the browser's timezone offset crosses midnight,
 * e.g. it's already Aug 31 in Bangkok (UTC+7) but still Aug 30 in UTC.
 */
export function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayStr(): string {
  return toLocalDateStr(new Date());
}

export function endOfMonthStr(date: Date = new Date()): string {
  return toLocalDateStr(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}
