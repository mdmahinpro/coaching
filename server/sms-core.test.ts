import { describe, expect, it } from 'vitest';
import { normalisePhone } from './sms-core';

/**
 * Regression guard: ZenSMS rejects numbers that keep the Bangladeshi trunk '0'
 * after the country code (code 2101 "Invalid recipient"). Every BD number used
 * to be sent as 8800XXXXXXXXXX, so every send failed.
 */
describe('normalisePhone (BD numbers for ZenSMS)', () => {
  it('drops the trunk 0 when adding the country code', () => {
    expect(normalisePhone('01768836443')).toBe('8801768836443');
    expect(normalisePhone('01811000004')).toBe('8801811000004');
  });

  it('accepts numbers already in international form', () => {
    expect(normalisePhone('8801768836443')).toBe('8801768836443');
    expect(normalisePhone('+880 1768-836443')).toBe('8801768836443');
  });

  it('never produces a doubled zero after 880', () => {
    for (const input of ['01768836443', '01611111111', '01912345678']) {
      expect(normalisePhone(input).startsWith('8800')).toBe(false);
    }
  });

  it('handles a bare subscriber number', () => {
    expect(normalisePhone('1768836443')).toBe('8801768836443');
  });

  it('strips formatting characters', () => {
    expect(normalisePhone('+8801768836443')).toBe('8801768836443');
    expect(normalisePhone('01768-836443')).toBe('8801768836443');
  });
});
