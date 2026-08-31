/**
 * Deterministic seeded headshot avatars.
 *
 * Rather than leaving a teacher/student with an empty photo (falling back to a
 * generic initials monogram), we point their `photo_url` at a stable, distinct
 * professional headshot. The URL is derived PURELY from the person's id + gender
 * via a stable hash, so:
 *   • the SAME person always keeps the SAME face (no flicker on reload), and
 *   • different people get distinct, varied headshots.
 *
 * Source: randomuser.me portrait CDN — a static, reliable set of 200 distinct
 * headshots (`/men/{0-99}.jpg` and `/women/{0-99}.jpg`). Deterministic and
 * dependency-free at runtime (the URL is just a string we store).
 */

const PORTRAIT_CDN = 'https://randomuser.me/api/portraits';

/** Stable 32-bit string hash (djb2) so a given id always maps to the same face. */
export function hashSeed(input: string): number {
  let h = 5381;
  const s = String(input ?? '');
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0; // h * 33 + char, 32-bit
  }
  return Math.abs(h);
}

const MAX_INDEX = 100; // portrait index is 0..99

/**
 * Derive a stable headshot URL for a person.
 * @param seed stable identifier (teacher/student id, or name fallback).
 * @param gender 'male' | 'female' | null — if given, forces the portrait side.
 */
export function seededAvatarUrl(seed: string, gender?: 'male' | 'female' | null): string {
  const h = hashSeed(seed ?? '');
  const isFemale = gender ? gender === 'female' : h % 2 === 1;
  const idx = h % MAX_INDEX;
  return `${PORTRAIT_CDN}/${isFemale ? 'women' : 'men'}/${idx}.jpg`;
}