import { afterEach, describe, expect, it, vi } from 'vitest';

const { from, handleSupabaseError } = vi.hoisted(() => ({
  from: vi.fn(),
  handleSupabaseError: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
vi.mock('@/utils/errorHandler', () => ({ handleSupabaseError }));

import { secureRandomString } from '@/lib/cryptoRandom';
import { generateReferenceNo, generateStudentId, legacyAdmissionPassword } from '@/lib/studentId';

function stubRandomBytes(fill: (bytes: Uint8Array) => void) {
  vi.stubGlobal('crypto', {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      fill(array as Uint8Array);
      return array;
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Web Crypto identifier generation', () => {
  it('uses rejection sampling instead of biased bytes', () => {
    let call = 0;
    stubRandomBytes((bytes) => {
      bytes.fill(call++ === 0 ? 255 : 1);
    });

    expect(secureRandomString('ABC', 4)).toBe('BBBB');
    expect(call).toBe(2);
  });

  it('generates admission references from Web Crypto bytes', () => {
    stubRandomBytes((bytes) => bytes.fill(0));

    expect(generateReferenceNo()).toBe('APP-AAAAAA');
  });

  it('uses Web Crypto for the rare admission-password fallback', () => {
    stubRandomBytes((bytes) => bytes.fill(0));

    expect(legacyAdmissionPassword('123')).toBe('AAAAAA');
    expect(legacyAdmissionPassword('01712-345678')).toBe('345678');
  });

  it('uses a CSPRNG suffix for the rare student-id fallback', async () => {
    from.mockImplementation(() => {
      throw new Error('database unavailable');
    });
    stubRandomBytes((bytes) => bytes.fill(7));

    await expect(generateStudentId({ shortName: 'TLY', batchCode: 'Q', year: '26' })).resolves.toBe(
      'TLYQ2677777777'
    );
    expect(handleSupabaseError).toHaveBeenCalledOnce();
  });

  it('fails closed when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);

    expect(() => generateReferenceNo()).toThrow('Web Crypto getRandomValues is required');
  });
});
