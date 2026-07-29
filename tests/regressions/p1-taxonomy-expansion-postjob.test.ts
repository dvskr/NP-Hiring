/**
 * P1 #20 — employer form + backfill wiring (taxonomy-expansion pkg, static
 * checks).
 *
 * The employer forms' specialty picker and SETTING/POPULATION selects must
 * derive from the classifier's EMPLOYER_* maps (single source of truth) so
 * the form options and tag resolution can never drift, and the donor
 * board's psych-flavored option strings must be gone.
 *
 * "Forms" is plural on purpose: /post-job and /jobs/edit/[token] write the
 * SAME Job.setting / Job.population columns, so guarding only the former let
 * the donor vocabulary keep shipping from the latter.
 *
 * The maps also need a live CALLER — a pure function nothing invokes with
 * real data is dead code no deploy step can activate.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const src = fs.readFileSync(path.join(ROOT, 'app', 'post-job', 'page.tsx'), 'utf-8');
const editSrc = fs.readFileSync(
  path.join(ROOT, 'app', 'jobs', 'edit', '[token]', 'page.tsx'), 'utf-8',
);
const backfillSrc = fs.readFileSync(
  path.join(ROOT, 'scripts', 'backfill-category-tags.ts'), 'utf-8',
);

/** Option strings inherited from the donor psych board; none may ship. */
const DONOR_OPTION_STRINGS = [
  'Substance Use / Dual Diagnosis',
  'Emergency / Crisis',
  'Residential',
  'Child & Adolescent',
  'Forensic',
] as const;

describe('P1 #20 — post-job form derives options from the classifier maps', () => {
  it('imports the shared employer option maps from category-tagger', () => {
    expect(src).toContain('EMPLOYER_SPECIALTY_SLUGS');
    expect(src).toContain('EMPLOYER_SETTING_TAGS');
    expect(src).toContain('EMPLOYER_POPULATION_TAGS');
    expect(src).toContain("from '@/lib/pseo/category-tagger'");
  });

  it('renders a registry-driven specialty picker registered as `specialty`', () => {
    expect(src).toContain("register('specialty')");
    expect(src).toContain('SPECIALTY_OPTIONS.map');
    // Labels are derived at runtime (categoryFilterLabel), never hardcoded
    // slug-by-slug lists that could drift from the registry.
    expect(src).toContain('categoryFilterLabel');
  });

  it('the zod schema carries the optional specialty field', () => {
    expect(src).toContain('specialty: z.string().optional()');
  });

  it('SETTING/POPULATION option lists are map-derived, not hand-written arrays', () => {
    expect(src).toContain('Object.keys(EMPLOYER_SETTING_TAGS)');
    expect(src).toContain('Object.keys(EMPLOYER_POPULATION_TAGS)');
  });

  it('no donor psych-era option strings remain in the form source', () => {
    for (const donorOption of DONOR_OPTION_STRINGS) {
      expect(src, donorOption).not.toContain(donorOption);
    }
  });

  it('makes no placement promise while the create routes still drop the field', () => {
    // Truth guard. Neither app/api/jobs/post-free/route.ts nor
    // app/api/create-checkout/route.ts forwards `specialty`, and neither
    // writes Job.categoryTags for employer posts — so the picker is
    // captured on the draft and dropped at insert. Until that is wired,
    // the helper copy must describe the INPUT, never an outcome the
    // product does not deliver. Delete this test in the same change that
    // wires the routes.
    for (const unearnedClaim of [
      'places your post',
      'will appear on',
      'gets your post',
    ]) {
      expect(src, unearnedClaim).not.toContain(unearnedClaim);
    }
    expect(src).toContain('PENDING API WIRING');
  });
});

describe('P1 #20 — the create routes are the documented remaining gap', () => {
  it('records that neither job-create route forwards the specialty yet', () => {
    // This test asserts the CURRENT (broken) state on purpose: it is the
    // tripwire that tells whoever wires the routes to also delete the
    // "PENDING API WIRING" comment and the truth guard above. When both
    // routes start forwarding `specialty`, this test fails — that failure
    // is the signal to remove it, not to work around it.
    const routes = [
      path.join(ROOT, 'app', 'api', 'jobs', 'post-free', 'route.ts'),
      path.join(ROOT, 'app', 'api', 'create-checkout', 'route.ts'),
    ];
    const forwarding = routes.filter((file) =>
      fs.existsSync(file) && /\bspecialty\b/.test(fs.readFileSync(file, 'utf-8')),
    );
    expect(
      forwarding,
      'a job-create route now handles `specialty` — wire classifyJobTags() into it, '
      + 'then delete this test and the PENDING API WIRING comment in app/post-job/page.tsx',
    ).toEqual([]);
  });

  it('the pending-wiring note also discloses what the backfill cannot rescue', () => {
    // The gap disclosure used to name only the two create routes, which read
    // as "a backfill will sort the rest out". It cannot: Job has no
    // `specialty` column, so that field is unrecoverable after insert.
    expect(src).toContain('scripts/backfill-category-tags.ts');
    expect(src).toContain('no Job.specialty column');
  });
});

