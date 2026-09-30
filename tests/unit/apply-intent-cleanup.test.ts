/**
 * Review fix (tracking / apply intent): the ?apply=1 effect in ApplyButton
 * acted on the intent but left it in the address bar. It is also where the
 * Easy Apply click is counted, so every reload, Back press or shared copy of
 * that URL opened the form again and added another apply click to
 * jobs.applyClickCount (a number the paying employer sees as "Apply clicks").
 *
 * withoutApplyIntent (lib/apply-intent.ts) builds the clean path, and the
 * effect replaces the history entry with it once the visible instance acts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withApplyIntent, withoutApplyIntent } from '@/lib/apply-intent';

describe('withoutApplyIntent', () => {
  it('drops apply=1 and keeps every other parameter', () => {
    expect(withoutApplyIntent('/jobs/pmhnp-austin-tx-1', '?apply=1')).toBe('/jobs/pmhnp-austin-tx-1');
    expect(withoutApplyIntent('/jobs/x', '?ref=card&apply=1&utm_source=mail')).toBe('/jobs/x?ref=card&utm_source=mail');
    expect(withoutApplyIntent('/jobs/x?apply=1&ref=card')).toBe('/jobs/x?ref=card');
    // Search given without the leading "?".
    expect(withoutApplyIntent('/jobs/x', 'apply=1&ref=card')).toBe('/jobs/x?ref=card');
  });

  it('drops the parameter whatever its value, and leaves a path without it unchanged', () => {
    expect(withoutApplyIntent('/jobs/x', '?apply=true')).toBe('/jobs/x');
    expect(withoutApplyIntent('/jobs/x', '?ref=card')).toBe('/jobs/x?ref=card');
    expect(withoutApplyIntent('/jobs/x')).toBe('/jobs/x');
  });

  it('is the inverse of withApplyIntent for the parameters it keeps', () => {
    const withIntent = withApplyIntent('/jobs/x', '?ref=card');
    expect(withIntent).toBe('/jobs/x?ref=card&apply=1');
    expect(withoutApplyIntent(withIntent!)).toBe('/jobs/x?ref=card');
  });

  it('never yields a path for a hostile or off-site input', () => {
    for (const hostile of ['//evil.com', '//evil.com/jobs/x?apply=1', 'https://evil.com/jobs/x', '/\\evil.com', 'javascript:alert(1)', '']) {
      expect(withoutApplyIntent(hostile, '?apply=1'), hostile).toBeNull();
    }
  });
});

describe('ApplyButton strips the intent after acting on it', () => {
  const src = readFileSync(resolve(__dirname, '../../components/ApplyButton.tsx'), 'utf8');
  const start = src.indexOf('const open = setTimeout');
  const end = src.indexOf('return () => clearTimeout(open);', start);
  const callback = src.slice(start, end);

  it('replaces the history entry with the clean path, only on the visible instance', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const rendered = callback.indexOf('if (!isRenderedElement(rootRef.current)) return;');
    const clean = callback.indexOf('const clean = withoutApplyIntent(window.location.pathname, window.location.search);');
    const replace = callback.indexOf("if (clean) window.history.replaceState(null, '', clean);");
    expect(rendered).toBeGreaterThan(-1);
    expect(clean).toBeGreaterThan(rendered);
    expect(replace).toBeGreaterThan(clean);
    // Stripped before any branch acts: the gate, the counted click, the
    // Easy Apply form and the continue panel all come after it.
    for (const action of ['setShowAuthModal(true);', 'postApplyClick(jobId);', 'setShowPlatformApply(true);', 'setShowContinuePanel(true);']) {
      expect(callback.indexOf(action), action).toBeGreaterThan(replace);
    }
  });

  it('passes null, not history.state, so the App Router syncs useSearchParams', () => {
    // history.state carries Next's __NA marker, which sends replaceState down
    // the router's internal fast path and skips the useSearchParams sync; a
    // later router action would then write ?apply=1 back into the URL.
    expect(src).not.toMatch(/replaceState\(window\.history\.state/);
    expect(src.match(/window\.history\.replaceState\(/g) ?? []).toHaveLength(1);
  });

  it('the latch is set before the strip, so the effect never acts twice', () => {
    expect(callback.indexOf('autoOpened.current = true;')).toBeGreaterThan(-1);
    expect(callback.indexOf('autoOpened.current = true;')).toBeLessThan(callback.indexOf('window.history.replaceState('));
    expect(src).toMatch(/if \(autoOpened\.current\) return;\s*if \(!hasApplyIntent\(searchParams\)\) return;/);
  });
});
