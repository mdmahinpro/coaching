import { describe, it, expect } from 'vitest';
import { fillTemplate, hasPlaceholders, SMS_TEMPLATES } from './sms';

describe('fillTemplate (SMS body personalisation)', () => {
  it('is required for every built-in template — all ship placeholders', () => {
    for (const t of Object.values(SMS_TEMPLATES)) {
      expect(hasPlaceholders(t.body)).toBe(true);
    }
  });

  it('substitutes student/fee values read from the DB', () => {
    const body = SMS_TEMPLATES.FEE_REMINDER.body;
    const out = fillTemplate(body, {
      নাম: 'Mahin Bin Raihan',
      মাস: 'October 2026',
      পরিমাণ: '1500',
      ইনস্টিটিউট: 'Techely Coaching',
    });
    expect(out).toContain('Mahin Bin Raihan');
    expect(out).toContain('October 2026');
    expect(out).toContain('1500');
    expect(out).toContain('Techely Coaching');
    expect(out).not.toMatch(/\{[^}]+\}/);
  });

  it('leaves a placeholder visible rather than silently blanking it', () => {
    const out = fillTemplate('প্রিয় {নাম}, ফি বাকি', {});
    expect(out).toBe('প্রিয় {নাম}, ফি বাকি');
  });

  it('a body with no placeholders never needs per-recipient rendering', () => {
    expect(hasPlaceholders('সবাইকে ঈদের শুভেচ্ছা')).toBe(false);
  });
});
