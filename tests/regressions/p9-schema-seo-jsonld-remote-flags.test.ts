/**
 * P9 (live-review item #7 + 1e) — JobPosting schema honesty + remote-flag
 * inference repairs.
 *
 * Pins the schema-seo package of the live-review fix program:
 *
 *   7-i   SOC gating — occupationalCategory was hardcoded to the NP code
 *         (29-1171.00) for EVERY listing, psychiatrists and podiatrists
 *         included. Now derived per listing (professionClass authoritative,
 *         deterministic title scan as fallback) and OMITTED when
 *         unclassifiable — a wrong code is worse than none. Codes verified
 *         against the live O*NET-SOC taxonomy 2026-08-21.
 *   7-ii  TELECOMMUTE — hybrid listings emitted jobLocationType TELECOMMUTE,
 *         inverting Google's 100%-remote requirement.
 *   7-iii baseSalary units — biweekly was clamped to MONTH without converting
 *         the per-paycheck value (~2.17× understated).
 *   7-vi  /post-job metadata advertised Starter/Growth/Premium tiers that
 *         never existed (donor-board ghost); the real model is
 *         first-post-free + flat price from lib/config.
 *   7-vii /post-job had no h1 in any render state.
 *   1e    Remote-flag inference — 'united states'/'nationwide'/'telehealth'/
 *         'virtual' as remote-proving substrings, MODE_REMOTE_RE's bare
 *         `|remote` tail, and the sync block that only ratcheted TOWARD
 *         remote (a detected In-Person mode could never clear a false
 *         location flag — the Tia '- Onsite' rows shipped TELECOMMUTE).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Job } from '@/lib/types';
import {
  buildJobPostingSchema,
  deriveOccupationalCategory,
} from '@/components/JobStructuredData';
import { parseLocation } from '@/lib/location-parser';
import { detectMode, reconcileWorkMode } from '@/lib/job-normalizer';

/* ─── fixtures ──────────────────────────────────────────────────────────── */

type SchemaJob = Job & { professionClass?: string | null };

function makeJob(overrides: Partial<SchemaJob> = {}): SchemaJob {
  return {
    id: 'fixture-job-1',
    title: 'Nurse Practitioner — Primary Care',
    employer: 'Acme Health',
    slug: 'nurse-practitioner-primary-care-fixture-job-1',
    description: 'Full-time nurse practitioner role in a busy primary care clinic.',
    descriptionSummary: null,
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    isRemote: false,
    isHybrid: false,
    jobType: 'Full-Time',
    salaryPeriod: null,
    minSalary: null,
    maxSalary: null,
    normalizedMinSalary: null,
    normalizedMaxSalary: null,
    originalPostedAt: new Date('2026-08-01T00:00:00Z'),
    createdAt: new Date('2026-08-01T00:00:00Z'),
    expiresAt: new Date('2026-09-30T00:00:00Z'),
    applyOnPlatform: false,
    newGradFriendly: false,
    minYearsExperience: null,
    companyWebsite: null,
    companyLogoUrl: null,
    ...overrides,
  } as unknown as SchemaJob;
}

/* ─── 7-i: SOC / occupationalCategory gating ────────────────────────────── */

