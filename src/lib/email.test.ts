import { describe, expect, it } from 'vitest';
import { emailTemplate } from './email';

describe('emailTemplate', () => {
  it('HTML-escapes dynamic institute, title, and body values', () => {
    const html = emailTemplate('<Center & Co>', `Notice "today" <script>alert('x')</script>`, 'A&B <Academy>');
    expect(html).toContain('A&amp;B &lt;Academy&gt;');
    expect(html).toContain('&lt;Center &amp; Co&gt;');
    expect(html).toContain('Notice &quot;today&quot; &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});
