/**
 * Regression guards — audit F11 (content-integrity package).
 *
 * The homepage previously emitted a 12-question FAQPage JSON-LD block with
 * NO visible FAQ content (invisible structured data = spammy per Google's
 * policy), and the hidden answers contained fabricated statistics:
 *   - "full practice authority (34 states plus DC)" vs the AANP-verified
 *     figure in lib/stats-sources.ts (27 states + DC);
 *   - invented per-state opening counts ("California (2,500+ openings)" …)
 *     contradicting the live counts in the visible TopStatesSection.
 *
 * The fix moved schema + visible FAQ into components/HomepageFAQ.tsx where
 * ONE array feeds both, FPA figures derive from STAT_SOURCES, and the
 * state-demand answer is built from live counts (or omitted — never
 * hardcoded fallbacks).
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { buildHomepageFaqs, getTopStatesByJobCount, type StateJobCount } from '@/components/HomepageFAQ';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { prisma } from '@/lib/prisma';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LIVE_STATES: StateJobCount[] = [
  { state: 'New York', count: 63 },
  { state: 'Massachusetts', count: 46 },
  { state: 'Florida', count: 45 },
  { state: 'California', count: 40 },
  { state: 'Texas', count: 1 },
];

describe('F11 — homepage FAQ array carries no fabricated statistics', () => {
  it('never quotes the fabricated "34 states" FPA figure', () => {
    const all = buildHomepageFaqs(LIVE_STATES)
      .map((f) => `${f.question} ${f.answer}`)
      .join('\n');
    expect(all).not.toContain('34 states');
    expect(all).not.toContain('the 34 states');
  });

  it('cites the AANP-verified FPA figure from STAT_SOURCES in both FPA answers', () => {
    const faqs = buildHomepageFaqs(LIVE_STATES);
    const fpaAnswers = faqs.filter((f) =>
      f.answer.toLowerCase().includes('full practice authority'),
    );
    expect(fpaAnswers.length).toBeGreaterThanOrEqual(2);
    const prescribe = faqs.find((f) => f.question.includes('prescribe'));
    const practice = faqs.find((f) => f.question.includes('private practice'));
    expect(prescribe?.answer).toContain(STAT_SOURCES.fullPracticeStates.formatted);
    expect(practice?.answer).toContain(STAT_SOURCES.fullPracticeStates.formatted);
  });

  it('never quotes the fabricated per-state opening counts', () => {
    const all = buildHomepageFaqs(LIVE_STATES)
      .map((f) => f.answer)
      .join('\n');
    for (const fabricated of ['2,500+', '2,240+', '2,190+', '1,640+', '1,570+']) {
      expect(all).not.toContain(fabricated);
    }
  });

  it('builds the state-demand answer from the live counts it was given', () => {
    const faqs = buildHomepageFaqs(LIVE_STATES);
    const demand = faqs.find((f) => f.question.includes('job openings'));
    expect(demand).toBeDefined();
    expect(demand!.answer).toContain('New York (63 openings)');
    expect(demand!.answer).toContain('California (40 openings)');
    expect(demand!.answer).toContain('Texas (1 opening)'); // singular form
  });

  it('omits the state-demand question entirely when live counts are unavailable', () => {
    const withoutCounts = buildHomepageFaqs([]);
    expect(withoutCounts.find((f) => f.question.includes('job openings'))).toBeUndefined();
    // The rest of the FAQ still renders (11 evergreen questions).
    expect(withoutCounts.length).toBe(11);

    const belowThreshold = buildHomepageFaqs(LIVE_STATES.slice(0, 2));
    expect(belowThreshold.find((f) => f.question.includes('job openings'))).toBeUndefined();
  });

  it('cites salary and outlook figures from STAT_SOURCES', () => {
    const faqs = buildHomepageFaqs(LIVE_STATES);
    const salary = faqs.find((f) => f.question.includes('make'));
    const outlook = faqs.find((f) => f.question.includes('outlook'));
    expect(salary?.answer).toContain(STAT_SOURCES.averageSalary.range);
    expect(outlook?.answer).toContain(STAT_SOURCES.blsGrowth2032.formatted);
  });
});

describe('F11 — getTopStatesByJobCount error handling', () => {
  it('maps groupBy rows to state/count pairs', async () => {
    vi.mocked(prisma.job.groupBy).mockResolvedValue([
      { state: 'New York', _count: { state: 63 } },
      { state: 'California', _count: { state: 40 } },
      { state: '', _count: { state: 5 } }, // blank state rows are dropped
    ] as never);
    const result = await getTopStatesByJobCount();
    expect(result).toEqual([
      { state: 'New York', count: 63 },
      { state: 'California', count: 40 },
    ]);
  });

  it('returns [] (question omitted) when the query fails — no hardcoded fallback', async () => {
    vi.mocked(prisma.job.groupBy).mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await getTopStatesByJobCount();
    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('F11 — schema and visible FAQ cannot diverge (static)', () => {
  it('app/page.tsx no longer emits an inline FAQPage block and renders <HomepageFAQ />', () => {
    const src = read('app/page.tsx');
    expect(src).not.toContain('FAQPage');
    expect(src).toContain('<HomepageFAQ />');
  });

  it('HomepageFAQ feeds JSON-LD and the visible accordion from the same array', () => {
    const src = read('components/HomepageFAQ.tsx');
    // One `faqs` array drives the schema…
    expect(src).toMatch(/mainEntity:\s*faqs\.map/);
    // …and the visible <details> accordion.
    expect(src).toMatch(/\{faqs\.map\(\(faq\)/);
    // Answers are rendered in SSR HTML (native details/summary, no client gate).
    expect(src).toContain('<details');
    expect(src).not.toContain("'use client'");
  });

  it('HomepageFAQ source contains no fabricated stats', () => {
    const src = read('components/HomepageFAQ.tsx');
    expect(src).not.toContain('34 states');
    expect(src).not.toContain('2,500+');
    expect(src).toContain('STAT_SOURCES.fullPracticeStates');
  });
});