describe('7-i — occupationalCategory is gated, never hardcoded', () => {
  it('emits the NP code for an NP-credentialed title', () => {
    expect(deriveOccupationalCategory({ title: 'Nurse Practitioner — Primary Care' })).toBe('29-1171.00');
    expect(deriveOccupationalCategory({ title: 'PMHNP - Outpatient Psychiatry' })).toBe('29-1171.00');
    expect(deriveOccupationalCategory({ title: 'FNP-C, Urgent Care' })).toBe('29-1171.00');
  });

  it('emits the real APRN codes for CRNA / CNM / CNS titles', () => {
    expect(deriveOccupationalCategory({ title: 'CRNA — Anesthesia Group' })).toBe('29-1151.00');
    expect(deriveOccupationalCategory({ title: 'Certified Nurse Midwife (CNM)' })).toBe('29-1161.00');
    expect(deriveOccupationalCategory({ title: 'Clinical Nurse Specialist, Med-Surg' })).toBe('29-1141.04');
  });

  it('emits the PA code for physician assistant titles, never the NP code', () => {
    expect(deriveOccupationalCategory({ title: 'Physician Assistant - Cardiology' })).toBe('29-1071.00');
    expect(deriveOccupationalCategory({ title: 'Psychiatric Provider (PA-C), Remote' })).toBe('29-1071.00');
  });

  it('OMITS the property for non-NP clinical titles (the review-cited rows)', () => {
    expect(deriveOccupationalCategory({ title: 'Psychiatrist' })).toBeUndefined();
    expect(deriveOccupationalCategory({ title: 'Podiatrist' })).toBeUndefined();
    expect(deriveOccupationalCategory({ title: 'Nurse Manager - Homeless Services' })).toBeUndefined();
  });

  it('does not misread Clinical Nurse Manager – CNM as a midwife (item 1d)', () => {
    expect(
      deriveOccupationalCategory({ title: 'Clinical Nurse Manager – CNM – Inpatient Psychiatry' }),
    ).toBeUndefined();
  });

  it('professionClass is authoritative when present — REAL enum values', () => {
    // Harden-review fix #3: this gate previously keyed on 'np' /
    // 'aprn_non_np' / 'unknown' — values that do NOT exist in the Prisma
    // ProfessionClass enum — so every classified NP/CRNA/CNM/CNS row lost
    // its SOC the moment the backfill stamped real classes. The mapping now
    // mirrors prisma/schema.prisma exactly.
    expect(deriveOccupationalCategory({ title: 'Provider', professionClass: 'np_eligible' })).toBe('29-1171.00');
    expect(deriveOccupationalCategory({ title: 'Provider', professionClass: 'aprn_crna' })).toBe('29-1151.00');
    expect(deriveOccupationalCategory({ title: 'Provider', professionClass: 'aprn_midwife' })).toBe('29-1161.00');
    expect(deriveOccupationalCategory({ title: 'Provider', professionClass: 'aprn_cns' })).toBe('29-1141.04');
    expect(deriveOccupationalCategory({ title: 'Provider', professionClass: 'pa_only' })).toBe('29-1071.00');
    // Classified non-NP: never a nursing SOC, even with an NP-looking title.
    expect(
      deriveOccupationalCategory({ title: 'Nurse Practitioner', professionClass: 'physician' }),
    ).toBeUndefined();
    expect(
      deriveOccupationalCategory({ title: 'Provider', professionClass: 'nonclinical' }),
    ).toBeUndefined();
    expect(
      deriveOccupationalCategory({ title: 'Podiatrist', professionClass: 'other_clinical' }),
    ).toBeUndefined();
    // Unrecognized/future value: omit rather than guess (and never fall back
    // to the title scan for a CLASSIFIED row).
    expect(
      deriveOccupationalCategory({ title: 'Nurse Practitioner', professionClass: 'unknown' }),
    ).toBeUndefined();
  });

  it('SOC mapping keys mirror the ProfessionClass enum (no phantom values)', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components/JobStructuredData.tsx'),
      'utf8',
    );
    for (const phantom of ["'np'", "'aprn_non_np'", "'unknown'"]) {
      expect(source).not.toContain(`professionClass === ${phantom}`);
    }
    for (const real of ['np_eligible', 'aprn_crna', 'aprn_midwife', 'aprn_cns', 'pa_only']) {
      expect(source).toContain(`${real}: SOC_`);
    }
  });

  it('schema object omits occupationalCategory for a psychiatrist row', () => {
    const schema = buildJobPostingSchema(makeJob({ title: 'Psychiatrist' }));
    expect('occupationalCategory' in schema).toBe(false);
  });

  it('schema object carries the NP code for an NP row', () => {
    const schema = buildJobPostingSchema(makeJob());
    expect(schema.occupationalCategory).toBe('29-1171.00');
  });
});

