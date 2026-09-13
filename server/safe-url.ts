import dns from 'node:dns/promises';
import net from 'node:net';

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
}

type Lookup = (hostname: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>>;

export async function assertSafeProviderUrl(value: string, lookup: Lookup = dns.lookup): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Provider endpoint must use HTTPS');
  if (url.username || url.password) throw new Error('Provider endpoint credentials are not allowed in URL');
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.some(({ address }) => isPrivateIp(address))) throw new Error('Provider endpoint resolves to a private address');
  return url;
}

/** Fetch a provider endpoint without allowing a redirect to bypass URL checks. */
export async function fetchProvider(url: string | URL, init: RequestInit = {}, maxRedirects = 3, lookup: Lookup = dns.lookup): Promise<Response> {
  let current = await assertSafeProviderUrl(String(url), lookup);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await fetch(current, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    const location = response.headers.get('location');
    if (!location) throw new Error('Provider redirect did not include a location');
    if (hop === maxRedirects) throw new Error('Provider redirect limit exceeded');
    current = await assertSafeProviderUrl(new URL(location, current).toString(), lookup);
  }
  throw new Error('Provider redirect validation failed');
}
