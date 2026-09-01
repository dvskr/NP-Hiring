/**
 * P9 (live-review item #3) — filter-first deterministic search.
 *
 * The reviewer's exact query "remote nurse practitioner jobs in Texas"
 * returned 0 results because buildWhereClause ANDed EVERY whitespace token
 * as a required literal substring (recon 3a): "jobs" and "in" had to appear
 * verbatim, "remote" matched as text (267 hits, 132 isRemote=false — 3b),
 * and state codes never reached the structured columns (3c).
 *
 * The fix (lib/search-query-intent.ts, consumed by buildWhereClause):
 *   • work-mode terms → the same isRemote/isHybrid signals the facet uses,
 *   • state names AND codes → the same stateCode/state equality the
 *     ?location branch uses,
 *   • stopwords (jobs/position/np/the "nurse practitioner" niche phrase)
 *     dropped from the residual text tokens,
 *   • query-derived constraints yield to explicit UI filters on conflict,
 *   • zero-result searches attribute the emptiness to one dimension.
 *
 * Behavioral tests run the REAL buildWhereClause output against seeded
 * fixture rows through a mini Prisma-where evaluator, so these are
 * end-to-end assertions on the WHERE semantics, not shape snapshots.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { buildWhereClause } from '@/lib/filters';
import { DEFAULT_FILTERS } from '@/types/filters';
import { parseSemanticQuery } from '@/lib/ai/query-parser';
import {
  STATE_NAME_BY_CODE,
  extractSearchQueryIntent,
  buildSearchConditionSet,
  computeZeroResultSearchHint,
} from '@/lib/search-query-intent';

/* ─── Mini Prisma-where evaluator (seeded mock) ─────────────────────────── */

type Row = Record<string, unknown>;

function matchesField(field: unknown, cond: Record<string, unknown>): boolean {
  for (const [op, v] of Object.entries(cond)) {
    if (op === 'mode') continue;
    if (op === 'contains') {
      if (typeof field !== 'string' || !field.toLowerCase().includes(String(v).toLowerCase())) return false;
    } else if (op === 'equals') {
      if (typeof field === 'string' && typeof v === 'string') {
        if (field.toLowerCase() !== v.toLowerCase()) return false;
      } else if (field !== v) return false;
    } else if (op === 'startsWith') {
      if (typeof field !== 'string' || !field.toLowerCase().startsWith(String(v).toLowerCase())) return false;
    } else if (op === 'in') {
      if (!Array.isArray(v) || !v.includes(field)) return false;
    } else if (op === 'not') {
      // Prisma scalar `not`: { not: null } matches non-null values;
      // { not: x } matches values !== x. Needed since the quarantine
      // package's profession-class gate joined GLOBAL_EXCLUSIONS.
      const fieldValue = field === undefined ? null : field;
      if (v === null) {
        if (fieldValue === null) return false;
      } else if (fieldValue === v) {
        return false;
      }
    } else {
      throw new Error(`evaluator: unsupported operator "${op}" — extend the mock`);
    }
  }
  return true;
}

function matchesWhere(row: Row, where: Prisma.JobWhereInput): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (key === 'AND') {
      const arr = Array.isArray(value) ? value : [value];
      if (!arr.every((c) => matchesWhere(row, c as Prisma.JobWhereInput))) return false;
    } else if (key === 'OR') {
      const arr = value as Prisma.JobWhereInput[];
      // Prisma semantics: OR: [] matches nothing.
      if (!arr.some((c) => matchesWhere(row, c))) return false;
    } else if (key === 'NOT') {
      const arr = Array.isArray(value) ? value : [value];
      if (arr.some((c) => matchesWhere(row, c as Prisma.JobWhereInput))) return false;
    } else if (value !== null && typeof value === 'object') {
      if (!matchesField(row[key], value as Record<string, unknown>)) return false;
    } else if (row[key] !== value) {
      return false;
    }
  }
  return true;
}

/* ─── Seeded fixtures ───────────────────────────────────────────────────── */

