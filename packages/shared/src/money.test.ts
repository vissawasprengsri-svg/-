import { describe, expect, it } from 'vitest';
import {
  add,
  compare,
  convertAmount,
  formatCurrency,
  fromMajorInput,
  invertDecimal,
  isPositive,
  negate,
  sub,
  toMajorString,
} from './money.js';

describe('money (integer minor units, no floats)', () => {
  it('parses major-unit input into minor units for a 2-decimal currency', () => {
    expect(fromMajorInput('1500.50', 2)).toBe('150050');
    expect(fromMajorInput('0.01', 2)).toBe('1');
    expect(fromMajorInput('20', 2)).toBe('2000');
    expect(fromMajorInput('-20.5', 2)).toBe('-2050');
  });

  it('parses correctly for 0-decimal currencies (JPY)', () => {
    expect(fromMajorInput('1500', 0)).toBe('1500');
  });

  it('parses correctly for 3-decimal currencies (KWD)', () => {
    expect(fromMajorInput('1.234', 3)).toBe('1234');
  });

  it('rejects input with too many decimal places', () => {
    expect(() => fromMajorInput('1.005', 2)).toThrow();
  });

  it('rejects non-numeric input', () => {
    expect(() => fromMajorInput('abc', 2)).toThrow();
    expect(() => fromMajorInput('1.2.3', 2)).toThrow();
  });

  it('round-trips through toMajorString', () => {
    expect(toMajorString('150050', 2)).toBe('1500.50');
    expect(toMajorString('50', 2)).toBe('0.50');
    expect(toMajorString('-50', 2)).toBe('-0.50');
    expect(toMajorString('1500', 0)).toBe('1500');
  });

  it('adds and subtracts exactly, no float drift', () => {
    // 0.1 + 0.2 famously != 0.3 in float; must be exact here.
    expect(add(fromMajorInput('0.10', 2), fromMajorInput('0.20', 2))).toBe(fromMajorInput('0.30', 2));
    expect(sub('100', '30')).toBe('70');
  });

  it('negate and compare work on large values beyond float-safe integers', () => {
    const big = '9007199254740995'; // > Number.MAX_SAFE_INTEGER
    expect(negate(big)).toBe('-9007199254740995');
    expect(compare(big, '9007199254740994')).toBe(1);
  });

  it('isPositive reflects sign correctly', () => {
    expect(isPositive('1')).toBe(true);
    expect(isPositive('0')).toBe(false);
    expect(isPositive('-1')).toBe(false);
  });

  it('formats currency with thousands separators without using Number()', () => {
    expect(formatCurrency('150000', '฿', 2)).toBe('฿1,500.00');
    expect(formatCurrency('-150000', '฿', 2)).toBe('-฿1,500.00');
    expect(formatCurrency('1000000', '¥', 0)).toBe('¥1,000,000');
  });
});

describe('convertAmount (locked FX rate, exact bigint math)', () => {
  it('converts 2-decimal -> 2-decimal (USD -> THB)', () => {
    // $100.00 at 35.50 THB/USD -> ฿3,550.00
    expect(convertAmount('10000', 2, 2, '35.50')).toBe('355000');
  });

  it('converts 2-decimal -> 0-decimal (USD -> JPY)', () => {
    // $100.00 at 150 JPY/USD -> ¥15,000
    expect(convertAmount('10000', 2, 0, '150')).toBe('15000');
  });

  it('converts 3-decimal -> 2-decimal (KWD -> USD)', () => {
    // 100.000 KWD at 3.25 USD/KWD -> $325.00
    expect(convertAmount('100000', 3, 2, '3.25')).toBe('32500');
  });

  it('rounds half-up on the final minor unit only', () => {
    // $1.00 at 33.335 THB/USD -> ฿33.335 -> rounds to ฿33.34 (satang)
    expect(convertAmount('100', 2, 2, '33.335')).toBe('3334');
  });

  it('a rate of exactly 1 is a no-op for same-scale currencies', () => {
    expect(convertAmount('123456', 2, 2, '1')).toBe('123456');
  });

  it('round-trips approximately through direct rate and its inverse', () => {
    // Not bit-exact (inversion is itself rounded to `precision` places),
    // but converting there and back should land within a rounding unit.
    const original = '10000'; // $100.00
    const rate = '35.50';
    const converted = convertAmount(original, 2, 2, rate); // -> THB
    const inverseRate = invertDecimal(rate, 10); // THB -> USD
    const roundTripped = convertAmount(converted, 2, 2, inverseRate);
    expect(Math.abs(Number(roundTripped) - Number(original))).toBeLessThanOrEqual(1);
  });
});

describe('invertDecimal (exact bigint long division, no float)', () => {
  it('inverts a simple rate to the requested precision', () => {
    expect(invertDecimal('4', 4)).toBe('0.2500');
    expect(invertDecimal('0.25', 4)).toBe('4.0000');
  });

  it('rejects inverting zero', () => {
    expect(() => invertDecimal('0')).toThrow();
  });
});
