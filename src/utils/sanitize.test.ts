import { describe, it, expect } from 'vitest';
import { sanitize, stripHtml } from './sanitize';

describe('sanitize', () => {
  it('returns empty string for null/undefined input', () => {
    expect(sanitize(null as any)).toBe('');
    expect(sanitize(undefined as any)).toBe('');
    expect(sanitize('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(sanitize('Hello world')).toBe('Hello world');
  });

  it('strips <script> tags but keeps text content', () => {
    const input = 'Safe text<script>alert("xss")</script>more text';
    const result = sanitize(input);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert');
    expect(result).toContain('Safe text');
    expect(result).toContain('more text');
  });

  it('strips event handlers like onclick', () => {
    const input = '<img src="x" onerror="alert(1)">';
    const result = sanitize(input);
    expect(result).not.toContain('onerror');
  });

  it('strips javascript: URIs', () => {
    const input = '<a href="javascript:alert(1)">click</a>';
    const result = sanitize(input);
    expect(result).not.toContain('javascript:');
  });

  it('allows safe http/https links', () => {
    const input = '<a href="https://example.com">link</a>';
    const result = sanitize(input);
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });

  it('strips dangerous tags (iframe, embed, object, form, input, button)', () => {
    const dangerous = [
      '<iframe src="evil.com"></iframe>',
      '<embed src="evil.swf">',
      '<object data="evil.swf"></object>',
      '<form><input></form>',
      '<button onclick="evil()">click</button>',
    ];
    for (const input of dangerous) {
      const result = sanitize(input);
      expect(result).not.toContain('<iframe');
      expect(result).not.toContain('<embed');
      expect(result).not.toContain('<object');
      expect(result).not.toContain('<form');
      expect(result).not.toContain('<input');
      expect(result).not.toContain('<button');
    }
  });

  it('preserves safe formatting tags', () => {
    const input = '<p>Hello <strong>world</strong>!</p>';
    const result = sanitize(input);
    expect(result).toContain('<p>');
    expect(result).toContain('<strong>');
    expect(result).toContain('Hello');
    expect(result).toContain('world');
  });

  it('removes on* event attributes from safe tags', () => {
    const input = '<p onmouseover="alert(1)">text</p>';
    const result = sanitize(input);
    expect(result).not.toContain('onmouseover');
  });

  it('strips non-allowlisted tags by unwrapping', () => {
    const input = '<marquee>scrolling text</marquee>';
    const result = sanitize(input);
    expect(result).not.toContain('<marquee');
    expect(result).toContain('scrolling text');
  });
});

describe('stripHtml', () => {
  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
    expect(stripHtml(null as any)).toBe('');
  });

  it('removes all HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('decodes HTML entities', () => {
    expect(stripHtml('&lt;div&gt;')).toBe('<div>');
    expect(stripHtml('&amp;')).toBe('&');
    expect(stripHtml('&quot;')).toBe('"');
    expect(stripHtml('&#039;')).toBe("'");
  });

  it('trims whitespace', () => {
    expect(stripHtml('  <p>  hello  </p>  ')).toBe('hello');
  });
});
