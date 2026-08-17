/**
 * XSS Prevention Utility
 *
 * Uses DOMPurify (ESM import) whenever a DOM is present (browser + jsdom tests).
 * A browser-native fallback sanitizer covers non-DOM environments.
 */

import DOMPurify from 'dompurify';

// ── Fallback sanitizer (used when no DOM/DOMPurify is available) ──
// This provides basic XSS protection by stripping dangerous tags/attributes.
// The real DOMPurify (npm) is more thorough — install it when possible.

const FALLBACK_ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'span',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'code',
  'pre',
  'hr',
  'sub',
  'sup',
];

const FALLBACK_ALLOWED_ATTRS = ['href', 'title', 'class', 'id', 'target', 'rel', 'style'];

function fallbackSanitize(dirty: string): string {
  if (!dirty || typeof dirty !== 'string') {
    return '';
  }

  try {
    const doc = new DOMParser().parseFromString(dirty, 'text/html');

    // Static snapshot — safe to unwrap/replace while iterating (unlike a live
    // walker). querySelectorAll is used instead of createTreeWalker because
    // jsdom (used by the test suite) does not implement TreeWalker.
    const elements = Array.from(doc.body.querySelectorAll('*'));
    const toRemove: Element[] = [];

    for (const node of elements) {
      const tag = node.tagName.toLowerCase();

      // script/style bodies are executable code, not text — drop entirely
      if (tag === 'script' || tag === 'style') {
        node.remove();
        continue;
      }

      // Other dangerous tags — strip tag but keep text content
      const dangerousTags = [
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'button',
        'textarea',
        'select',
      ];
      if (dangerousTags.includes(tag)) {
        toRemove.push(node);
        continue;
      }

      // Not in allowlist — unwrap (keep children, remove tag)
      if (!FALLBACK_ALLOWED_TAGS.includes(tag)) {
        const frag = doc.createDocumentFragment();
        while (node.firstChild) {
          frag.appendChild(node.firstChild);
        }
        node.parentNode?.replaceChild(frag, node);
        continue;
      }

      // Clean attributes
      const attrs = Array.from(node.attributes);
      for (const attr of attrs) {
        const name = attr.name.toLowerCase();

        // Strip event handlers (onclick, onerror, etc.)
        if (name.startsWith('on')) {
          node.removeAttribute(attr.name);
          continue;
        }

        // Strip javascript: and data: URIs
        if (attr.value && /javascript\s*:/i.test(attr.value)) {
          node.removeAttribute(attr.name);
          continue;
        }

        // Strip non-allowed attributes
        if (!FALLBACK_ALLOWED_ATTRS.includes(name)) {
          node.removeAttribute(attr.name);
        }

        // Sanitize href — only allow http, https, mailto, tel, #
        if (name === 'href' && attr.value) {
          const trimmed = attr.value.trim().toLowerCase();
          if (!/^(https?:|mailto:|tel:|#)/.test(trimmed) && !trimmed.startsWith('#')) {
            node.removeAttribute(attr.name);
          }
        }

        // Force rel="noopener noreferrer" on external links
        if (name === 'href' && attr.value && /^https?:\/\//i.test(attr.value)) {
          node.setAttribute('rel', 'noopener noreferrer');
          node.setAttribute('target', '_blank');
        }
      }
    }

    // Remove dangerous elements (preserve their text children)
    for (const el of toRemove) {
      const frag = doc.createDocumentFragment();
      while (el.firstChild) {
        frag.appendChild(el.firstChild);
      }
      el.parentNode?.replaceChild(frag, el);
    }

    let html = doc.body.innerHTML;

    // Unwrap single <p> wrapper when input was plain text (no HTML tags).
    // DOMParser wraps bare text in <p>, but DOMPurify returns plain text as-is.
    // This keeps behavior consistent across both implementations.
    if (html.startsWith('<p>') && html.endsWith('</p>')) {
      const inner = html.slice(3, -4);
      if (!/<[a-z]/i.test(inner)) {
        html = inner;
      }
    }

    return html;
  } catch {
    // If DOMParser fails, return text-only to be safe
    return dirty
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// ── Use DOMPurify (ESM static import) when a DOM is available ──
// DOMPurify requires a `window`. In the browser and in jsdom (tests) it is
// present; in a non-DOM SSR context it is not, so we keep the fallback.
let sanitizeFn: (dirty: string) => string = fallbackSanitize;

if (typeof window !== 'undefined' && window.document) {
  DOMPurify.setConfig({
    ALLOWED_TAGS: FALLBACK_ALLOWED_TAGS,
    ALLOWED_ATTR: FALLBACK_ALLOWED_ATTRS,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'formaction'],
  });

  // Force external links to open safely (DOMPurify strips target/rel by default).
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof Element && node.tagName === 'A' && node.getAttribute('href')) {
      const href = node.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });

  sanitizeFn = (dirty: string) => DOMPurify.sanitize(dirty) as string;
}

/**
 * Sanitize an HTML string to prevent XSS attacks.
 *
 * Strips dangerous elements (script, iframe, etc.), event handlers,
 * and javascript: URIs. Preserves safe formatting tags.
 *
 * @param dirty - Raw HTML string that may contain user input
 * @returns Sanitized HTML string safe for rendering
 *
 * @example
 *   const clean = sanitize(userProvidedHtml);
 *   <div dangerouslySetInnerHTML={{ __html: clean }} />
 */
export function sanitize(dirty: string): string {
  if (!dirty || typeof dirty !== 'string') {
    return '';
  }
  return sanitizeFn(dirty);
}

/**
 * Strip ALL HTML tags from a string, returning plain text.
 * Use this when you want to display text with zero HTML.
 */
export function stripHtml(html: string): string {
  if (!html || typeof html !== 'string') {
    return '';
  }
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

export default sanitize;
