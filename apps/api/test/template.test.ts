import { describe, expect, it } from 'vitest';
import { pickLocaleText, renderTemplate } from '../src/domain/notifications/template.js';

describe('renderTemplate', () => {
  it('substitutes known placeholders', () => {
    expect(renderTemplate('รายการ "{description}" ค้าง {days} วัน', { description: 'ค่ายา', days: '20' })).toBe(
      'รายการ "ค่ายา" ค้าง 20 วัน'
    );
  });

  it('leaves unknown placeholders untouched', () => {
    expect(renderTemplate('{known} and {unknown}', { known: 'X' })).toBe('X and {unknown}');
  });

  it('is a no-op with no placeholders', () => {
    expect(renderTemplate('plain text', {})).toBe('plain text');
  });
});

describe('pickLocaleText', () => {
  const i18n = { th: 'สวัสดี', en: 'Hello' };

  it('picks the short-code match for a full locale tag', () => {
    expect(pickLocaleText(i18n, 'th-TH')).toBe('สวัสดี');
    expect(pickLocaleText(i18n, 'en-US')).toBe('Hello');
  });

  it('falls back to english for an unsupported locale', () => {
    expect(pickLocaleText(i18n, 'fr-FR')).toBe('Hello');
  });

  it('falls back to any available entry if english is missing too', () => {
    expect(pickLocaleText({ th: 'สวัสดี' }, 'fr-FR')).toBe('สวัสดี');
  });
});
