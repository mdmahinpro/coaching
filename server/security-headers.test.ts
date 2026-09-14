import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const netlify = fs.readFileSync(path.join(process.cwd(), 'netlify.toml'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as {
  headers: Array<{ headers: Array<{ key: string; value: string }> }>;
};

const requiredHeaders = [
  'Content-Security-Policy',
  'Referrer-Policy',
  'Permissions-Policy',
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'X-Frame-Options',
];

describe('deployment security headers', () => {
  it('sets the required browser security headers on Netlify', () => {
    for (const header of requiredHeaders) expect(netlify).toContain(header);
    expect(netlify).toContain("frame-src https://www.google.com");
    expect(netlify).toContain("frame-ancestors 'none'");
    expect(netlify).not.toMatch(/frame-src[^;]*(?:\*|maps\.google\.com)/);
    expect(netlify).toContain("object-src 'none'");
  });

  it('sets equivalent browser security headers on Vercel', () => {
    const headers = Object.fromEntries(vercel.headers[0].headers.map(({ key, value }) => [key, value]));
    for (const header of requiredHeaders) expect(headers).toHaveProperty(header);
    expect(headers['Content-Security-Policy']).toContain("frame-src https://www.google.com");
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['Content-Security-Policy']).not.toMatch(/frame-src[^;]*(?:\*|maps\.google\.com)/);
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'");
  });
});
