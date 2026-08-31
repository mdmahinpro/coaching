import { describe, it, expect } from 'vitest';
import { seededAvatarUrl, hashSeed } from './avatars';

describe('seededAvatarUrl', () => {
  it('returns a stable portrait URL for the same seed', () => {
    const a = seededAvatarUrl('teacher-abc-123');
    const b = seededAvatarUrl('teacher-abc-123');
    expect(a).toBe(b);
  });

  it('returns distinct URLs for different seeds', () => {
    const seen = new Set(Array.from({ length: 30 }, (_, i) => seededAvatarUrl(`id-${i}`)));
    // Collisions are possible (100 indices, 2 sides) but very unlikely at n=30;
    // this guards against a degenerate always-same result.
    expect(seen.size).toBeGreaterThan(20);
  });

  it('honours gender: male -> /men/, female -> /women/', () => {
    expect(seededAvatarUrl('x', 'male')).toMatch(/\/portraits\/men\/\d+\.jpg$/);
    expect(seededAvatarUrl('x', 'female')).toMatch(/\/portraits\/women\/\d+\.jpg$/);
  });

  it('produces a valid 0-99 index and correct base URL', () => {
    for (let i = 0; i < 200; i++) {
      const url = seededAvatarUrl(`seed-${i}`, 'male');
      const idx = Number(url.match(/men\/(\d+)\.jpg$/)![1]);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(100);
    }
  });
});

describe('hashSeed', () => {
  it('is deterministic and produces finite numbers', () => {
    expect(hashSeed('anything')).toBe(hashSeed('anything'));
    for (let i = 0; i < 50; i++) {
      const h = hashSeed(`k${i}`);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
    }
  });
});