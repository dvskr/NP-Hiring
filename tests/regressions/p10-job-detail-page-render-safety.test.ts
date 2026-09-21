import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { formatSalary } from '@/lib/utils';
import { normalizeDisplaySalary } from '@/lib/salary-display';
import {
  STICKY_APPLY_BAR_CLASS,
  STICKY_APPLY_BAR_CLEARANCE_CSS,
  STICKY_APPLY_BAR_HEIGHT_VAR,
  stickyApplyBarClearance,
} from '@/app/jobs/[slug]/sticky-apply-bar';

const read = (rel: string): string => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
const PAGE = 'app/jobs/[slug]/page.tsx';
const DASHED_RANGE_RE = /\d[kK]?\s*[-–—]\s*\$?\d/;

describe('P10 job detail #1: ApplyButton search-param read cannot bail the page out of SSR', () => {
  it('every ApplyButton render is inside a Suspense boundary', () => {
    const src = read(PAGE);
    expect(src).toMatch(/import \{[^}]*\bSuspense\b[^}]*\} from 'react'/);
    const uses = src.match(/<ApplyButton\b/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    const wrapped = src.match(/<Suspense fallback=\{<ApplyButtonPlaceholder \/>\}>\s*<ApplyButton\b/g) ?? [];
    expect(wrapped.length).toBe(uses.length);
  });

  it('ApplyButton still reads useSearchParams (so the boundary remains required)', () => {
    expect(read('components/ApplyButton.tsx')).toContain('useSearchParams()');
  });

  it('the H1 and JobStructuredData stay outside any Suspense boundary', () => {
    const src = read(PAGE);
    const firstSuspense = src.indexOf('<Suspense');
    expect(src.indexOf('<JobStructuredData')).toBeGreaterThan(-1);
    expect(src.indexOf('<JobStructuredData')).toBeLessThan(firstSuspense);
    expect(src.indexOf('>{displayTitle}</h1>')).toBeLessThan(firstSuspense);
  });
});

describe('P10 job detail #2: sticky apply bar reserves bottom clearance for the footer', () => {
  it('clearance CSS targets body below lg and prefers the measured height', () => {
    expect(STICKY_APPLY_BAR_CLEARANCE_CSS).toContain('(max-width: 1023.98px)');
    expect(STICKY_APPLY_BAR_CLEARANCE_CSS).toContain(`body:has(.${STICKY_APPLY_BAR_CLASS})`);
    expect(STICKY_APPLY_BAR_CLEARANCE_CSS).toContain(`var(${STICKY_APPLY_BAR_HEIGHT_VAR},`);
    expect(STICKY_APPLY_BAR_CLEARANCE_CSS).toContain('env(safe-area-inset-bottom)');
    // No characters React would need to escape inside <style>.
    expect(STICKY_APPLY_BAR_CLEARANCE_CSS).not.toMatch(/[<>&"']/);
  });

  it('measured heights round up; hidden or unmeasured bars fall back', () => {
    expect(stickyApplyBarClearance(131.2)).toBe('132px');
    expect(stickyApplyBarClearance(0)).toBeNull();
    expect(stickyApplyBarClearance(-4)).toBeNull();
    expect(stickyApplyBarClearance(Number.NaN)).toBeNull();
  });

  it('the page renders the fixed bar through StickyApplyBar', () => {
    const src = read(PAGE);
    expect(src).toContain('<StickyApplyBar>');
    expect(src).not.toMatch(/className="lg:hidden fixed bottom-0/);
    expect(read('app/jobs/[slug]/StickyApplyBar.tsx')).toContain('STICKY_APPLY_BAR_CLASS');
  });
});

describe('P10 job detail #3: hero salary ranges read "to", never a dash', () => {
  it('formatSalary joins ranges with " to " for every period', () => {
    expect(formatSalary(100, 110, 'hourly')).toBe('$100 to $110/hr');
    expect(formatSalary(120_000, 150_000, 'annual')).toBe('$120k to $150k/yr');
    expect(formatSalary(2_000, 3_000, 'weekly')).toBe('$2,000 to $3,000/week');
    for (const out of [formatSalary(100, 110, 'hour'), formatSalary(90, 140, 'year')]) {
      expect(out).not.toMatch(DASHED_RANGE_RE);
    }
  });

  it('single values and unknown cadence are unchanged', () => {
    expect(formatSalary(150_000, null, 'year')).toBe('$150k/yr');
    expect(formatSalary(null, 60, 'hourly')).toBe('Up to $60/hr');
    expect(formatSalary(100, 100, 'hourly')).toBe('$100/hr');
    expect(formatSalary(35_000, 45_000, 'unknown')).toBe('');
  });

  it('the hero badge value passes through normalizeDisplaySalary', () => {
    const src = read(PAGE);
    expect(src).toContain('normalizeDisplaySalary(formatSalary(job.minSalary, job.maxSalary, job.salaryPeriod))');
    expect(normalizeDisplaySalary('$100-$110/hr')).toBe('$100 to $110/hr');
  });
});

describe('P10 job detail #4: verified employer badge is a labelled image, not a labelled div', () => {
  it('the aria-label carries role="img"', () => {
    const src = read(PAGE);
    expect(src).toMatch(/role="img"\s+aria-label="Verified employer"/);
    expect(src).not.toMatch(/<div\s+aria-label="Verified employer"/);
  });
});
