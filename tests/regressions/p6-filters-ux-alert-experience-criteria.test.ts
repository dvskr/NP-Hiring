/**
 * P6 #4 — JobAlert.newGradFriendly / minYearsExperience get a write side, and
 * the /jobs alert-modal prefill carries what the user was looking at.
 *
 * The digest cron (lib/job-alerts-service.ts) has matched on both columns
 * since Phase 5, but NO form or API accepted them — dead columns no user
 * could set. Invariants pinned:
 *
 *   1. NULL STAYS A NO-OP — the cron gates on `=== true` / `typeof number`,
 *      so existing all-null alerts keep "no experience constraint". The POST
 *      route must preserve that: unset fields store null, and `false` is
 *      normalized to null (the schema documents null = no preference; false
 *      would be a third, meaningless state).
 *   2. POST accepts + zod-validates both fields; they join the dedup identity
 *      and the create payload; GET returns them so the manage page can show
 *      stored criteria.
 *   3. Both create forms (/job-alerts and /job-alerts/manage) expose
 *      accessible inputs for both fields and omit them from the POST body
 *      when unset.
 *   4. The /jobs alert-modal prefill folds active specialty/category into
 *      keyword (the digest's title/employer substring matcher, via the same
 *      label alias /job-alerts documents for ?specialty=), carries
 *      newGrad/minYears into the new API fields, and deep-linked
 *      cityExact/stateCode into location. recruitmentType is DELIBERATELY not
 *      carried — JobAlert has no employer-type column and the digest has no
 *      clause for it; pretending otherwise would fabricate a match rule.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('cron matcher null semantics (lib/job-alerts-service.ts) — precondition', () => {
  const src = read('lib/job-alerts-service.ts');

  it('newGradFriendly clause fires ONLY on === true (null/false are no-ops)', () => {
    expect(src).toMatch(/alert\.newGradFriendly === true/);
  });

  it('minYearsExperience clause fires ONLY on a number >= 0 (null is a no-op)', () => {
    expect(src).toMatch(/typeof alert\.minYearsExperience === 'number' && alert\.minYearsExperience >= 0/);
  });
});

describe('POST /api/job-alerts accepts + validates the experience criteria', () => {
  const src = read('app/api/job-alerts/route.ts');

  it('CreateAlertBody declares both fields', () => {
    expect(src).toMatch(/newGradFriendly\?: boolean/);
    expect(src).toMatch(/minYearsExperience\?: number/);
  });

  it('zod-validates them (boolean; bounded integer years)', () => {
    expect(src).toContain("from 'zod'");
    expect(src).toMatch(/newGradFriendly: z\.boolean\(\)\.optional\(\)/);
    expect(src).toMatch(/minYearsExperience: z\.number\(\)\.int\(\)\.min\(0\)\.max\(60\)\.optional\(\)/);
    expect(src).toContain('Invalid experience criteria');
  });

  it('normalizes false → null so null keeps meaning "no constraint"', () => {
    expect(src).toMatch(/newGradFriendly = expParsed\.data\.newGradFriendly === true \? true : null/);
  });

  it('both fields join the dedup identity and the create payload', () => {
    // Dedup: same criteria minus experience must NOT collide with an alert
    // that has an experience constraint.
    const dedupBlock = src.slice(src.indexOf('jobAlert.findFirst'), src.indexOf('Single opt-in'));
    expect(dedupBlock).toContain('newGradFriendly');
    expect(dedupBlock).toContain('minYearsExperience');
    const createBlock = src.slice(src.indexOf('jobAlert.create'), src.indexOf('isNewlyConfirmed'));
    expect(createBlock).toContain('newGradFriendly');
    expect(createBlock).toContain('minYearsExperience');
  });

  it('GET returns both fields so the manage page can display stored criteria', () => {
    const getBlock = src.slice(src.indexOf('export async function GET'));
    expect(getBlock).toContain('newGradFriendly: a.newGradFriendly');
    expect(getBlock).toContain('minYearsExperience: a.minYearsExperience');
  });
});

describe('create form (app/job-alerts/page.tsx)', () => {
  const src = read('app/job-alerts/page.tsx');

  it('has an accessible checkbox for "open to new grads" and a labeled years select', () => {
    expect(src).toMatch(/htmlFor="alert-new-grad"/);
    expect(src).toMatch(/id="alert-new-grad"/);
    expect(src).toMatch(/htmlFor="alert-min-years"/);
    expect(src).toMatch(/id="alert-min-years"/);
    // The select derives its buckets from the shared /jobs filter constant —
    // no hand-rolled year list that could drift.
    expect(src).toContain('EXPERIENCE_FILTER_BUCKETS');
  });

  it('sends both fields, omitted (undefined) when unset — never false/0', () => {
    expect(src).toMatch(/newGradFriendly: newGradOnly \|\| undefined/);
    expect(src).toMatch(/minYearsExperience: minYears \? Number\(minYears\) : undefined/);
  });

  it('the criteria preview names both so the user sees what the alert covers', () => {
    expect(src).toContain("parts.push('open to new grads')");
    expect(src).toMatch(/fits \$\{minYears\}\+ yrs experience/);
  });
});

describe('manage page (app/job-alerts/manage/page.tsx)', () => {
  const src = read('app/job-alerts/manage/page.tsx');

  it('the New Alert form has both inputs, wired like the create page', () => {
    expect(src).toMatch(/id="new-alert-new-grad"/);
    expect(src).toMatch(/id="new-alert-min-years"/);
    expect(src).toContain('EXPERIENCE_FILTER_BUCKETS');
    expect(src).toMatch(/newGradFriendly: newNewGradOnly \|\| undefined/);
    expect(src).toMatch(/minYearsExperience: newMinYears \? Number\(newMinYears\) : undefined/);
  });

  it('the alert-card summary shows stored experience criteria', () => {
    expect(src).toMatch(/alert\.newGradFriendly === true.*open to new grads/);
    expect(src).toMatch(/typeof alert\.minYearsExperience === 'number'/);
  });
});

describe('alert modal (components/CreateAlertForm.tsx) — the surface the prefill feeds', () => {
  const src = read('components/CreateAlertForm.tsx');

  it('InitialFilters declares both experience fields — a typed refactor cannot silently drop them', () => {
    const ifaceBlock = src.slice(
      src.indexOf('interface InitialFilters'),
      src.indexOf('interface CreateAlertFormProps'),
    );
    expect(ifaceBlock).toMatch(/newGradFriendly\?: boolean/);
    expect(ifaceBlock).toMatch(/minYearsExperience\?: number/);
  });

  it('the criteria summary shows both, mirroring the /job-alerts lines — no invisible narrowing', () => {
    expect(src).toMatch(/filters\.newGradFriendly === true.*parts\.push\('open to new grads'\)/);
    expect(src).toMatch(/typeof filters\.minYearsExperience === 'number' && filters\.minYearsExperience >= 0/);
    expect(src).toMatch(/fits \$\{filters\.minYearsExperience\}\+ yrs experience/);
  });

  it('the POST body forwards every initialFilters field (spread carries the typed criteria)', () => {
    const postBlock = src.slice(src.indexOf("fetch('/api/job-alerts'"), src.indexOf('await response.json()'));
    expect(postBlock).toContain('...initialFilters');
  });
});

describe('/jobs alert-modal prefill (app/jobs/JobsPageClient.tsx)', () => {
  const src = read('app/jobs/JobsPageClient.tsx');

  it('folds active specialty/category into keyword via the shared label', () => {
    expect(src).toContain('categoryFilterLabel');
    expect(src).toMatch(/keyword: currentFilters\.search \|\| specialtyKeyword \|\| categoryKeyword \|\| undefined/);
  });

  it('carries the experience filters into the new alert fields', () => {
    expect(src).toMatch(/newGradFriendly: currentFilters\.newGradFriendly === true \? true : undefined/);
    expect(src).toMatch(/typeof currentFilters\.minYearsExperience === 'number'/);
  });

  it('carries deep-linked cityExact/stateCode into location as "City, ST"', () => {
    expect(src).toMatch(/\$\{currentFilters\.cityExact\}, \$\{currentFilters\.stateCode\.toUpperCase\(\)\}/);
  });

  it('documents WHY recruitmentType is not carried (no honest alert-side representation)', () => {
    expect(src).toMatch(/recruitmentType is deliberately NOT carried/);
  });
});