/* ─── 7-ii: TELECOMMUTE semantics ───────────────────────────────────────── */

describe('7-ii — TELECOMMUTE means 100% remote, never hybrid', () => {
  it('fully remote: TELECOMMUTE + applicantLocationRequirements, no physical jobLocation', () => {
    const schema = buildJobPostingSchema(makeJob({ isRemote: true, isHybrid: false }));
    expect(schema.jobLocationType).toBe('TELECOMMUTE');
    expect(schema.jobLocation).toBeUndefined();
    expect(schema.applicantLocationRequirements).toBeDefined();
  });

  it('hybrid: physical jobLocation only — never TELECOMMUTE (the inverted-guidance bug)', () => {
    const schema = buildJobPostingSchema(makeJob({ isRemote: true, isHybrid: true }));
    expect('jobLocationType' in schema).toBe(false);
    expect('applicantLocationRequirements' in schema).toBe(false);
    expect(schema.jobLocation).toBeDefined();
  });

  it('onsite: physical jobLocation, no TELECOMMUTE', () => {
    const schema = buildJobPostingSchema(makeJob({ isRemote: false, isHybrid: false }));
    expect('jobLocationType' in schema).toBe(false);
    expect(schema.jobLocation).toBeDefined();
  });
});

/* ─── 7-iii: baseSalary native units + biweekly conversion ──────────────── */

interface SalaryValue {
  minValue?: number;
  maxValue?: number;
  unitText?: string;
}

function salaryValue(schema: Record<string, unknown>): SalaryValue {
  return (schema.baseSalary as { value: SalaryValue }).value;
}

describe('7-iii — baseSalary carries the honest source unit', () => {
  it('hourly rows emit HOUR with the raw hourly values, not the annualization', () => {
    const schema = buildJobPostingSchema(makeJob({
      salaryPeriod: 'hourly', minSalary: 60, maxSalary: 75,
      normalizedMinSalary: 124800, normalizedMaxSalary: 156000,
    }));
    expect(salaryValue(schema)).toMatchObject({ minValue: 60, maxValue: 75, unitText: 'HOUR' });
  });

  it('monthly rows emit MONTH with the raw monthly value (the $40k/month case)', () => {
    const schema = buildJobPostingSchema(makeJob({
      salaryPeriod: 'monthly', minSalary: 40000, maxSalary: null,
      normalizedMinSalary: 480000, normalizedMaxSalary: 480000,
    }));
    expect(salaryValue(schema)).toMatchObject({ minValue: 40000, maxValue: 40000, unitText: 'MONTH' });
  });

  it('biweekly rows convert the per-paycheck value to per-month (× 26/12), not a bare clamp', () => {
    const schema = buildJobPostingSchema(makeJob({
      salaryPeriod: 'biweekly', minSalary: 5000, maxSalary: 6000,
    }));
    // 5000 × 26 / 12 = 10833.33… → rounded; the old clamp emitted 5000 as a
    // monthly figure (~2.17× understated).
    expect(salaryValue(schema)).toMatchObject({
      minValue: Math.round((5000 * 26) / 12),
      maxValue: Math.round((6000 * 26) / 12),
      unitText: 'MONTH',
    });
  });

  it('annual rows prefer the normalized figures with YEAR', () => {
    const schema = buildJobPostingSchema(makeJob({
      salaryPeriod: 'yearly', minSalary: 120000, maxSalary: 150000,
      normalizedMinSalary: 120000, normalizedMaxSalary: 150000,
    }));
    expect(salaryValue(schema)).toMatchObject({ minValue: 120000, maxValue: 150000, unitText: 'YEAR' });
  });

  it('no salary at all → baseSalary omitted', () => {
    const schema = buildJobPostingSchema(makeJob());
    expect('baseSalary' in schema).toBe(false);
  });

  // salaryPeriod='unknown' rows (P9 #2a): the validator kept the raw figures
  // but refused to classify their cadence — normalizedMin/Max stay null.
  // canonicalSalaryPeriod folds 'unknown' into 'annual', which used to
  // republish the raw ambiguous figure as unitText YEAR (a possibly-monthly
  // $35,000 emitted as $35,000/year — the 7-iii wrong-unit defect recreated
  // for this row class). Omission beats wrong.
  it("salaryPeriod='unknown' with raw-only values → baseSalary omitted, never raw + YEAR", () => {
    const schema = buildJobPostingSchema(makeJob({
      salaryPeriod: 'unknown', minSalary: 35000, maxSalary: 45000,
      normalizedMinSalary: null, normalizedMaxSalary: null,
    }));
    expect('baseSalary' in schema).toBe(false);
  });

  it("salaryPeriod='unknown' emits ONLY annualized normalized values under YEAR (defensive)", () => {
    // The pipeline withholds normalized values for unknown periods today; if
    // that ever changes, the annualized figures are the only ones honest
    // under a YEAR unit — the raw bounds must still never leak.
    const schema = buildJobPostingSchema(makeJob({
      salaryPeriod: 'unknown', minSalary: 35000, maxSalary: 45000,
      normalizedMinSalary: 120000, normalizedMaxSalary: 150000,
    }));
    expect(salaryValue(schema)).toMatchObject({
      minValue: 120000, maxValue: 150000, unitText: 'YEAR',
    });
  });
});