const remoteTexasNP: Row = {
  id: 'remote-tx',
  title: 'Remote Psychiatric Nurse Practitioner (PMHNP)',
  employer: 'Lone Star Behavioral Health',
  description: 'Provide psychiatric care to patients across Texas via telehealth.',
  city: 'Austin', state: 'Texas', stateCode: 'TX',
  isRemote: true, isHybrid: false, isPublished: true,
};
const onsiteTexasNP: Row = {
  id: 'onsite-tx',
  title: 'Family Nurse Practitioner',
  employer: 'Dallas Primary Care Clinic',
  description: 'On-site FNP role serving families in Dallas.',
  city: 'Dallas', state: 'Texas', stateCode: 'TX',
  isRemote: false, isHybrid: false, isPublished: true,
};
const remoteCaliforniaNP: Row = {
  id: 'remote-ca',
  title: 'Telehealth PMHNP',
  employer: 'Golden State Wellness',
  description: 'Fully remote psychiatric NP position.',
  city: 'Los Angeles', state: 'California', stateCode: 'CA',
  isRemote: true, isHybrid: false, isPublished: true,
};
// isRemote=false but says "remote" in its text — the 3b false-positive class
// (132 live rows). A bare "remote" search must never return it again.
const hybridColoradoNP: Row = {
  id: 'hybrid-co',
  title: 'Nurse Practitioner - Hybrid',
  employer: 'Front Range Health',
  description: 'Hybrid schedule; partially remote work with weekly clinic days.',
  city: 'Denver', state: 'Colorado', stateCode: 'CO',
  isRemote: false, isHybrid: true, isPublished: true,
};

const SEED: Row[] = [remoteTexasNP, onsiteTexasNP, remoteCaliforniaNP, hybridColoradoNP];

function runSearch(search: string, extra: Partial<typeof DEFAULT_FILTERS> = {}): Row[] {
  const where = buildWhereClause({ ...DEFAULT_FILTERS, ...extra, search });
  return SEED.filter((row) => matchesWhere(row, where));
}
const ids = (rows: Row[]) => rows.map((r) => r.id).sort();

/* ─── The reviewer's exact query ────────────────────────────────────────── */

describe('reviewer query: "remote nurse practitioner jobs in Texas"', () => {
  const QUERY = 'remote nurse practitioner jobs in Texas';

  it('returns exactly the remote Texas inventory', () => {
    expect(ids(runSearch(QUERY))).toEqual(['remote-tx']);
  });

  it('leave-one-out: no single token may zero the result (the 3a repro)', () => {
    const words = QUERY.split(' ');
    for (let i = 0; i < words.length; i++) {
      const variant = words.filter((_, j) => j !== i).join(' ');
      const result = runSearch(variant);
      expect(result.length, `query "${variant}" returned zero`).toBeGreaterThan(0);
      expect(ids(result), `query "${variant}" lost the remote Texas fixture`).toContain('remote-tx');
    }
  });

  it('adding the stopword "jobs" never changes the result set', () => {
    expect(ids(runSearch('psychiatric np jobs'))).toEqual(ids(runSearch('psychiatric np')));
  });
});

/* ─── Work-mode intent (3b) ─────────────────────────────────────────────── */

describe('work-mode terms become structured constraints', () => {
  it("bare 'remote' returns only isRemote=true rows — never the hybrid text-match class", () => {
    expect(ids(runSearch('remote'))).toEqual(['remote-ca', 'remote-tx']);
  });

  it("'hybrid' maps to isHybrid", () => {
    expect(ids(runSearch('hybrid np jobs'))).toEqual(['hybrid-co']);
  });

  it("'onsite' maps to isRemote=false AND isHybrid=false", () => {
    expect(ids(runSearch('onsite np jobs'))).toEqual(['onsite-tx']);
  });

  it('telehealth stays TEXT, not a remote inference (consistent with the item-1e flag repair)', () => {
    const intent = extractSearchQueryIntent('telehealth np jobs');
    expect(intent.remote).toBe(false);
    expect(intent.textTokens).toEqual(['telehealth']);
  });
});

/* ─── State intent (3c) ─────────────────────────────────────────────────── */

describe('state names and codes hit the structured columns', () => {
  it.each(['Texas', 'TX', 'tx', 'texas jobs', 'jobs in texas'])('"%s" returns the Texas inventory', (q) => {
    expect(ids(runSearch(q))).toEqual(['onsite-tx', 'remote-tx']);
  });

  it('state names and codes agree ("TX" ≡ "Texas")', () => {
    expect(ids(runSearch('TX'))).toEqual(ids(runSearch('Texas')));
  });

  it('shared-source guard: STATE_NAME_BY_CODE round-trips through parseSemanticQuery', () => {
    for (const [code, name] of Object.entries(STATE_NAME_BY_CODE)) {
      expect(parseSemanticQuery(name).state, `"${name}" should parse to ${code}`).toBe(code);
    }
  });
});

/* ─── Merge rule: explicit UI filter wins on conflict ───────────────────── */

describe('explicit filter precedence', () => {
  it('a checked Work Mode facet suppresses the query-derived work mode (no impossible AND)', () => {
    // "remote" typed + onsite facet checked → the facet wins: results exist.
    expect(ids(runSearch('remote np jobs', { workMode: ['onsite'] }))).toEqual(['onsite-tx']);
  });

  it('an explicit location param suppresses the query-derived state', () => {
    expect(ids(runSearch('jobs in texas', { location: 'California' }))).toEqual(['remote-ca']);
  });
});

