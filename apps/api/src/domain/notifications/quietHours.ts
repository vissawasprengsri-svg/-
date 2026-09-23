/**
 * Quiet hours only gate interruptive channels (push). In-app notifications
 * still get written immediately — the user sees them next time they open
 * the app, which isn't an interruption. Handles the overnight wrap case
 * (e.g. 22:00 -> 07:00).
 */
export function isWithinQuietHours(nowHHMM: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  if (start <= end) {
    return nowHHMM >= start && nowHHMM < end;
  }
  // Wraps past midnight, e.g. 22:00 -> 07:00
  return nowHHMM >= start || nowHHMM < end;
}

/** Formats a Date as "HH:MM" in the given IANA timezone. */
export function currentHHMMInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    // `hour12: false` alone doesn't pin the cycle to 0-23 — some ICU versions
    // still render midnight as "24:00" under it, which breaks the plain
    // string comparison in isWithinQuietHours (`"24:00" >= "22:00"` disagrees
    // with `"00:00" >= "22:00"`). `hourCycle: 'h23'` forces 00-23 explicitly.
    hourCycle: 'h23',
  });
  return formatter.format(date);
}