/* ─── 1e: location-parser remote keywords ───────────────────────────────── */

describe('1e — location strings only prove remote with a standalone remote token', () => {
  it("country markers are not remote markers ('…, United States' is onsite)", () => {
    const parsed = parseLocation('Los Angeles, CA, United States');
    expect(parsed.isRemote).toBe(false);
    expect(parsed.city).toBe('Los Angeles');
    expect(parsed.stateCode).toBe('CA');
  });

  it("'United States' / 'Nationwide' alone: not remote, and never mis-filed as a city", () => {
    for (const loc of ['United States', 'Nationwide', 'USA']) {
      const parsed = parseLocation(loc);
      expect(parsed.isRemote).toBe(false);
      expect(parsed.city).toBeNull();
    }
  });

  it('service-line words (telehealth / virtual) are not remote proof', () => {
    expect(parseLocation('Telehealth').isRemote).toBe(false);
    expect(parseLocation('Virtual Care Center - Columbus, OH').isRemote).toBe(false);
  });

  it('a standalone remote token still works', () => {
    expect(parseLocation('Remote').isRemote).toBe(true);
    expect(parseLocation('Remote — United States').isRemote).toBe(true);
    expect(parseLocation('Work from home - TX').isRemote).toBe(true);
  });

  it('hybrid locations set isHybrid, never isRemote (mutually exclusive flags)', () => {
    const parsed = parseLocation('Hybrid - New York, NY');
    expect(parsed.isHybrid).toBe(true);
    expect(parsed.isRemote).toBe(false);
  });

  it("bare 'flexible' no longer implies hybrid", () => {
    expect(parseLocation('Flexible - Denver, CO').isHybrid).toBe(false);
  });
});

/* ─── 1e: detectMode bare-remote fix ────────────────────────────────────── */

describe('1e — detectMode no longer fires on a bare description mention of "remote"', () => {
  it('an onsite description mentioning remote monitoring stays In-Person', () => {
    expect(
      detectMode('Our team uses remote patient monitoring tools. This role is on-site at our clinic.'),
    ).toBe('In-Person');
  });

  it('a telehealth-services mention is not a work-mode statement', () => {
    expect(
      detectMode('Experience with telehealth visits preferred. Outpatient clinic setting.'),
    ).toBe('In-Person');
  });

  it('strong remote phrasing still detects', () => {
    expect(detectMode('This is a fully remote position.')).toBe('Remote');
    expect(detectMode('Join our 100% telehealth practice.')).toBe('Remote');
    expect(detectMode('Remote position — licensed in any US state.')).toBe('Remote');
  });
});

