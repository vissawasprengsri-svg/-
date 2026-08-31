import { describe, expect, it } from 'vitest';
import { dateForDay, daysBetween, nextDueDate } from '../src/domain/notifications/ruleEngine.js';
import { isWithinQuietHours } from '../src/domain/notifications/quietHours.js';

describe('dateForDay (credit card due-day clamping)', () => {
  it('clamps day 31 to the last real day of a short month', () => {
    expect(dateForDay(2026, 1, 31).getDate()).toBe(28); // Feb 2026, non-leap
    expect(dateForDay(2024, 1, 31).getDate()).toBe(29); // Feb 2024, leap
    expect(dateForDay(2026, 3, 31).getDate()).toBe(30); // April
  });

  it('keeps a valid day as-is', () => {
    expect(dateForDay(2026, 0, 15).getDate()).toBe(15);
  });
});

describe('nextDueDate', () => {
  it('picks this month if the due day has not passed yet', () => {
    const today = new Date(2026, 7, 10); // Aug 10, due day 20 -> Aug 20
    const due = nextDueDate(20, today);
    expect(due.getMonth()).toBe(7);
    expect(due.getDate()).toBe(20);
  });

  it('rolls over to next month if the due day already passed', () => {
    const today = new Date(2026, 7, 25); // Aug 25, due day 20 -> Sep 20
    const due = nextDueDate(20, today);
    expect(due.getMonth()).toBe(8);
    expect(due.getDate()).toBe(20);
  });

  it('treats today itself as still due today, not next month', () => {
    const today = new Date(2026, 7, 20);
    const due = nextDueDate(20, today);
    expect(due.getDate()).toBe(20);
    expect(due.getMonth()).toBe(7);
  });
});

describe('daysBetween', () => {
  it('counts whole days forward', () => {
    expect(daysBetween(new Date(2026, 0, 1), new Date(2026, 0, 8))).toBe(7);
  });
});

describe('isWithinQuietHours', () => {
  it('handles a same-day window', () => {
    expect(isWithinQuietHours('13:00', '09:00', '18:00')).toBe(true);
    expect(isWithinQuietHours('08:00', '09:00', '18:00')).toBe(false);
  });

  it('handles an overnight window that wraps past midnight', () => {
    expect(isWithinQuietHours('23:30', '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours('03:00', '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours('12:00', '22:00', '07:00')).toBe(false);
  });

  it('is disabled when either bound is missing', () => {
    expect(isWithinQuietHours('23:30', null, '07:00')).toBe(false);
    expect(isWithinQuietHours('23:30', '22:00', null)).toBe(false);
  });
});
