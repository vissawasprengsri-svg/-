// One [from, to] gradient per card — a deliberately small, hand-picked set
// (not an arbitrary hue rotation) so every card still reads as part of the
// same product instead of looking randomly generated. Used as the fallback
// for any account that hasn't been given an explicit color.
const GRADIENTS: [string, string][] = [
  ['#1B4965', '#3D8BB5'], // navy → sky
  ['#5B3E8E', '#8E44AD'], // indigo → violet
  ['#C9640F', '#E2691B'], // amber → orange
  ['#1F6F5C', '#3E6B4C'], // teal → forest
  ['#A23A2E', '#C1594B'], // brick → coral
  ['#4A5578', '#6B4C9A'], // slate → purple
];

function darken(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) - amount);
  const g = clamp(((num >> 8) & 0xff) - amount);
  const b = clamp((num & 0xff) - amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * The gradient used for one account's card visual and its accent color
 * anywhere else the account shows up (e.g. the "pay with" picker), so an
 * account reads as the same color everywhere in the app instead of a
 * different random shade per screen.
 *
 * A user-picked `color` always wins — the fallback hash only exists so an
 * account nobody's customized yet still gets a distinct, stable color
 * instead of every card defaulting to the same one.
 */
export function accountGradient(account: { id: string; name: string; color: string | null }): [string, string] {
  if (account.color) return [account.color, darken(account.color, 28)];
  let hash = 0;
  for (const ch of account.id || account.name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length]!;
}

/** Just the accent color (the gradient's "from" stop) — for small UI like pills/borders. */
export function accountAccentColor(account: { id: string; name: string; color: string | null }): string {
  return accountGradient(account)[0];
}