/* ─── Hard-zero canary ──────────────────────────────────────────────────── */

describe('hard-zero canary: common intent phrasings never return 0 against the seed', () => {
  it.each([
    'remote np jobs',
    'nurse practitioner jobs in texas',
    'np jobs texas',
    'remote jobs',
    'jobs in texas',
    'psychiatric np jobs',
    'remote nurse practitioner in TX',
    'hybrid np jobs',
    'nurse practitioner positions',
  ])('"%s" returns at least one job', (q) => {
    expect(runSearch(q).length).toBeGreaterThan(0);
  });
});

/* ─── Zero-result honesty ───────────────────────────────────────────────── */

describe('computeZeroResultSearchHint', () => {
  const count = async (where: Prisma.JobWhereInput): Promise<number> =>
    SEED.filter((row) => matchesWhere(row, where)).length;
  const precedence = { hasExplicitWorkMode: false, hasExplicitLocation: false };
  const baseWhere = buildWhereClause({ ...DEFAULT_FILTERS, search: '' });

  it('names the state when the state emptied a remote search', async () => {
    const intent = extractSearchQueryIntent('remote nurse practitioner jobs in Wyoming');
    const set = buildSearchConditionSet(intent, precedence);
    expect(ids(runSearch('remote nurse practitioner jobs in Wyoming'))).toEqual([]);
    const hint = await computeZeroResultSearchHint({ baseWhere, set, intent, count });
    expect(hint).toEqual({
      removedConstraint: 'state',
      removedLabel: 'state Wyoming',
      availableCount: 2,
    });
  });

  it('names the text tokens when they emptied the search', async () => {
    const intent = extractSearchQueryIntent('remote cardiology np jobs');
    const set = buildSearchConditionSet(intent, precedence);
    expect(ids(runSearch('remote cardiology np jobs'))).toEqual([]);
    const hint = await computeZeroResultSearchHint({ baseWhere, set, intent, count });
    expect(hint?.removedConstraint).toBe('text');
    expect(hint?.removedLabel).toContain('cardiology');
    expect(hint?.availableCount).toBe(2);
  });

  it('returns null when no single dimension explains the zero', async () => {
    const intent = extractSearchQueryIntent('jobs');
    const set = buildSearchConditionSet(intent, precedence);
    const hint = await computeZeroResultSearchHint({ baseWhere, set, intent, count });
    expect(hint).toBeNull();
  });
});

/* ─── Intent extraction details ─────────────────────────────────────────── */

describe('extractSearchQueryIntent', () => {
  it('extracts all three dimensions from the reviewer query', () => {
    const intent = extractSearchQueryIntent('remote nurse practitioner jobs in Texas');
    expect(intent.remote).toBe(true);
    expect(intent.stateCode).toBe('TX');
    expect(intent.stateName).toBe('Texas');
    expect(intent.textTokens).toEqual([]);
    expect(intent.droppedTokens).toContain('jobs');
  });

  it('the whole-niche phrase is stripped as a PHRASE — lone "nurse" stays meaningful', () => {
    expect(extractSearchQueryIntent('psychiatric nurse practitioner').textTokens).toEqual(['psychiatric']);
    expect(extractSearchQueryIntent('nurse midwife').textTokens).toEqual(['nurse', 'midwife']);
  });

  it('a query of only stopwords yields no constraints (honest browse-all, not an arbitrary subset)', () => {
    const intent = extractSearchQueryIntent('np jobs');
    expect(intent.textTokens).toEqual([]);
    expect(intent.stateCode).toBeNull();
    expect(intent.remote).toBe(false);
    // Against the seed: every published row, same as no search.
    expect(ids(runSearch('np jobs'))).toEqual(ids(SEED as Row[]).sort());
  });

  it('is stateless across calls (no /g-regex lastIndex leakage)', () => {
    expect(extractSearchQueryIntent('hybrid np').hybrid).toBe(true);
    expect(extractSearchQueryIntent('hybrid np').hybrid).toBe(true);
    expect(extractSearchQueryIntent('onsite np').onsite).toBe(true);
    expect(extractSearchQueryIntent('onsite np').onsite).toBe(true);
  });
});

/* ─── Search box copy (components/jobs/LinkedInFilters.tsx) ─────────────── */

describe('search box copy matches the new matcher', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'components/jobs/LinkedInFilters.tsx'),
    'utf8',
  );

  it('the placeholder demonstrates intent phrasing the matcher now honors', () => {
    expect(src).toContain('remote np jobs in Texas');
  });

  it('the old title/company-only copy is gone', () => {
    expect(src).not.toContain('placeholder="Job title, company..."');
    expect(src).not.toContain('aria-label="Search by job title or company"');
  });
});
