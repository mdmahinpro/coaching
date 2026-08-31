import { describe, it, expect } from 'vitest';
import {
  batchDayList,
  formatTimeText,
  formatTimeRange,
  formatBatchSchedule,
} from './schedule';

describe('batchDayList', () => {
  it('returns clean strings from the array column', () => {
    expect(batchDayList({ schedule_days: ['Mon', 'Tue', 'Wed'] })).toEqual(['Mon', 'Tue', 'Wed']);
    expect(batchDayList({ schedule_days: [' Mon ', ''] })).toEqual(['Mon']);
  });
  it('returns empty for non-array or missing', () => {
    expect(batchDayList({})).toEqual([]);
    expect(batchDayList({ schedule_days: 'Mon' })).toEqual([]);
    expect(batchDayList({ schedule_days: null })).toEqual([]);
  });
});

describe('formatTimeText', () => {
  it('converts 24h to 12h AM/PM', () => {
    expect(formatTimeText('09:30')).toBe('9:30 AM');
    expect(formatTimeText('17:00')).toBe('5:00 PM');
    expect(formatTimeText('00:00')).toBe('12:00 AM');
    expect(formatTimeText('12:00')).toBe('12:00 PM');
    expect(formatTimeText('14:45:00')).toBe('2:45 PM');
  });
  it('passes through non-time text and empty', () => {
    expect(formatTimeText('')).toBe('');
    expect(formatTimeText(null)).toBe('');
    expect(formatTimeText('evening')).toBe('evening');
  });
});

describe('formatTimeRange', () => {
  it('joins start–end when both present', () => {
    expect(formatTimeRange('09:30', '11:00')).toBe('9:30 AM – 11:00 AM');
  });
  it('shows whichever side exists', () => {
    expect(formatTimeRange('09:30', null)).toBe('9:30 AM');
    expect(formatTimeRange(null, '11:00')).toBe('11:00 AM');
    expect(formatTimeRange(null, null)).toBe('');
  });
});

describe('formatBatchSchedule', () => {
  it('shows days + start–end time', () => {
    expect(
      formatBatchSchedule({
        schedule_days: ['Mon', 'Wed'],
        start_time: '09:30',
        end_time: '11:00',
      })
    ).toBe('Mon/Wed · 9:30 AM – 11:00 AM');
  });
  it('uses days only or time only when one is missing', () => {
    expect(formatBatchSchedule({ schedule_days: ['Sat'], start_time: '17:00' })).toBe(
      'Sat · 5:00 PM'
    );
    expect(formatBatchSchedule({ schedule_days: ['Sun'] })).toBe('Sun');
    expect(formatBatchSchedule({ start_time: '08:00', end_time: '09:00' })).toBe(
      '8:00 AM – 9:00 AM'
    );
  });
  it('routes legacy schedule_time into start time', () => {
    expect(formatBatchSchedule({ schedule_days: ['Fri'], schedule_time: '18:00' })).toBe(
      'Fri · 6:00 PM'
    );
  });
  it('falls back to the legacy schedule string when no structured fields exist', () => {
    expect(formatBatchSchedule({ schedule: 'Sat-Thu 8:00-9:30 AM' })).toBe('Sat-Thu 8:00-9:30 AM');
  });
  it('returns empty when nothing is set', () => {
    expect(formatBatchSchedule({})).toBe('');
    expect(formatBatchSchedule({ schedule: null })).toBe('');
  });
});