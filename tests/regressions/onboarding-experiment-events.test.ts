/**
 * Regressions for B80 — the semantic-search A/B loop is evaluable:
 *
 *   The experiment previously recorded impressions only; the click/apply
 *   events required to compute arm-level CTR / apply-rate did not exist.
 *
 *   1. Experiment config + anon cookie live in a shared module
 *      (lib/ai/semantic-search-experiment.ts) so the search route and the
 *      event recorder can never drift.
 *   2. POST /api/jobs/search/semantic/event accepts { eventType, jobId }
 *      (click | apply), validates input, and never buckets new tenants.
 *   3. The apply tracker (POST /api/jobs/[id]/track-apply) records the
 *      experiment 'apply' event server-side.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LIB = 'lib/ai/semantic-search-experiment.ts';
const SEARCH_ROUTE = 'app/api/jobs/search/semantic/route.ts';
const EVENT_ROUTE = 'app/api/jobs/search/semantic/event/route.ts';
const TRACK_APPLY = 'app/api/jobs/[id]/track-apply/route.ts';

describe('B80 — shared experiment module', () => {
  const src = read(LIB);

  it('exports the config, cookie name, and the event recorder', () => {
    expect(src).toContain("export const SEMANTIC_ANON_COOKIE = 'pmhnp_exp_anon'");
    expect(src).toContain("experiment: 'semantic_search.v1'");
    expect(src).toMatch(/export async function recordSemanticSearchEvent/);
  });

  it('reads the EXISTING assignment and never creates one from the event path', () => {
    expect(src).toMatch(/experimentAssignment\.findUnique/);
    expect(src).not.toMatch(/experimentAssignment\.(upsert|create)/);
    expect(src).toContain("reason: 'no_assignment'");
  });
});

describe('B80 — the search route consumes the shared config', () => {
  it('imports config + cookie from the shared module instead of local literals', () => {
    const src = read(SEARCH_ROUTE);
    expect(src).toMatch(/from '@\/lib\/ai\/semantic-search-experiment'/);
    // The local duplicated definitions must be gone.
    expect(src).not.toMatch(/const SEMANTIC_SEARCH_EXPERIMENT = \{/);
    expect(src).not.toMatch(/const ANON_COOKIE = 'pmhnp_exp_anon'/);
  });
});

describe('B80 — click/apply event endpoint', () => {
  it('exists, validates eventType/jobId, and rate limits', () => {
    const src = read(EVENT_ROUTE);
    expect(src).toMatch(/z\.enum\(\['click', 'apply'\]\)/);
    expect(src).toMatch(/jobId: z\.string\(\)\.min\(10\)\.max\(64\)/);
    expect(src).toMatch(/rateLimit\(request, 'semantic-experiment-event', RATE_LIMITS\.telemetry\)/);
    expect(src).toMatch(/recordSemanticSearchEvent\(eventType, jobId\)/);
  });

  it('rejects malformed bodies with 400 and records valid ones', async () => {
    vi.doMock('@/lib/rate-limit', () => ({
      rateLimit: async () => null,
      RATE_LIMITS: { telemetry: { limit: 60, windowSeconds: 60 } },
    }));
    const recordMock = vi.fn(async () => ({ recorded: false, reason: 'no_tenant' as const }));
    vi.doMock('@/lib/ai/semantic-search-experiment', () => ({
      recordSemanticSearchEvent: recordMock,
    }));
    const { POST } = await import('@/app/api/jobs/search/semantic/event/route');
    const { NextRequest } = await import('next/server');

    const bad = await POST(new NextRequest('http://localhost/api/jobs/search/semantic/event', {
      method: 'POST',
      body: JSON.stringify({ eventType: 'purchase', jobId: 'cjld2cjxh0000qzrmn831i7rn' }),
    }));
    expect(bad.status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();

    const ok = await POST(new NextRequest('http://localhost/api/jobs/search/semantic/event', {
      method: 'POST',
      body: JSON.stringify({ eventType: 'click', jobId: 'cjld2cjxh0000qzrmn831i7rn' }),
    }));
    expect(ok.status).toBe(200);
    expect(recordMock).toHaveBeenCalledWith('click', 'cjld2cjxh0000qzrmn831i7rn');

    vi.doUnmock('@/lib/rate-limit');
    vi.doUnmock('@/lib/ai/semantic-search-experiment');
  });
});

describe('B80 — apply point wiring', () => {
  it('track-apply records the experiment apply event', () => {
    const src = read(TRACK_APPLY);
    expect(src).toMatch(/from '@\/lib\/ai\/semantic-search-experiment'/);
    expect(src).toMatch(/await recordSemanticSearchEvent\('apply', id\)/);
  });
});
