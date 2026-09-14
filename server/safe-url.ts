import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';

const DEFAULT_PROVIDER_HOSTS = ['api.mimsms.com', 'api.resend.com'] as const;
const PROVIDER_HOST_ALLOWLIST_ENV = 'PROVIDER_HOST_ALLOWLIST';
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const reservedIpv4 = new net.BlockList();
const reservedIpv6 = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {reservedIpv4.addSubnet(address, prefix, 'ipv4');}
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['100::', 64], ['2001::', 32], ['2001:2::', 48], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) {reservedIpv6.addSubnet(address, prefix, 'ipv6');}

function isPrivateOrReservedIp(address: string): boolean {
  const family = net.isIP(address);
  return family === 4 ? reservedIpv4.check(address, 'ipv4')
    : family === 6 ? reservedIpv6.check(address, 'ipv6') : true;
}

function normalizeConfiguredHost(value: string): string {
  const hostname = value.trim().toLowerCase();
  if (!hostname || hostname.length > 253 || hostname.includes('*') || net.isIP(hostname) !== 0 ||
      !hostname.split('.').every((label) => HOST_LABEL.test(label))) {
    throw new Error(`Invalid ${PROVIDER_HOST_ALLOWLIST_ENV} host: ${value}`);
  }
  return hostname;
}

export function providerHostAllowlist(configuredHosts = process.env[PROVIDER_HOST_ALLOWLIST_ENV]): ReadonlySet<string> {
  const hosts = new Set<string>(DEFAULT_PROVIDER_HOSTS);
  for (const value of configuredHosts?.split(',') ?? []) {if (value.trim()) {hosts.add(normalizeConfiguredHost(value));}}
  return hosts;
}

type LookupResult = { address: string; family: number };
type Lookup = (hostname: string, options: { all: true }) => Promise<LookupResult[]>;
export type ResolvedProviderUrl = { url: URL; address: string; family: 4 | 6 };

async function resolveSafeProviderUrl(value: string, lookup: Lookup, allowedHosts: ReadonlySet<string>): Promise<ResolvedProviderUrl> {
  const url = new URL(value);
  if (url.protocol !== 'https:') {throw new Error('Provider endpoint must use HTTPS');}
  if (url.username || url.password) {throw new Error('Provider endpoint credentials are not allowed in URL');}
  if (url.port) {throw new Error('Provider endpoint must use the default HTTPS port');}
  if (net.isIP(url.hostname) !== 0) {throw new Error('Provider endpoint IP literals are not allowed');}
  if (!allowedHosts.has(url.hostname)) {throw new Error('Provider endpoint host is not allowlisted');}

  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address, family }) => net.isIP(address) !== family || isPrivateOrReservedIp(address))) {
    throw new Error('Provider endpoint resolves to a private or reserved address');
  }
  const selected = addresses[0];
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

export async function assertSafeProviderUrl(value: string, lookup: Lookup = dns.lookup,
  allowedHosts: ReadonlySet<string> = providerHostAllowlist()): Promise<URL> {
  return (await resolveSafeProviderUrl(value, lookup, allowedHosts)).url;
}

type RequestImplementation = typeof https.request;

async function requestBody(body: RequestInit['body']): Promise<string | Uint8Array | undefined> {
  if (body === null || body === undefined) {return undefined;}
  if (typeof body === 'string') {return body;}
  if (body instanceof URLSearchParams) {return body.toString();}
  if (body instanceof ArrayBuffer) {return new Uint8Array(body);}
  if (ArrayBuffer.isView(body)) {return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);}
  if (body instanceof Blob) {return new Uint8Array(await body.arrayBuffer());}
  throw new TypeError('Unsupported provider request body type');
}

/** Performs HTTPS to a prevalidated IP while retaining the URL hostname for Host, SNI, and certificate checks. */
export async function requestPinnedProvider(resolved: ResolvedProviderUrl, init: RequestInit = {},
  request: RequestImplementation = https.request): Promise<Response> {
  const body = await requestBody(init.body);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  return new Promise<Response>((resolve, reject) => {
    const req = request(resolved.url, {
      method: init.method, headers, signal: init.signal ?? undefined, agent: false,
      servername: resolved.url.hostname,
      lookup(hostname, _options, callback) {
        if (hostname !== resolved.url.hostname) {
          callback(new Error('HTTPS transport attempted to resolve an unexpected hostname'), '', 0);
          return;
        }
        callback(null, resolved.address, resolved.family);
      },
    }, (incoming) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) {for (const item of value) {responseHeaders.append(name, item);}}
        else if (value !== undefined) {responseHeaders.append(name, value);}
      }
      resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
        status: incoming.statusCode ?? 500, statusText: incoming.statusMessage, headers: responseHeaders,
      }));
    });
    req.once('error', reject);
    req.end(body);
  });
}

type PinnedTransport = (resolved: ResolvedProviderUrl, init: RequestInit) => Promise<Response>;

/**
 * Resolve and validate each provider URL once, then pin HTTPS to one validated public address.
 * Explicitly permitted redirect hops must retain the exact original origin and are resolved again.
 */
export async function fetchProvider(url: string | URL, init: RequestInit = {}, maxRedirects = 0,
  lookup: Lookup = dns.lookup, transport: PinnedTransport = requestPinnedProvider): Promise<Response> {
  const allowedHosts = providerHostAllowlist();
  let current = await resolveSafeProviderUrl(String(url), lookup, allowedHosts);
  const originalOrigin = current.url.origin;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await transport(current, init);
    if (![301, 302, 303, 307, 308].includes(response.status)) {return response;}
    const location = response.headers.get('location');
    if (!location) {throw new Error('Provider redirect did not include a location');}
    if (hop === maxRedirects) {throw new Error('Provider redirects are disabled or the redirect limit was exceeded');}
    const destination = new URL(location, current.url);
    if (destination.origin !== originalOrigin) {throw new Error('Provider redirect must retain the exact original origin');}
    await response.body?.cancel();
    current = await resolveSafeProviderUrl(destination.toString(), lookup, allowedHosts);
  }
  throw new Error('Provider redirect validation failed');
}
