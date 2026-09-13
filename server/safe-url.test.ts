import { describe, expect, it, vi } from 'vitest';
import { assertSafeProviderUrl, fetchProvider } from './safe-url';

describe('provider URL safety', () => {
  it('accepts HTTPS public hosts and rejects unsafe URL forms', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertSafeProviderUrl('https://provider.example/send', lookup)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeProviderUrl('http://provider.example/send', lookup)).rejects.toThrow('HTTPS');
    await expect(assertSafeProviderUrl('https://user:pass@provider.example/send', lookup)).rejects.toThrow('credentials');
  });

  it('does not follow a redirect without validating the destination', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }));
    await expect(fetchProvider('https://provider.example/send', {}, 3, lookup)).rejects.toThrow('HTTPS');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });
});