/* ─── 1e: bidirectional mode ↔ flags reconciliation ─────────────────────── */

describe('1e — reconcileWorkMode replaces the one-way ratchet', () => {
  it('the Tia case: explicit onsite title clears a false location-remote flag', () => {
    const result = reconcileWorkMode({
      title: "Women's Health NP - Los Angeles - Onsite",
      detectedMode: 'In-Person',
      // What the OLD parser derived from '…, United States':
      locationIsRemote: true,
      locationIsHybrid: false,
    });
    expect(result).toEqual({ mode: 'In-Person', isRemote: false, isHybrid: false });
  });

  it('ratchet regression: detected In-Person now WINS over a location false positive', () => {
    const result = reconcileWorkMode({
      title: 'PMHNP — Outpatient',
      detectedMode: 'In-Person',
      locationIsRemote: true,
      locationIsHybrid: false,
    });
    expect(result.isRemote).toBe(false);
  });

  it('structured (employer-declared) mode is authoritative in BOTH directions', () => {
    expect(reconcileWorkMode({
      title: 'NP — New York, NY', detectedMode: null,
      locationIsRemote: false, locationIsHybrid: false, structuredMode: 'Remote',
    })).toEqual({ mode: 'Remote', isRemote: true, isHybrid: false });

    expect(reconcileWorkMode({
      title: 'NP — Remote, New York NY', detectedMode: 'Remote',
      locationIsRemote: true, locationIsHybrid: false, structuredMode: 'In-Person',
    })).toEqual({ mode: 'In-Person', isRemote: false, isHybrid: false });
  });

  it('title remote still surfaces aggregator rows on /jobs/remote', () => {
    expect(reconcileWorkMode({
      title: 'Remote PMHNP', detectedMode: null,
      locationIsRemote: false, locationIsHybrid: false,
    })).toEqual({ mode: 'Remote', isRemote: true, isHybrid: false });
  });

  it('hybrid always yields isHybrid without isRemote', () => {
    expect(reconcileWorkMode({
      title: 'NP — Hybrid — Austin, TX', detectedMode: 'Remote',
      locationIsRemote: true, locationIsHybrid: false,
    })).toEqual({ mode: 'Hybrid', isRemote: false, isHybrid: true });
  });

  it('location flags fill in only when no stronger signal exists — and set mode too', () => {
    expect(reconcileWorkMode({
      title: 'PMHNP', detectedMode: null,
      locationIsRemote: true, locationIsHybrid: false,
    })).toEqual({ mode: 'Remote', isRemote: true, isHybrid: false });

    expect(reconcileWorkMode({
      title: 'PMHNP', detectedMode: null,
      locationIsRemote: false, locationIsHybrid: false,
    })).toEqual({ mode: null, isRemote: false, isHybrid: false });
  });
});

/* ─── 7-vi / 7-vii: /post-job metadata + h1 (static) ────────────────────── */

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('7-vi — /post-job metadata reflects the real pricing model', () => {
  const layout = read('app/post-job/layout.tsx');

  it('the Starter/Growth/Premium donor-board ghost is gone', () => {
    expect(layout).not.toMatch(/Starter|Growth|Premium/);
  });

  it('the description derives the price from lib/config instead of hand-typing it', () => {
    expect(layout).toContain('config.postingPrice');
    expect(layout).toMatch(/first post is free/i);
  });
});

describe('7-vii — /post-job renders an h1', () => {
  const page = read('app/post-job/page.tsx');

  it('the wizard state has a single h1 above the steps', () => {
    expect(page).toMatch(/<h1[^>]*>\s*Post a \{brand\.niche\.long\} Job\s*<\/h1>/);
  });

  it('the logged-out gate (what a crawler sees) also leads with an h1', () => {
    const h1Count = (page.match(/<h1/g) || []).length;
    expect(h1Count).toBeGreaterThanOrEqual(2);
  });
});

