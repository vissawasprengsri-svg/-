/**
 * Client-side-only manual ordering, for lists whose backing table has no
 * `sort_order` column to persist a real order in (schema.sql is fixed and
 * can't gain one). Persisted per-browser via localStorage rather than the
 * server, so it won't follow the user across devices.
 */
export function loadLocalOrder(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalOrder(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // best-effort only
  }
}

export function applyLocalOrder<T extends { id: string }>(items: T[], key: string): T[] {
  const order = loadLocalOrder(key);
  if (order.length === 0) return items;
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered: T[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      byId.delete(id);
    }
  }
  return [...ordered, ...byId.values()];
}
