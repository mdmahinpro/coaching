import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { RequestOptions } from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertSafeProviderUrl,
  fetchProvider,
  providerHostAllowlist,
  requestPinnedProvider,
  type ResolvedProviderUrl,
} from './safe-url';

const publicLookup = vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
const okTransport = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  publicLookup.mockClear();
  okTransport.mockClear();
});

describe('provider URL safety', () => {
  it('defaults to only the exact built-in MIM SMS and Resend hosts', async () => {
    vi.stubEnv('PROVIDER_HOST_ALLOWLIST', '');
    await expect(assertSafeProviderUrl('https://api.mimsms.com/smsapi', publicLookup)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeProviderUrl('https://api.resend.com/emails', publicLookup)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeProviderUrl('https://evil.api.resend.com/emails', publicLookup)).rejects.toThrow('not allowlisted');
    await expect(assertSafeProviderUrl('https://resend.com/emails', publicLookup)).rejects.toThrow('not allowlisted');
  });

  it('adds comma-separated exact hosts from the server environment', async () => {
    vi.stubEnv('PROVIDER_HOST_ALLOWLIST', 'sms.example.com, Email.EXAMPLE.com ');
    await expect(assertSafeProviderUrl('https://sms.example.com/send', publicLookup)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeProviderUrl('https://email.example.com/send', publicLookup)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeProviderUrl('https://child.sms.example.com/send', publicLookup)).rejects.toThrow('not allowlisted');
  });

  it.each(['*.example.com', '127.0.0.1', '[::1]', 'user@example.com', 'example.com:8443'])(
    'rejects invalid configured host %s', (host) => {
      expect(() => providerHostAllowlist(host)).toThrow('Invalid PROVIDER_HOST_ALLOWLIST host');
    }
  );

  it('rejects unsafe URL forms before DNS lookup', async () => {
    await expect(assertSafeProviderUrl('http://api.resend.com/emails', publicLookup)).rejects.toThrow('HTTPS');
    await expect(assertSafeProviderUrl('https://user:pass@api.resend.com/emails', publicLookup)).rejects.toThrow('credentials');
    await expect(assertSafeProviderUrl('https://api.resend.com:8443/emails', publicLookup)).rejects.toThrow('default HTTPS port');
    await expect(assertSafeProviderUrl('https://127.0.0.1/emails', publicLookup)).rejects.toThrow('IP literals');
  });

  it.each([
    '10.0.0.1', '100.64.0.1', '192.0.2.1', '::1', '::ffff:127.0.0.1',
    '64:ff9b::7f00:1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::',
  ])('rejects private or reserved DNS result %s', async (address) => {
    const lookup = vi.fn().mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
    await expect(assertSafeProviderUrl('https://api.resend.com/emails', lookup)).rejects.toThrow('private or reserved address');
  });

  it('rejects the entire DNS set when any answer is private', async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 },
    ]);
    await expect(fetchProvider('https://api.resend.com/emails', {}, 0, lookup, okTransport)).rejects.toThrow(
      'private or reserved address'
    );
    expect(okTransport).not.toHaveBeenCalled();
  });

  it('pins the HTTPS socket lookup to the validated IP while preserving hostname SNI', async () => {
    let optionsSeen: RequestOptions | undefined;
    let connectedAddress: string | undefined;
    const request = vi.fn((url: URL, options: RequestOptions, callback: (incoming: Readable) => void) => {
      optionsSeen = options;
      const req = new EventEmitter() as EventEmitter & { end: (body?: unknown) => void };
      req.end = () => {
        const lookup = options.lookup!;
        lookup(url.hostname, {}, (error, address) => {
          if (error) return req.emit('error', error);
          connectedAddress = Array.isArray(address) ? address[0].address : address;
          const incoming = Readable.from([Buffer.from('{"ok":true}')]) as Readable & {
            statusCode: number; statusMessage: string; headers: Record<string, string>;
          };
          incoming.statusCode = 200;
          incoming.statusMessage = 'OK';
          incoming.headers = { 'content-type': 'application/json' };
          callback(incoming);
        });
      };
      return req;
    });
    const resolved: ResolvedProviderUrl = {
      url: new URL('https://api.resend.com/emails'), address: '8.8.8.8', family: 4,
    };

    const response = await requestPinnedProvider(resolved, {
      method: 'POST', headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' }, body: '{"x":1}',
    }, request as never);

    expect(await response.json()).toEqual({ ok: true });
    expect(connectedAddress).toBe('8.8.8.8');
    expect(optionsSeen?.servername).toBe('api.resend.com');
    expect(optionsSeen?.headers).toMatchObject({ authorization: 'Bearer secret', 'content-type': 'application/json' });
  });

  it('resolves once and cannot use a rebinding second DNS answer', async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const transport = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

    await fetchProvider('https://api.resend.com/emails', {}, 0, lookup, transport);

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ address: '8.8.8.8', family: 4 }), {});
  });

  it('rejects redirects by default without replaying credentials or body', async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: '/next' } }));
    const init = { method: 'POST', headers: { Authorization: 'Bearer secret' }, body: 'sensitive' };
    await expect(fetchProvider('https://api.resend.com/emails', init, undefined, publicLookup, transport)).rejects.toThrow(
      'redirects are disabled'
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-provider redirects even when both origins are allowlisted', async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(null, { status: 307, headers: { location: 'https://api.mimsms.com/smsapi' } })
    );
    await expect(fetchProvider('https://api.resend.com/emails', { method: 'POST', body: 'sensitive' }, 1,
      publicLookup, transport)).rejects.toThrow('exact original origin');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(publicLookup).toHaveBeenCalledTimes(1);
  });

  it('re-resolves and re-pins each explicitly enabled same-origin redirect', async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }]);
    const transport = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: '/emails/v2' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const init = { method: 'POST', headers: { Authorization: 'Bearer secret' }, body: 'sensitive' };

    await expect(fetchProvider('https://api.resend.com/emails', init, 1, lookup, transport)).resolves.toMatchObject({ status: 200 });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenNthCalledWith(1, expect.objectContaining({ address: '8.8.8.8' }), init);
    expect(transport).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ url: new URL('https://api.resend.com/emails/v2'), address: '1.1.1.1' }), init);
  });
});
