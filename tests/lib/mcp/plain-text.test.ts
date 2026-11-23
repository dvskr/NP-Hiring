/**
 * plainText turns employer-written and scraped HTML into text for the
 * conversation. Script and style blocks are dropped whole, and doing so
 * stays fast on hostile input: a signed-out caller can ask for any job's
 * description, so the cost of one description must not grow with the
 * square of its length.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { plainText } from '@/lib/mcp/tools/shared';

describe('plainText', () => {
  it('drops script and style blocks whole, whatever their case or attributes', () => {
    const html = '<p>Before</p><SCRIPT type="text/javascript">alert("x")</SCRIPT><style media="all">p{color:red}</style><p>After &amp; done</p>';
    expect(plainText(html)).toBe('Before\nAfter & done');
  });

  it('treats a block that never closes as running to the end', () => {
    expect(plainText('<p>Shown</p><script>never closed <p>hidden</p>')).toBe('Shown');
  });

  it('leaves ordinary markup to the tag stripper', () => {
    expect(plainText('<ul><li>One</li><li>Two</li></ul>')).toBe('• One\n• Two');
  });

  it('stays quick on a long run of unclosed script tags', () => {
    const hostile = '<script>'.repeat(60_000);
    const started = Date.now();
    expect(plainText(hostile)).toBe('');
    // The lazy regex this replaced took seconds on input this size.
    expect(Date.now() - started).toBeLessThan(500);
  });
});