describe('P1 #20 — the explicit-field path has a live caller', () => {
  // Without this, EMPLOYER_SETTING_TAGS / EMPLOYER_POPULATION_TAGS and the
  // LEGACY_* alias maps are exercised only by unit tests: the classifier
  // accepts the fields, but nothing in the product ever passes them, so the
  // mandated `npx tsx scripts/backfill-category-tags.ts --force --apply`
  // deploy step would resolve exactly nothing.
  it('the backfill SELECTS the employer-declared columns', () => {
    const selectBlock = backfillSrc.slice(
      backfillSrc.indexOf('select: {'),
      backfillSrc.indexOf('orderBy:'),
    );
    expect(selectBlock).toContain('setting: true');
    expect(selectBlock).toContain('population: true');
  });

  it('the backfill PASSES them into classifyJobTags', () => {
    const callBlock = backfillSrc.slice(
      backfillSrc.indexOf('classifyJobTags({'),
      backfillSrc.indexOf('// Tag-frequency stats'),
    );
    expect(callBlock).toContain('setting: row.setting');
    expect(callBlock).toContain('population: row.population');
  });

  it('does not pretend to backfill a column that does not exist', () => {
    // Job has no `specialty` column (prisma/schema.prisma). Selecting one
    // would be a runtime Prisma error, and claiming to resolve it would be
    // the same overclaim the disclosure above exists to prevent.
    const schema = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf-8');
    const jobModel = schema.slice(
      schema.indexOf('model Job {'),
      schema.indexOf('model Job {') + schema.slice(schema.indexOf('model Job {')).indexOf('\n}'),
    );
    expect(jobModel).not.toMatch(/^\s*specialty\s/m);
    expect(backfillSrc).not.toContain('specialty: true');
  });
});

describe('P1 #20 — the employer edit form shares the /post-job vocabulary', () => {
  // Both forms persist the same columns (app/api/jobs/update writes
  // `rawJobData.setting || null`), so any drift between them either ships the
  // donor vocabulary or makes new-only values unselectable.
  it('derives its option lists from the classifier maps, not hand-written arrays', () => {
    expect(editSrc).toContain("from '@/lib/pseo/category-tagger'");
    expect(editSrc).toContain('Object.keys(EMPLOYER_SETTING_TAGS)');
    expect(editSrc).toContain('Object.keys(EMPLOYER_POPULATION_TAGS)');
  });

  it('no donor psych-era option strings remain in the edit form source', () => {
    for (const donorOption of DONOR_OPTION_STRINGS) {
      expect(editSrc, donorOption).not.toContain(donorOption);
    }
  });

  it('renders the derived lists rather than a stale local constant', () => {
    expect(editSrc).toContain('settingOptions.map');
    expect(editSrc).toContain('populationOptions.map');
  });

  it('keeps a stored value the current vocabulary dropped selectable', () => {
    // Rows still carry pre-P1 and LLM-written values. If the select cannot
    // show them, opening the form blanks the field and the next save
    // rewrites a real value to null — data loss, not just a display bug.
    expect(editSrc).toContain('optionsWithStoredValue');
    expect(editSrc).toContain("optionsWithStoredValue(SETTING_OPTIONS, watch('setting'))");
    expect(editSrc).toContain("optionsWithStoredValue(POPULATION_OPTIONS, watch('population'))");
  });
});

describe('P1 #20 — every new-only option value can round-trip through both forms', () => {
  it('the edit form offers the identical setting/population vocabulary', async () => {
    const { EMPLOYER_SETTING_TAGS, EMPLOYER_POPULATION_TAGS } =
      await import('@/lib/pseo/category-tagger');
    // Both files build their lists with Object.keys over the same frozen
    // maps, so parity is structural. Assert the values actually exist so a
    // future map edit that empties an axis fails loudly here.
    const settings = Object.keys(EMPLOYER_SETTING_TAGS);
    const populations = Object.keys(EMPLOYER_POPULATION_TAGS);
    expect(settings.length).toBeGreaterThan(0);
    expect(populations.length).toBeGreaterThan(0);
    for (const value of [...settings, ...populations]) {
      // No option may be a donor string smuggled back in through the map.
      expect(DONOR_OPTION_STRINGS as readonly string[]).not.toContain(value);
    }
  });
});
