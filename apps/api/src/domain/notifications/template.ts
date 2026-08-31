/** Replaces `{key}` placeholders in a template with the given values. Unknown keys are left as-is. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? vars[key]! : match));
}

/** Picks the best i18n_json entry for a locale like "th-TH", falling back to English, then any entry. */
export function pickLocaleText(i18n: Record<string, string>, locale: string): string {
  const short = locale.split('-')[0]!;
  return i18n[short] ?? i18n.en ?? Object.values(i18n)[0] ?? '';
}
