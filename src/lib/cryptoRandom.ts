function webCrypto(): Crypto {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new Error('Web Crypto getRandomValues is required for secure identifier generation');
  }
  return crypto;
}

/**
 * Generate an unbiased random string with Web Crypto. Rejection sampling avoids
 * the modulo bias introduced by mapping every possible byte directly.
 */
export function secureRandomString(alphabet: string, length: number): string {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError('length must be a non-negative safe integer');
  }
  if (alphabet.length < 2 || alphabet.length > 256) {
    throw new RangeError('alphabet length must be between 2 and 256 characters');
  }

  const crypto = webCrypto();
  const acceptedByteLimit = Math.floor(256 / alphabet.length) * alphabet.length;
  const bytes = new Uint8Array(Math.max(16, length * 2));
  let result = '';

  while (result.length < length) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < acceptedByteLimit) {
        result += alphabet[byte % alphabet.length];
        if (result.length === length) {
          break;
        }
      }
    }
  }

  return result;
}