/* ─── backfill script contract (static — importing it would bind a DB) ───── */

describe('backfill-remote-flags script is written check-first', () => {
  const script = read('scripts/backfill-remote-flags.ts');

  it('dry-run is the default; writes require an explicit --apply', () => {
    expect(script).toContain("process.argv.includes('--apply')");
    expect(script).toContain("process.argv.includes('--check')");
    expect(script).toMatch(/DRY RUN — nothing was written/);
  });

  it('re-derives through the SAME shared functions the ingest path uses', () => {
    expect(script).toContain("from '@/lib/location-parser'");
    expect(script).toContain('reconcileWorkMode');
    expect(script).toContain('detectMode');
  });

  it('employer-declared modes are passed as structuredMode (never overridden by inference)', () => {
    expect(script).toMatch(/STRUCTURED_MODE_SOURCE_TYPES/);
    expect(script).toContain("'employer'");
  });

  it('planRow scans the SAME text surface as ingest: title + description + LOCATION', () => {
    // Ingest builds `${title} ${fullDescription} ${location}` for detectMode
    // (lib/job-normalizer.ts normalizeJobWithReason). A backfill that omits
    // the location derives null where ingest derives a mode, so --apply
    // writes values a renewal re-ingest immediately reverts (flip-flop) —
    // and the post-apply self-verify reuses planRow, so it cannot see it.
    expect(script).toMatch(
      /detectMode\(`\$\{row\.title\} \$\{row\.description \|\| ''\} \$\{row\.location \|\| ''\}`\)/,
    );
  });
});

/* ─── backfill ↔ ingest derivation parity for location-only mode tokens ──── */

describe('location-only mode tokens derive identically in backfill and ingest', () => {
  // detectMode's token set is deliberately WIDER than parseLocation's
  // REMOTE_LOCATION_RE: 'Telecommute'/'Telework' and 'Office Based - …' are
  // mode proof only via detectMode. So when the token lives in the LOCATION
  // string alone, it is only visible if the location is part of the
  // detectMode input — the shape both ingest and (now) planRow use.
  const deriveLikeIngest = (title: string, description: string, location: string) => {
    const parsed = parseLocation(location);
    return reconcileWorkMode({
      title,
      detectedMode: detectMode(`${title} ${description} ${location}`),
      locationIsRemote: parsed.isRemote,
      locationIsHybrid: parsed.isHybrid,
      structuredMode: null,
    });
  };

  it("location 'Telecommute' (not matched by REMOTE_LOCATION_RE) still derives Remote", () => {
    const title = 'PMHNP — Outpatient';
    const description = 'Provide psychiatric care to adult patients.';
    // The location string alone can NOT prove remote…
    expect(parseLocation('Telecommute').isRemote).toBe(false);
    // …and without the location in the scan (the old backfill shape) the
    // token is invisible — this null is what caused the flip-flop:
    expect(detectMode(`${title} ${description}`)).toBeNull();
    // With the ingest-shaped input the row derives Remote, matching ingest.
    expect(deriveLikeIngest(title, description, 'Telecommute')).toEqual({
      mode: 'Remote', isRemote: true, isHybrid: false,
    });
    expect(deriveLikeIngest(title, description, 'Telework')).toEqual({
      mode: 'Remote', isRemote: true, isHybrid: false,
    });
  });

  it("location 'Office Based - …' derives In-Person, matching ingest", () => {
    const title = 'Family Nurse Practitioner';
    const description = 'Join our multidisciplinary team.';
    expect(detectMode(`${title} ${description}`)).toBeNull();
    expect(deriveLikeIngest(title, description, 'Office Based - Miami, FL')).toEqual({
      mode: 'In-Person', isRemote: false, isHybrid: false,
    });
  });
});
