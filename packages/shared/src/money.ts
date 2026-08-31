/**
 * Money is always represented as a base-10 integer string of minor units
 * (e.g. satang for THB, cents for USD, whole units for JPY). Never a
 * JS `number`/float — bigint is the only arithmetic type allowed here.
 */
export type MoneyMinor = string;

const INT_STRING_RE = /^-?\d+$/;

function assertMinorString(v: string, label: string): void {
  if (!INT_STRING_RE.test(v)) {
    throw new TypeError(`${label} must be an integer string of minor units, got: ${JSON.stringify(v)}`);
  }
}

export function zero(): MoneyMinor {
  return '0';
}

export function add(a: MoneyMinor, b: MoneyMinor): MoneyMinor {
  assertMinorString(a, 'a');
  assertMinorString(b, 'b');
  return (BigInt(a) + BigInt(b)).toString();
}

export function sub(a: MoneyMinor, b: MoneyMinor): MoneyMinor {
  assertMinorString(a, 'a');
  assertMinorString(b, 'b');
  return (BigInt(a) - BigInt(b)).toString();
}

export function negate(a: MoneyMinor): MoneyMinor {
  assertMinorString(a, 'a');
  return (-BigInt(a)).toString();
}

export function isPositive(a: MoneyMinor): boolean {
  assertMinorString(a, 'a');
  return BigInt(a) > 0n;
}

export function isZero(a: MoneyMinor): boolean {
  assertMinorString(a, 'a');
  return BigInt(a) === 0n;
}

export function compare(a: MoneyMinor, b: MoneyMinor): -1 | 0 | 1 {
  assertMinorString(a, 'a');
  assertMinorString(b, 'b');
  const av = BigInt(a);
  const bv = BigInt(b);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

export function max(a: MoneyMinor, b: MoneyMinor): MoneyMinor {
  return compare(a, b) >= 0 ? a : b;
}

/**
 * Parses a user-typed decimal string (e.g. "1500.5", "-20", "1,234.50")
 * into an integer minor-units string, given the currency's minor_unit
 * (decimal places). Rejects anything that isn't a plain decimal number —
 * no parseFloat, so there is no float rounding anywhere in the path.
 */
export function fromMajorInput(input: string, minorUnit: number): MoneyMinor {
  const cleaned = input.trim().replace(/,/g, '');
  const re = /^(-?)(\d+)(?:\.(\d+))?$/;
  const m = re.exec(cleaned);
  if (!m) {
    throw new TypeError(`Invalid amount: ${JSON.stringify(input)}`);
  }
  const [, sign, intPart, fracPartRaw = ''] = m;
  if (fracPartRaw.length > minorUnit) {
    throw new TypeError(
      `Amount ${JSON.stringify(input)} has more decimal places than currency allows (${minorUnit})`
    );
  }
  const fracPart = fracPartRaw.padEnd(minorUnit, '0');
  const digits = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, '');
  const value = `${sign === '-' ? '-' : ''}${digits}`;
  return BigInt(value).toString();
}

/**
 * Renders minor units as a major-unit decimal string, e.g. "150000" with
 * minorUnit=2 -> "1500.00". Pure string manipulation, no float involved.
 */
export function toMajorString(amountMinor: MoneyMinor, minorUnit: number): string {
  assertMinorString(amountMinor, 'amountMinor');
  const negative = amountMinor.startsWith('-');
  const digits = negative ? amountMinor.slice(1) : amountMinor;
  const padded = digits.padStart(minorUnit + 1, '0');
  if (minorUnit === 0) {
    return `${negative ? '-' : ''}${padded}`;
  }
  const intPart = padded.slice(0, padded.length - minorUnit);
  const fracPart = padded.slice(padded.length - minorUnit);
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/** Parses any plain decimal string (not just money) into {digits, scale} — e.g. "35.24" -> {digits: 3524n, scale: 2}. */
function parseDecimalToBig(input: string): { digits: bigint; scale: number } {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!m) throw new TypeError(`Invalid decimal: ${JSON.stringify(input)}`);
  const [, sign, intPart, fracPart = ''] = m;
  return { digits: BigInt(`${sign}${intPart}${fracPart}`), scale: fracPart.length };
}

/** Integer division with round-half-up (away from zero), signs handled explicitly. */
function bigDivRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const num = numerator < 0n ? -numerator : numerator;
  const den = denominator < 0n ? -denominator : denominator;
  const quotient = num / den;
  const remainder = num % den;
  const rounded = remainder * 2n >= den ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Inverts a decimal exchange rate to `precision` decimal places using exact
 * bigint long division — no float division, so no representability error
 * creeps into a rate that will go on to multiply real money.
 */
export function invertDecimal(rateMajor: string, precision = 10): string {
  const { digits, scale } = parseDecimalToBig(rateMajor);
  if (digits === 0n) throw new TypeError('Cannot invert a zero rate');
  const numerator = 10n ** BigInt(scale + precision);
  const invertedScaled = bigDivRound(numerator, digits);
  return toMajorString(invertedScaled.toString(), precision);
}

/**
 * Converts an amount between two currencies' minor units using a locked
 * major-unit exchange rate (as stored in `exchange_rates.rate`), entirely
 * with bigint arithmetic. Rounds to the nearest minor unit of the target
 * currency (round-half-up) only at the very last step.
 *
 * amountMinor(from) / 10^fromMinorUnit * rate * 10^toMinorUnit = amountMinor(to)
 */
export function convertAmount(amountMinor: MoneyMinor, fromMinorUnit: number, toMinorUnit: number, rateMajor: string): MoneyMinor {
  assertMinorString(amountMinor, 'amountMinor');
  const { digits: rateDigits, scale: rateScale } = parseDecimalToBig(rateMajor);
  const product = BigInt(amountMinor) * rateDigits;
  const exponent = toMinorUnit - fromMinorUnit - rateScale;
  if (exponent >= 0) {
    return (product * 10n ** BigInt(exponent)).toString();
  }
  return bigDivRound(product, 10n ** BigInt(-exponent)).toString();
}

function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Formats minor units for display with a currency symbol and thousands
 * separators, entirely via string manipulation (no Number()/parseFloat).
 */
export function formatCurrency(
  amountMinor: MoneyMinor,
  symbol: string,
  minorUnit: number
): string {
  const major = toMajorString(amountMinor, minorUnit);
  const negative = major.startsWith('-');
  const unsigned = negative ? major.slice(1) : major;
  const [intPart, fracPart] = unsigned.split('.');
  const grouped = groupThousands(intPart ?? '0');
  const withFrac = fracPart ? `${grouped}.${fracPart}` : grouped;
  return `${negative ? '-' : ''}${symbol}${withFrac}`;
}
