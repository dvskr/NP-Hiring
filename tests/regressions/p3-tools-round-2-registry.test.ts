/**
 * P3 #2 / #6a / #6b — guards for the second round of /tools.
 *
 * Three tools ship here: a specialty preference sort, a private-practice
 * revenue projector, and an employer cost-per-hire calculator. Each one is a
 * different way to publish a wrong number, so each gets a different guard:
 *
 *   - specialty finder: the affinity sets are checked against the QUESTION
 *     options (a typo'd option value would silently stop matching), every slug
 *     is checked against the canonical taxonomy AND the physical route folder,
 *     the salary-page link is checked to be gated, and the premium band is
 *     checked to be the one specialty-config publishes rather than a copy.
 *   - revenue projector: every default is checked against the figures published
 *     on /resources/private-practice-guide by PARSING that page's source, and
 *     guideBand() is checked to reproduce the band that page renders. This is
 *     the whole basis for calling the defaults traceable — if the guide is
 *     edited, this fails with both numbers in the diff.
 *   - cost-per-hire: prices are checked against lib/config, and the model is
 *     checked to report an unfilled channel as NOT COMPARABLE rather than as
 *     zero, which would render an agency as free.
 *
 * Plus the structural rules the P2 package established for every tool route.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { TOOLS, TOOL_PATHS } from '@/app/tools/tools-registry';
import { config } from '@/lib/config';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';
import {
  SALARY_SPECIALTY_PAGES,
  SALARY_SPECIALTY_SLUGS,
} from '@/app/salary-guide/specialty/specialty-config';
import {
  QUIZ_QUESTIONS,
  QUIZ_QUESTION_COUNT,
  SPECIALTY_PROFILES,
  UNKNOWN_PROFILE_SLUGS,
  rankSpecialties,
  type QuizAnswers,
} from '@/components/tools/specialty-quiz-model';
import {
  GUIDE_MODEL,
  GUIDE_SCENARIOS,
  SENSITIVITY_STEPS,
  guideBand,
  oneMoreVisitPerWeek,
  presetFor,
  project,
  sensitivity,
  type ProjectorInputs,
} from '@/components/tools/practice-revenue-model';
import {
  DEFAULT_APPLICANTS_PER_ROLE,
  DEFAULT_FIRST_YEAR_BASE,
  DEFAULT_PLAN_MONTHS,
  DEFAULT_TIME_TO_FILL_DAYS,
  FLAT_FEE_COST_PER_DAY,
  FLAT_FEE_PRICING,
  FREE_POST_SCOPE_NOTE,
  INTRO_PRICE_SCOPE_NOTE,
  PLAN_NO_RENEWALS_NOTE,
  RENEWAL_SCOPE_NOTE,
  compareChannels,
  defaultInputs,
  flatFeeModeOptions,
  flatFeeSpend,
  pricingPhase,
  rankByCostPerHire,
  type CostPerHireInputs,
  type PricingPhase,
} from '@/components/tools/cost-per-hire-model';
import {
  costPerHireAssumptions,
  costPerHireFaqs,
  postRoleBlurb,
} from '@/app/tools/cost-per-hire-calculator/cost-per-hire-copy';
import { LADDER_PRICES } from '@/lib/pricing-copy';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const NEW_TOOL_PATHS = [
  '/tools/specialty-finder',
  '/tools/private-practice-revenue-calculator',
  '/tools/cost-per-hire-calculator',
] as const;

const NEW_COMPONENTS = [
  'components/tools/SpecialtyFinderQuiz.tsx',
  'components/tools/PracticeRevenueProjector.tsx',
  'components/tools/EmployerCostPerHireCalculator.tsx',
] as const;

const NEW_MODELS = [
  'components/tools/specialty-quiz-model.ts',
  'components/tools/practice-revenue-model.ts',
  'components/tools/cost-per-hire-model.ts',
] as const;

const routeFile = (toolPath: string) => `app${toolPath}/page.tsx`;
const GUIDE_FILE = 'app/resources/private-practice-guide/page.tsx';
/** The cost-per-hire page's method notes and FAQ, built per pricing phase (backlog 2.1). */
const CPH_COPY = 'app/tools/cost-per-hire-calculator/cost-per-hire-copy.ts';
/** Both pricing phases, so every cost-per-hire default is checked in each. */
const PHASES: readonly PricingPhase[] = ['promo', 'ladder'];

/** Removes jsonLd(...) calls so what remains is markup a reader sees. */
function stripJsonLd(src: string): string {
  const NEEDLE = 'jsonLd(';
  let out = '';
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf(NEEDLE, i);
    if (start === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, start);
    let depth = 0;
    let j = start + NEEDLE.length - 1;
    for (; j < src.length; j += 1) {
      if (src[j] === '(') depth += 1;
      else if (src[j] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
  return out;
}

// ─── Registry ───────────────────────────────────────────────────────────────

describe('registry carries the P3 tools', () => {
  it.each([...NEW_TOOL_PATHS])('%s is registered and has a route file', (toolPath) => {
    expect(TOOL_PATHS).toContain(toolPath);
    expect(exists(routeFile(toolPath))).toBe(true);
  });

  it('keeps every path unique', () => {
    expect(new Set(TOOL_PATHS).size).toBe(TOOL_PATHS.length);
  });

  it('covers both audiences across the new tools', () => {
    const audiences = new Set(
      TOOLS.filter((tool) => (NEW_TOOL_PATHS as readonly string[]).includes(tool.path)).map(
        (tool) => tool.audience,
      ),
    );
    expect(audiences.has('seeker')).toBe(true);
    expect(audiences.has('employer')).toBe(true);
  });

  it('gives every icon key a component on the hub', () => {
    const hub = readCode('app/tools/page.tsx');
    for (const tool of TOOLS) {
      expect(hub).toContain(`${tool.icon}:`);
    }
  });

  it('derives the hub tool count instead of hardcoding it', () => {
    const hub = read('app/tools/page.tsx');
    expect(hub).not.toMatch(/Four calculators/);
    expect(hub).toContain('{TOOLS.length} tools');
  });

  it('stays a plain data module the sitemap can import safely', () => {
    const src = read('app/tools/tools-registry.ts');
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['@/config/brand']);
  });
});

// ─── Route conventions (the P2 contract, applied to the new routes) ──────────

describe.each([...NEW_TOOL_PATHS])('%s route', (toolPath) => {
  const src = read(routeFile(toolPath));

  it('declares a canonical URL', () => {
    expect(src).toMatch(/alternates:\s*\{\s*canonical/);
  });

  it('escapes serialized JSON-LD with the repo pattern', () => {
    expect(src).toContain("replace(/</g, '\\\\u003c').replace(/>/g, '\\\\u003e')");
  });

  it('emits FAQPage JSON-LD from the array the page renders', () => {
    expect(src).toContain("'@type': 'FAQPage'");
    expect(src).toMatch(/FAQS\.map\(\(\{ q, a \}\) => \(/);
    expect(stripJsonLd(readCode(routeFile(toolPath)))).toContain('FAQS.map');
  });

  it('renders a visible assumptions panel with exclusions', () => {
    expect(src).toContain('AssumptionsPanel');
    expect(src).toMatch(/assumptions=\{/);
    expect(src).toMatch(/exclusions=\{/);
  });

  it('renders visible breadcrumbs back to the hub', () => {
    expect(src).toContain("from '@/components/Breadcrumbs'");
    expect(src).toContain("label: 'Tools', href: '/tools'");
  });

  it('takes niche identity from config/brand, never from a literal', () => {
    expect(src).not.toMatch(/\bNurse Practitioners?\b/);
    expect(src).not.toMatch(/\bPMHNP\b/);
  });
});

describe('new source files carry no reference-niche literals', () => {
  it.each([...NEW_TOOL_PATHS.map(routeFile), ...NEW_COMPONENTS, ...NEW_MODELS])(
    '%s',
    (file) => {
      const src = read(file).toLowerCase();
      expect(src).not.toContain('pmhnp');
      expect(src).not.toContain('psychiatric');
      expect(src).not.toContain('mental health');
    },
  );
});

describe('new components keep the tool accessibility contract', () => {
  it.each([...NEW_COMPONENTS])('%s gives every input and select an id', (file) => {
    const src = readCode(file);
    for (const tag of ['<input', '<select']) {
      for (const chunk of src.split(tag).slice(1)) {
        const attrs = chunk.slice(0, chunk.indexOf('>'));
        expect(attrs).toMatch(/\sid=/);
      }
    }
  });

  it.each([...NEW_COMPONENTS])('%s labels its controls and ships the focus ring', (file) => {
    const src = readCode(file);
    expect(src).toContain('<label');
    expect(src).toContain('<ToolStyles />');
    expect(src).toContain('tool-control');
  });

  it.each([...NEW_COMPONENTS])('%s ships no debug logging', (file) => {
    expect(read(file)).not.toContain('console.log');
  });
});

// ─── Specialty finder (P3 #2) ───────────────────────────────────────────────

describe('specialty finder — questions', () => {
  it('asks between six and ten questions', () => {
    expect(QUIZ_QUESTION_COUNT).toBeGreaterThanOrEqual(6);
    expect(QUIZ_QUESTION_COUNT).toBeLessThanOrEqual(10);
  });

  it('keeps question ids and dimension labels unique', () => {
    const ids = QUIZ_QUESTIONS.map((question) => question.id);
    const dimensions = QUIZ_QUESTIONS.map((question) => question.dimension);
    expect(new Set(ids).size).toBe(ids.length);
    // The dimension label is used as a React key on the result chips.
    expect(new Set(dimensions).size).toBe(dimensions.length);
  });

  it('gives every question at least three distinct options', () => {
    for (const question of QUIZ_QUESTIONS) {
      const values = question.options.map((option) => option.value);
      expect(values.length).toBeGreaterThanOrEqual(3);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe('specialty finder — profiles', () => {
  it('publishes only slugs the taxonomy still carries', () => {
    expect(UNKNOWN_PROFILE_SLUGS).toEqual([]);
    expect(SPECIALTY_PROFILES.length).toBeGreaterThanOrEqual(15);
  });

  it('keeps one profile per slug', () => {
    const slugs = SPECIALTY_PROFILES.map((profile) => profile.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('covers every specialty and APRN slug in the taxonomy', () => {
    const covered = new Set(SPECIALTY_PROFILES.map((profile) => profile.slug));
    for (const slug of [...CATEGORY_AXES.specialty, ...CATEGORY_AXES.aprn]) {
      expect(covered.has(slug)).toBe(true);
    }
  });

  /**
   * The important one: an affinity value that is not an option value of its own
   * question can never match, so a typo would quietly drop a whole dimension
   * out of the scoring without failing anything else.
   */
  it('uses only real option values in every affinity set', () => {
    for (const profile of SPECIALTY_PROFILES) {
      for (const question of QUIZ_QUESTIONS) {
        const allowed = question.options.map((option) => option.value);
        const affinity = profile.affinities[question.id];
        expect(affinity, `${profile.slug} / ${question.id}`).toBeDefined();
        expect(affinity.length, `${profile.slug} / ${question.id} is empty`).toBeGreaterThan(0);
        for (const value of affinity) {
          expect(allowed, `${profile.slug} / ${question.id} / ${value}`).toContain(value);
        }
      }
    }
  });
});

describe('specialty finder — links resolve', () => {
  const answers: QuizAnswers = { population: 'adults' };
  const matches = rankSpecialties(answers);

  it('points every result at a real category route folder', () => {
    for (const match of matches) {
      expect(match.jobsPath).toBe(`/jobs/${match.slug}`);
      expect(exists(`app/jobs/${match.slug}/page.tsx`)).toBe(true);
    }
  });

  it('links a specialty salary page only where one exists', () => {
    for (const match of matches) {
      if (SALARY_SPECIALTY_SLUGS.includes(match.slug)) {
        expect(match.salaryPath).toBe(`/salary-guide/specialty/${match.slug}`);
      } else {
        expect(match.salaryPath).toBeNull();
      }
    }
    // And the gated route template exists at all.
    expect(exists('app/salary-guide/specialty/[specialty]/page.tsx')).toBe(true);
  });

  it('takes premium bands from specialty-config rather than restating them', () => {
    for (const match of matches) {
      const configured = SALARY_SPECIALTY_PAGES.find((page) => page.slug === match.slug);
      expect(match.premium).toEqual(configured?.premium ?? null);
    }
    // At least one result actually carries a band, or the assertion above is vacuous.
    expect(matches.some((match) => match.premium !== null)).toBe(true);
  });

  it('publishes no certification claim of its own', () => {
    const model = read('components/tools/specialty-quiz-model.ts');
    for (const body of ['AANP', 'ANCC', 'NBCRNA', 'AMCB', 'PNCB', 'AACN']) {
      expect(model).not.toContain(body);
    }
  });

  it('cautions on APRN roles that are not the board’s niche role', () => {
    for (const match of matches) {
      const isAprn = (CATEGORY_AXES.aprn as readonly string[]).includes(match.slug);
      if (isAprn) expect(match.distinctRoleNote).toBeTruthy();
      else expect(match.distinctRoleNote).toBeNull();
    }
  });
});

describe('specialty finder — scoring', () => {
  it('scores nothing before an answer is given', () => {
    const matches = rankSpecialties({});
    expect(matches.length).toBe(SPECIALTY_PROFILES.length);
    for (const match of matches) {
      expect(match.matchedCount).toBe(0);
      expect(match.answeredCount).toBe(0);
      expect(match.matchPct).toBe(0);
    }
  });

  it('keeps the unanswered order stable and equal to profile order', () => {
    const first = rankSpecialties({}).map((match) => match.slug);
    const second = rankSpecialties({}).map((match) => match.slug);
    expect(first).toEqual(second);
    expect(first).toEqual(SPECIALTY_PROFILES.map((profile) => profile.slug));
  });

  it('reports matched over answered, not over the question count', () => {
    const matches = rankSpecialties({ population: 'newborns', acuity: 'high' });
    for (const match of matches) {
      expect(match.answeredCount).toBe(2);
      expect(match.matchPct).toBe(Math.round((match.matchedCount / 2) * 100));
      expect(match.matchedDimensions.length + match.unmatchedDimensions.length).toBe(2);
    }
    expect(matches[0].slug).toBe('neonatal');
    expect(matches[0].matchPct).toBe(100);
  });

  it('puts a fully consistent preference set on top with every dimension matched', () => {
    const electiveProcedural: QuizAnswers = {
      population: 'adults',
      acuity: 'low',
      setting: 'procedural',
      autonomy: 'independent',
      procedures: 'many',
      continuity: 'episodic',
      schedule: 'flexible',
      careMix: 'elective',
    };
    const matches = rankSpecialties(electiveProcedural);
    expect(matches[0].slug).toBe('aesthetics');
    expect(matches[0].matchedCount).toBe(QUIZ_QUESTION_COUNT);
    expect(matches[0].unmatchedDimensions).toEqual([]);
    // Ranking is descending.
    for (let i = 1; i < matches.length; i += 1) {
      expect(matches[i - 1].matchedCount).toBeGreaterThanOrEqual(matches[i].matchedCount);
    }
  });

  it('breaks ties by profile order rather than at random', () => {
    const acuteShiftWork: QuizAnswers = {
      population: 'lifespan',
      acuity: 'high',
      setting: 'hospital',
      autonomy: 'collaborative',
      procedures: 'many',
      continuity: 'episodic',
      schedule: 'shifts',
      careMix: 'medical',
    };
    const matches = rankSpecialties(acuteShiftWork);
    const emergencyIndex = matches.findIndex((match) => match.slug === 'emergency');
    const anesthesiaIndex = matches.findIndex((match) => match.slug === 'anesthesia');
    // Both score 8/8; emergency sits earlier in PROFILE_SEEDS, so it wins.
    expect(matches[emergencyIndex].matchedCount).toBe(matches[anesthesiaIndex].matchedCount);
    expect(emergencyIndex).toBeLessThan(anesthesiaIndex);
    expect(matches[0].slug).toBe('emergency');
  });
});

// ─── Private practice revenue projector (P3 #6a) ─────────────────────────────

describe('revenue projector — defaults trace to the published guide', () => {
  const guide = read(GUIDE_FILE);

  it('mirrors the guide’s model constants', () => {
    const weeks = guide.match(/workingWeeksPerYear:\s*(\d+)/);
    const insurance = guide.match(/insuranceCollectedPerVisit:\s*(\d+)/);
    const cash = guide.match(/cashCollectedPerVisit:\s*(\d+)/);
    expect(weeks).not.toBeNull();
    expect(insurance).not.toBeNull();
    expect(cash).not.toBeNull();
    expect(Number(weeks![1])).toBe(GUIDE_MODEL.workingWeeksPerYear);
    expect(Number(insurance![1])).toBe(GUIDE_MODEL.insuranceCollectedPerVisit);
    expect(Number(cash![1])).toBe(GUIDE_MODEL.cashCollectedPerVisit);
  });

  it('mirrors every published scenario, in order', () => {
    const parsed = [
      ...guide.matchAll(
        /label: '([^']+)',\s*visitsPerWeek: \{ min: (\d+), max: (\d+) \},\s*collectedPerVisit: PRACTICE_MODEL\.(\w+),\s*overhead: \{ min: ([\d.]+), max: ([\d.]+) \},/g,
      ),
    ].map((match) => ({
      label: match[1],
      visitsMin: Number(match[2]),
      visitsMax: Number(match[3]),
      collectedKey: match[4],
      overheadMin: Number(match[5]),
      overheadMax: Number(match[6]),
    }));

    expect(parsed.length).toBe(GUIDE_SCENARIOS.length);
    parsed.forEach((row, index) => {
      const mirrored = GUIDE_SCENARIOS[index];
      expect(mirrored.label).toBe(row.label);
      expect(mirrored.visitsPerWeek.min).toBe(row.visitsMin);
      expect(mirrored.visitsPerWeek.max).toBe(row.visitsMax);
      expect(mirrored.collectedPerVisit).toBe(
        GUIDE_MODEL[row.collectedKey as keyof typeof GUIDE_MODEL],
      );
      expect(mirrored.overhead.min).toBeCloseTo(row.overheadMin, 5);
      expect(mirrored.overhead.max).toBeCloseTo(row.overheadMax, 5);
    });
  });

  it('reproduces the band the guide’s table publishes', () => {
    const fullTimeTelehealth = GUIDE_SCENARIOS[1];
    const band = guideBand(fullTimeTelehealth);
    // 22 × 46 × 175 and 28 × 46 × 175, then the guide's worst/best pairing.
    expect(band.grossMin).toBe(177_100);
    expect(band.grossMax).toBe(225_400);
    expect(Math.round(band.netMin / 1000)).toBe(133);
    expect(Math.round(band.netMax / 1000)).toBe(192);
  });

  it('loads presets from band midpoints and zeroes the user-supplied fields', () => {
    for (const scenario of GUIDE_SCENARIOS) {
      const preset = presetFor(scenario);
      expect(preset.weeksPerYear).toBe(GUIDE_MODEL.workingWeeksPerYear);
      expect(preset.collectedPerVisit).toBe(scenario.collectedPerVisit);
      expect(preset.visitsPerWeek).toBe(
        Math.round((scenario.visitsPerWeek.min + scenario.visitsPerWeek.max) / 2),
      );
      expect(preset.overheadPct).toBeCloseTo(
        ((scenario.overhead.min + scenario.overhead.max) / 2) * 100,
        5,
      );
      // Nothing in repo data supports a figure for either of these.
      expect(preset.noShowPct).toBe(0);
      expect(preset.fixedAnnualCosts).toBe(0);
    }
  });
});

describe('revenue projector — arithmetic', () => {
  const base: ProjectorInputs = {
    visitsPerWeek: 25,
    weeksPerYear: 46,
    collectedPerVisit: 175,
    overheadPct: 20,
    noShowPct: 0,
    fixedAnnualCosts: 0,
  };

  it('reproduces a hand-worked case to the dollar', () => {
    const result = project(base);
    expect(result.scheduledVisits).toBe(1150);
    expect(result.completedVisits).toBe(1150);
    expect(result.grossCollections).toBe(201_250);
    expect(result.overheadCost).toBeCloseTo(40_250, 6);
    expect(result.netBeforeTax).toBeCloseTo(161_000, 6);
    expect(result.netPerCompletedVisit).toBeCloseTo(140, 6);
    expect(result.totalCostPctOfGross).toBeCloseTo(20, 6);
  });

  it('drops no-shows out of completed visits and collections', () => {
    const withNoShows = project({ ...base, noShowPct: 10 });
    expect(withNoShows.scheduledVisits).toBe(1150);
    expect(withNoShows.completedVisits).toBeCloseTo(1035, 6);
    expect(withNoShows.grossCollections).toBeCloseTo(181_125, 6);
  });

  it('subtracts fixed costs as dollars, not as a share', () => {
    const withFixed = project({ ...base, fixedAnnualCosts: 24_000 });
    expect(withFixed.grossCollections).toBe(201_250);
    expect(withFixed.overheadCost).toBeCloseTo(40_250, 6);
    expect(withFixed.netBeforeTax).toBeCloseTo(137_000, 6);
    expect(withFixed.totalCostPctOfGross).toBeGreaterThan(20);
  });

  it('never divides by zero or returns a nonsense figure on empty inputs', () => {
    const empty = project({
      visitsPerWeek: 0,
      weeksPerYear: 0,
      collectedPerVisit: 0,
      overheadPct: 0,
      noShowPct: 0,
      fixedAnnualCosts: 0,
    });
    expect(Number.isFinite(empty.netBeforeTax)).toBe(true);
    expect(empty.netBeforeTax).toBe(0);
    expect(empty.netPerCompletedVisit).toBe(0);
    expect(empty.totalCostPctOfGross).toBe(0);
  });

  it('treats negative inputs as zero rather than paying you to see patients', () => {
    const negative = project({ ...base, visitsPerWeek: -10, fixedAnnualCosts: -5000 });
    expect(negative.grossCollections).toBe(0);
    expect(negative.netBeforeTax).toBe(0);
  });

  it('moves one driver at a time in the sensitivity table', () => {
    const rows = sensitivity(base);
    expect(rows.map((row) => row.driver)).toEqual([
      'visitsPerWeek',
      'collectedPerVisit',
      'overheadPct',
    ]);
    for (const row of rows) {
      expect(row.points.map((point) => point.step)).toEqual([...SENSITIVITY_STEPS]);
      expect(row.swing).toBeGreaterThan(0);
    }
    // Volume and reimbursement are symmetric drivers of gross, so a ±20% move
    // on either has to swing the net by the same amount.
    expect(rows[0].swing).toBeCloseTo(rows[1].swing, 6);
    // A higher overhead share must lower the net.
    const overhead = rows[2];
    const up = overhead.points.find((point) => point.step === 0.2);
    expect(up?.netDelta).toBeLessThan(0);
  });

  it('prices one more visit a week at the marginal contribution', () => {
    const delta = oneMoreVisitPerWeek(base);
    // 46 weeks × $175 × (1 − 20% overhead).
    expect(delta).toBeCloseTo(46 * 175 * 0.8, 6);
  });
});

/**
 * The sensitivity columns are RELATIVE moves on each input's own value, which is
 * unambiguous for visits and dollars and ambiguous for the overhead row: a "+20%"
 * column on a 20%-of-collections overhead share is 24%, not 40%, and not "+20
 * percentage points". The model computes both the base value and each stepped
 * value; if neither reaches the page the reader has to guess which reading
 * applies, so both are rendered with their unit.
 */
describe('revenue projector — the sensitivity table shows its own units', () => {
  const WIDGET = 'components/tools/PracticeRevenueProjector.tsx';

  it('renders every value the sensitivity model computes', () => {
    const code = readCode(WIDGET);
    expect(code).toContain('row.baseValue');
    expect(code).toContain('point.value');
    expect(code).toContain('point.net');
    expect(code).toContain('row.swing');
  });

  it('labels a stepped value with its unit, not as a bare number', () => {
    const code = readCode(WIDGET);
    expect(code).toContain('of collections');
    expect(code).toContain('visits/wk');
  });

  it('steps the driver relatively, which is what the copy now says', () => {
    const base: ProjectorInputs = presetFor(GUIDE_SCENARIOS[0]);
    expect(base.overheadPct).toBeGreaterThan(0);
    const widest = Math.max(...SENSITIVITY_STEPS.map(Math.abs));
    const overhead = sensitivity(base).find((row) => row.driver === 'overheadPct');
    expect(overhead?.baseValue).toBe(base.overheadPct);
    const up = overhead?.points.find((point) => point.step === widest);
    expect(up?.value).toBeCloseTo(base.overheadPct * (1 + widest), 6);
    // Not percentage points — the misreading the table now forecloses.
    expect(up?.value).not.toBeCloseTo(base.overheadPct + widest * 100, 6);
  });
});

/**
 * /resources/private-practice-guide already ships an unsourced "90-180 days"
 * credentialing timeline (pre-existing debt, tracked by
 * p3-guides-round-2-malpractice-credentialing). This tool must not propagate it:
 * a calculator whose stated reason for omitting vendor pricing is that invented
 * figures expire cannot then print an invented timeline.
 */
describe('revenue projector — no unsourced timeline on a new surface', () => {
  it.each([
    routeFile('/tools/private-practice-revenue-calculator'),
    'components/tools/PracticeRevenueProjector.tsx',
  ])('%s prints no credentialing day count', (file) => {
    const src = readCode(file);
    expect(src).not.toMatch(/\d+\s*[-–]\s*\d+\s*days/);
    expect(src).not.toMatch(/credentialing[^.]{0,120}\d+\s*days/i);
  });
});

// ─── Employer cost per hire (P3 #6b) ────────────────────────────────────────

describe('cost per hire — prices come from the pricing config', () => {
  it('quotes nothing the checkout would not charge', () => {
    // 2026-09-12 launch promo + 2027 ladder: every rung and date the widget
    // can print is the config token the checkout / webhook charge against.
    expect(FLAT_FEE_PRICING.introPrice).toBe(config.introPrice);
    expect(FLAT_FEE_PRICING.postingPrice).toBe(config.postingPrice);
    expect(FLAT_FEE_PRICING.renewalPrice).toBe(config.renewalPrice);
    expect(FLAT_FEE_PRICING.renewalCapDays).toBe(config.renewalCapDays);
    expect(FLAT_FEE_PRICING.planPrice).toBe(config.planPrice);
    expect(FLAT_FEE_PRICING.planSlots).toBe(config.planSlots);
    expect(FLAT_FEE_PRICING.durationDays).toBe(config.durationDays);
    expect(FLAT_FEE_PRICING.promoEndsLabel).toBe(config.promoEndsLabel);
    expect(FLAT_FEE_PRICING.ladderStartsLabel).toBe(config.ladderStartsLabel);
    expect(FLAT_FEE_PRICING.candidateUnlocksPerPosting).toBe(config.limits.candidateUnlocksPerPosting);
    expect(FLAT_FEE_PRICING.inmailsPerPosting).toBe(config.limits.inmailsPerPosting);
    expect(FLAT_FEE_COST_PER_DAY).toBeCloseTo(config.postingPrice / config.durationDays, 8);
  });

  it('hardcodes no price in the model or the widget', () => {
    for (const file of ['components/tools/cost-per-hire-model.ts', NEW_COMPONENTS[2]]) {
      const code = readCode(file);
      expect(code).not.toContain(String(config.introPrice));
      expect(code).not.toContain(String(config.postingPrice));
      expect(code).not.toContain(String(config.renewalPrice));
      expect(code).not.toContain(String(config.planPrice));
    }
  });

  it.each(PHASES)('derives its only two non-zero defaults from repo data (%s phase)', (phase) => {
    const defaults = defaultInputs(phase);
    // Applicant volume: a plan feature, stated as such — not a response-rate benchmark.
    expect(DEFAULT_APPLICANTS_PER_ROLE).toBe(config.limits.candidateUnlocksPerPosting);
    expect(defaults.flatFeeApplicantsPerRole).toBe(DEFAULT_APPLICANTS_PER_ROLE);
    // Time to fill: the posting window, applied identically to every channel.
    expect(DEFAULT_TIME_TO_FILL_DAYS).toBe(config.durationDays);
    expect(defaults.flatFeeTimeToFillDays).toBe(DEFAULT_TIME_TO_FILL_DAYS);
    expect(defaults.cpcTimeToFillDays).toBe(DEFAULT_TIME_TO_FILL_DAYS);
    expect(defaults.agencyTimeToFillDays).toBe(DEFAULT_TIME_TO_FILL_DAYS);
    // First-year base: the cited median, the only salary figure this board asserts.
    expect(DEFAULT_FIRST_YEAR_BASE).toBe(Number(STAT_SOURCES.averageSalary.value));
    expect(defaults.firstYearBase).toBe(DEFAULT_FIRST_YEAR_BASE);
    // Plan length: the posting window in whole billing months — a product
    // fact, not an estimate of how long anyone subscribes.
    expect(DEFAULT_PLAN_MONTHS).toBe(Math.ceil(config.durationDays / 30));
    expect(defaults.planMonths).toBe(DEFAULT_PLAN_MONTHS);
    expect(defaults.useIntroPrice).toBe(true);
  });

  it('opens on the promo while it runs and on the per-post ladder once it has ended (backlog 2.1)', () => {
    // So the widget never opens on a $0 price once the launch window has closed.
    expect(defaultInputs('promo').flatFeeMode).toBe('promo');
    expect(defaultInputs('ladder').flatFeeMode).toBe('per-post');
    expect(pricingPhase(new Date('2026-12-31T12:00:00Z'))).toBe('promo');
    expect(pricingPhase(new Date(Date.parse(config.promoEndsAt) - 1))).toBe('promo');
    expect(pricingPhase(new Date(config.promoEndsAt))).toBe('ladder');
  });

  it.each(PHASES)('starts every unsourceable input at zero (%s phase)', (phase) => {
    const defaults = defaultInputs(phase);
    expect(defaults.cpcSpendPerRole).toBe(0);
    expect(defaults.cpcApplicantsPerRole).toBe(0);
    expect(defaults.agencyFeePct).toBe(0);
    expect(defaults.dailyVacancyCost).toBe(0);
  });
});

/**
 * Backlog 2.1: the promo is a way to buy only while it runs. Once
 * config.promoEndsAt has passed nobody can buy a promo post, so the widget
 * must not offer one, the ladder options must not be dated as a future
 * price, and the page copy must state the ladder as the current price. The
 * server page decides the phase per render and hands it to the client
 * widget, so the widget's server HTML and its hydrated state agree.
 */
describe('cost per hire — the promo is offered only while it runs (backlog 2.1)', () => {
  const PROMO_RUNNING = new Date('2026-12-31T12:00:00Z');
  const LADDER_LIVE = new Date(config.promoEndsAt);

  it('offers the promo and the dated ladder while it runs, exactly as before', () => {
    expect(flatFeeModeOptions('promo')).toEqual([
      { mode: 'promo', label: `Launch promo: free through ${config.promoEndsLabel}` },
      { mode: 'per-post', label: `Per post, from ${config.ladderStartsLabel}` },
      { mode: 'plan', label: `Employer plan, from ${config.ladderStartsLabel}` },
    ]);
    expect(pricingPhase(PROMO_RUNNING)).toBe('promo');
  });

  it('offers no promo mode once it has ended, and no option dates the ladder', () => {
    const options = flatFeeModeOptions(pricingPhase(LADDER_LIVE));
    expect(options.map((option) => option.mode)).toEqual(['per-post', 'plan']);
    for (const { label } of options) {
      expect(label).not.toMatch(/free|promo|\$0/i);
      expect(label).not.toContain(config.ladderStartsLabel);
      expect(label).not.toContain(config.promoEndsLabel);
    }
  });

  it('takes the phase from the server page and decides nothing at module load', () => {
    const widget = readCode(NEW_COMPONENTS[2]);
    expect(widget).toContain('flatFeeModeOptions(phase)');
    expect(widget).toContain('defaultInputs(phase)');
    // A client component reading the clock would hydrate against the browser's
    // clock and disagree with the server HTML around the switch.
    expect(widget).not.toContain('isPromoActive');
    expect(widget).not.toContain('new Date');
    const model = readCode('components/tools/cost-per-hire-model.ts');
    expect(model).not.toMatch(/^export const \w+(?::[^=]+)? = [^;]*isPromoActive\(/m);
    expect(model).not.toContain('DEFAULT_FLAT_FEE_MODE');
    const page = readCode(routeFile('/tools/cost-per-hire-calculator'));
    expect(page).toContain('export const revalidate = 3600;');
    expect(page).toContain('const phase = pricingPhase(new Date());');
    expect(page).toContain('<EmployerCostPerHireCalculator phase={phase} />');
    expect(page).toContain('const ASSUMPTIONS = costPerHireAssumptions(phase);');
    expect(page).toContain('const FAQS = costPerHireFaqs(phase);');
  });

  it('prints the method notes, the FAQ and the card exactly as before while the promo runs', () => {
    const assumptions = costPerHireAssumptions('promo');
    expect(assumptions).toHaveLength(10);
    expect(assumptions[1]).toBe(
      `Our own prices are read from the pricing config the checkout charges against. During the launch promo ${FREE_POST_SCOPE_NOTE}. From ${config.ladderStartsLabel}: your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or $${config.planPrice}/month for ${config.planSlots} active jobs. Every post runs ${config.durationDays} days and includes ${config.limits.candidateUnlocksPerPosting} candidate unlocks plus ${config.limits.inmailsPerPosting} direct messages. Renewal: ${RENEWAL_SCOPE_NOTE}; ${PLAN_NO_RENEWALS_NOTE}.`,
    );
    expect(assumptions[2]).toMatch(/^The promo result is a real price for a dated window/);
    const faqs = costPerHireFaqs('promo');
    expect(faqs).toHaveLength(7);
    expect(faqs[2].a).toContain(`a posting is a fixed price that does not: free during the launch promo, then $${config.introPrice} for your first post and $${config.postingPrice} after, or $${config.planPrice}/month for ${config.planSlots} active jobs.`);
    expect(faqs[5].a).toBe(
      `Every post (promo, intro, featured, or plan) runs ${config.durationDays} days, is featured, and includes ${config.limits.candidateUnlocksPerPosting} candidate profile unlocks and ${config.limits.inmailsPerPosting} direct messages. During the launch promo ${FREE_POST_SCOPE_NOTE}. From ${config.ladderStartsLabel}: your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or $${config.planPrice}/month for ${config.planSlots} active jobs. Renewal: ${RENEWAL_SCOPE_NOTE}; ${PLAN_NO_RENEWALS_NOTE}. Those are the prices in the calculator, read from the same config the checkout uses, so they cannot drift from what you would actually be charged.`,
    );
    expect(postRoleBlurb('promo')).toBe(`Free through ${config.promoEndsLabel}, every feature included.`);
  });

  it('states the ladder as the current price once the promo has ended, with promo posts only as history', () => {
    const phase = pricingPhase(LADDER_LIVE);
    const assumptions = costPerHireAssumptions(phase);
    const faqs = costPerHireFaqs(phase);
    // The promo-result note goes with the promo mode.
    expect(assumptions).toHaveLength(9);
    expect(assumptions.join('\n')).not.toMatch(/The promo result/);
    expect(assumptions[1]).toContain(LADDER_PRICES);
    expect(faqs[5].a).toContain(LADDER_PRICES);
    expect(faqs[5].a).toContain('Every post (intro, featured, or plan)');
    expect(faqs[2].a).toContain(`a posting is a fixed price that does not: $${config.introPrice} for your first post and $${config.postingPrice} after, or $${config.planPrice}/month for ${config.planSlots} active jobs.`);
    expect(postRoleBlurb(phase)).toBe(LADDER_PRICES);
    // The only promo mention left is the history that keeps the intro price unspent.
    const copy = [...assumptions, ...faqs.flatMap(({ q, a }) => [q, a]), postRoleBlurb(phase)]
      .join('\n')
      .replace(/Posts made free during the launch promo do not use (?:it|the intro price) up\./g, '');
    expect(copy).not.toContain(config.promoEndsLabel);
    expect(copy).not.toContain(config.ladderStartsLabel);
    expect(copy).not.toMatch(/free through|launch promo|launch period|\$0\b/i);
    expect(copy).not.toContain(FREE_POST_SCOPE_NOTE);
    // The rules stay stated through their shared notes in both phases.
    for (const note of [INTRO_PRICE_SCOPE_NOTE, RENEWAL_SCOPE_NOTE, PLAN_NO_RENEWALS_NOTE]) {
      expect(copy).toContain(note);
    }
  });
});

/**
 * The launch promo and the intro price are the two places this tool states a
 * RULE about our own pricing rather than a price. Each rule is asserted from
 * ONE exported string, and every surface is checked to render that string
 * rather than its own paraphrase:
 *
 *   - FREE_POST_SCOPE_NOTE: every post is free through config.promoEndsLabel
 *     for config.durationDays — a dated window, never "one free post" and
 *     never per account.
 *   - INTRO_PRICE_SCOPE_NOTE: from config.ladderStartsLabel the FIRST PAID
 *     post per employer EMAIL DOMAIN is config.introPrice, lifetime, shared
 *     across every employee at that domain — lib/pricing.ts#getNextPaidTier
 *     counts 'paid' rows against the immutable EmployerJob.quotaDomain
 *     snapshot taken from the signup email.
 *
 * "Per account" is the failure this block exists to catch: a health system
 * with five recruiter accounts on one domain would read the intro price as
 * one each and model five intro posts instead of one — understating its
 * per-post spend by 4 × (postingPrice − introPrice).
 */
describe('cost per hire — the promo and the intro price are stated from one string each', () => {
  const CPH_SURFACES = [
    'components/tools/cost-per-hire-model.ts',
    NEW_COMPONENTS[2],
    routeFile('/tools/cost-per-hire-calculator'),
    CPH_COPY,
  ] as const;

  it('states the promo as a dated window with the config duration, never per account', () => {
    expect(FREE_POST_SCOPE_NOTE).toBe(
      `every post is free through ${config.promoEndsLabel} (${config.durationDays} days, every feature, no card required)`,
    );
    expect(FREE_POST_SCOPE_NOTE).not.toMatch(/account/i);
    expect(FREE_POST_SCOPE_NOTE).not.toMatch(/\buser\b/i);
  });

  it('states the intro price against the email domain, with the config prices', () => {
    expect(INTRO_PRICE_SCOPE_NOTE).toContain(`$${config.introPrice}`);
    expect(INTRO_PRICE_SCOPE_NOTE).toContain(`$${config.postingPrice}`);
    expect(INTRO_PRICE_SCOPE_NOTE).toMatch(/per employer email domain/i);
    expect(INTRO_PRICE_SCOPE_NOTE).toMatch(/lifetime/i);
    expect(INTRO_PRICE_SCOPE_NOTE).toMatch(/shared/i);
    // The unit is never a login. This is the whole point of the constant.
    expect(INTRO_PRICE_SCOPE_NOTE).not.toMatch(/account/i);
    expect(INTRO_PRICE_SCOPE_NOTE).not.toMatch(/\buser\b/i);
  });

  it('has every surface render both shared notes instead of paraphrasing them', () => {
    // The page's method notes and FAQ live in CPH_COPY (built per pricing
    // phase, backlog 2.1), so that is where the page's notes are rendered.
    for (const file of [NEW_COMPONENTS[2], CPH_COPY]) {
      for (const note of ['FREE_POST_SCOPE_NOTE', 'INTRO_PRICE_SCOPE_NOTE']) {
        // More than once: the import plus at least one interpolation. A surface
        // that imports the note and then writes its own wording would pass a
        // bare `toContain`.
        const uses = readCode(file).match(new RegExp(note, 'g')) ?? [];
        expect(uses.length, `${file} interpolates ${note}`).toBeGreaterThan(1);
      }
    }
  });

  it('never restates the intro price as account-scoped', () => {
    for (const file of CPH_SURFACES) {
      // Comments stripped: this is about the copy a reader is shown.
      const code = readCode(file);
      expect(code).not.toMatch(/per account/i);
      expect(code).not.toMatch(/post(ing)?s? on an account/i);
      expect(code).not.toMatch(/this account has already/i);
      expect(code).not.toMatch(/introPricePerAccount|freePostsPerAccount/);
    }
  });

  it('applies the intro price once per domain however many roles are modelled', () => {
    const many = flatFeeSpend({ ...defaultInputs('ladder'), roles: 5, flatFeeMode: 'per-post', useIntroPrice: true });
    expect(many.introPostings).toBe(1);
    expect(many.proPostings).toBe(4);
    // The five-recruiter case from the FAQ, priced.
    expect(many.total).toBe(config.introPrice + 4 * config.postingPrice);
  });

  it('is the same rule the checkout prices against', () => {
    // lib/pricing.ts counts ONLY paid POSTS per quotaDomain (status 'paid'
    // bought through Checkout — a renewed promo post is 'paid' too but carries
    // only a 'renewal' charge, and a renewal is not a post); create-checkout
    // asks it for the rung; post-free snapshots the immutable domain anchor.
    const pricing = read('lib/pricing.ts');
    expect(pricing).toMatch(/quotaDomain,\s*paymentStatus:\s*'paid',\s*OR:\s*\[\s*\{\s*jobCharges:\s*\{\s*some:\s*\{\s*type:\s*'new'\s*\}\s*\}\s*\},\s*\{\s*jobCharges:\s*\{\s*none:\s*\{\}\s*\}\s*\},?\s*\]/);
    expect(pricing).toMatch(/where:\s*paidPostWhere\(quotaDomain\)/);
    expect(pricing).toMatch(/paid === 0 \? 'intro' : 'pro'/);
    expect(read('app/api/create-checkout/route.ts')).toContain('getNextPaidTier(quotaDomain)');
    expect(read('app/api/jobs/post-free/route.ts')).toMatch(/quotaDomain:\s*quotaDomain/);
  });
});
/**
 * Renewal and the plan are the other two pricing RULES this tool states. The
 * old copy said plan posts "stay live while the plan is active" and that you
 * could "renew any post": neither is what the code does. Every post, plan
 * included, runs config.durationDays (post-free writes the same expiresAt), a
 * plan post is never renewed (create-renewal-checkout answers 409), and the
 * monthly fee buys the SLOT, which frees when a post ends or is closed.
 */
describe('cost per hire — the renewal and plan rules are stated from one string each', () => {
  const CPH_SURFACES = [
    'components/tools/cost-per-hire-model.ts',
    NEW_COMPONENTS[2],
    routeFile('/tools/cost-per-hire-calculator'),
    CPH_COPY,
  ] as const;

  it('scopes renewal to the posts the renewal checkout accepts, at the config price', () => {
    expect(RENEWAL_SCOPE_NOTE).toBe(
      `a promo, intro or featured post renews for $${config.renewalPrice} (+${config.durationDays} days)`,
    );
    const renewalRoute = read('app/api/create-renewal-checkout/route.ts');
    expect(renewalRoute).toMatch(/paymentStatus === 'plan'\)\s*\{\s*return NextResponse\.json\([\s\S]*?status: 409/);
  });

  it('says plan posts run the posting window and the employer posts again, never that they stay live with the plan', () => {
    expect(PLAN_NO_RENEWALS_NOTE).toBe(
      `plan posts are not renewed: each runs ${config.durationDays} days, and when it ends you can post the role again into its slot at no extra charge`,
    );
    // Nothing reposts a plan post: the note must not read as an automatic return to the slot.
    expect(PLAN_NO_RENEWALS_NOTE).not.toMatch(/goes back|back into|put back/i);
    // The fact the note rests on: a plan post gets the same fixed expiry as every post.
    expect(read('app/api/jobs/post-free/route.ts')).toContain('const expiresAt = expiresFromNow(config.durationDays, now);');
  });

  it('has every surface render both notes instead of paraphrasing them', () => {
    for (const file of [NEW_COMPONENTS[2], CPH_COPY]) {
      for (const note of ['RENEWAL_SCOPE_NOTE', 'PLAN_NO_RENEWALS_NOTE']) {
        const uses = readCode(file).match(new RegExp(note, 'g')) ?? [];
        expect(uses.length, `${file} interpolates ${note}`).toBeGreaterThan(1);
      }
    }
  });

  it('never restates the claims the code does not back', () => {
    for (const file of CPH_SURFACES) {
      const code = readCode(file);
      expect(code, file).not.toMatch(/stay live while/i);
      expect(code, file).not.toMatch(/live while you('| a)re subscribed/i);
      expect(code, file).not.toMatch(/renew(ing)? any post/i);
      expect(code, file).not.toMatch(/fresh \$\{[^}]*\} unlocks|refresh(es)? its/i);
    }
  });

  it('states the renewal cap the renewal code applies', () => {
    const widget = readCode(NEW_COMPONENTS[2]);
    expect(widget).toContain('FLAT_FEE_PRICING.renewalCapDays');
    expect(widget).toContain('It does not add unlocks or messages.');
  });
});

/**
 * The cost-per-hire surfaces sell one of the three channels they compare, and
 * their stated premise is that the only figures asserted are ours and checkable.
 * An adverb of frequency or degree attached to "cheaper" breaks that premise: it
 * asserts a distribution across employers that we have never sampled, which is a
 * benchmark in everything but format — and it is exactly the benchmark the rest
 * of the page refuses to publish.
 *
 * The comparative is allowed only where the calculator computes it from the
 * reader's own inputs ("on your numbers"), which lives in the widget's rendered
 * result strings rather than in editorial copy.
 */
describe('cost per hire — no unmeasured comparative claims', () => {
  const SELF_SERVING = [
    /wide margin/i,
    /(usually|typically|generally|normally|nearly always|almost always|often)\s+(much\s+|far\s+|significantly\s+)?cheaper/i,
    /(much|far|significantly|dramatically|vastly)\s+cheaper/i,
  ];

  it.each([NEW_COMPONENTS[2], routeFile('/tools/cost-per-hire-calculator'), CPH_COPY])(
    '%s asserts no typical margin over the channels we do not price',
    (file) => {
      const code = readCode(file);
      for (const pattern of SELF_SERVING) {
        expect(code).not.toMatch(pattern);
      }
    },
  );

  it('keeps the disclosure that we sell one of the channels', () => {
    const page = readCode(routeFile('/tools/cost-per-hire-calculator'));
    expect(page).toMatch(/we sell/i);
    expect(readCode(NEW_COMPONENTS[2])).toMatch(/we sell/i);
  });
});

describe('cost per hire — comparison', () => {
  const withNumbers: CostPerHireInputs = {
    ...defaultInputs('ladder'),
    roles: 4,
    flatFeeMode: 'per-post',
    useIntroPrice: false,
    cpcSpendPerRole: 600,
    cpcApplicantsPerRole: 30,
    agencyFeePct: 18,
    firstYearBase: 130_000,
  };

  it('prices the per-post ladder from posts and renewals', () => {
    const spend = flatFeeSpend({ ...withNumbers, renewalsPerRole: 1 });
    expect(spend.mode).toBe('per-post');
    expect(spend.introPostings).toBe(0);
    expect(spend.proPostings).toBe(4);
    expect(spend.renewals).toBe(4);
    expect(spend.total).toBe(4 * config.postingPrice + 4 * config.renewalPrice);
  });

  it('applies the intro price once, not per role', () => {
    const spend = flatFeeSpend({ ...withNumbers, useIntroPrice: true });
    expect(spend.introPostings).toBe(1);
    expect(spend.proPostings).toBe(3);
    expect(spend.total).toBe(config.introPrice + 3 * config.postingPrice);
  });

  it('prices every post at zero during the launch promo, but still prices renewals', () => {
    const spend = flatFeeSpend({ ...withNumbers, flatFeeMode: 'promo', renewalsPerRole: 1 });
    expect(spend.promoPostings).toBe(4);
    expect(spend.introPostings + spend.proPostings + spend.planPostings).toBe(0);
    expect(spend.postingSpend).toBe(0);
    expect(spend.renewals).toBe(4);
    expect(spend.total).toBe(4 * config.renewalPrice);
  });

  it('prices the Employer plan as enough concurrent plans × months, with nothing to renew', () => {
    const roles = config.planSlots + 1;
    const spend = flatFeeSpend({ ...withNumbers, roles, flatFeeMode: 'plan', planMonths: 2, renewalsPerRole: 3 });
    expect(spend.planPostings).toBe(roles);
    expect(spend.planCount).toBe(Math.ceil(roles / config.planSlots));
    expect(spend.planMonths).toBe(2);
    expect(spend.planSpend).toBe(spend.planCount * 2 * config.planPrice);
    // A plan post is never renewed (it runs config.durationDays and the role
    // is posted again into the freed slot), so renewalsPerRole is ignored.
    expect(spend.renewals).toBe(0);
    expect(spend.renewalSpend).toBe(0);
    expect(spend.total).toBe(spend.planSpend);
  });
  it('reports an unfilled channel as not comparable rather than as zero', () => {
    const results = compareChannels({ ...defaultInputs('promo'), roles: 2 });
    const cpc = results.find((result) => result.key === 'cpc');
    const agency = results.find((result) => result.key === 'agency');
    expect(cpc?.isComparable).toBe(false);
    expect(cpc?.missingInput).toBeTruthy();
    expect(cpc?.costPerHire).toBeNull();
    expect(agency?.isComparable).toBe(false);
    expect(agency?.costPerHire).toBeNull();
    // Ours is always comparable, because its price is a fact.
    expect(results.find((result) => result.key === 'flatFee')?.isComparable).toBe(true);
  });

  it('reports nothing at all with no roles entered', () => {
    for (const result of compareChannels({ ...withNumbers, roles: 0 })) {
      expect(result.isComparable).toBe(false);
      expect(result.costPerHire).toBeNull();
    }
  });

  it('computes the agency fee as a share of first-year base', () => {
    const agency = compareChannels(withNumbers).find((result) => result.key === 'agency');
    expect(agency?.isComparable).toBe(true);
    expect(agency?.totalSpend).toBeCloseTo(4 * 0.18 * 130_000, 6);
    expect(agency?.costPerHire).toBeCloseTo(0.18 * 130_000, 6);
    // Agencies present shortlists, not an applicant pool.
    expect(agency?.costPerApplicant).toBeNull();
  });

  it('divides spend by applicants and by hires, and nothing else', () => {
    const results = compareChannels(withNumbers);
    const cpc = results.find((result) => result.key === 'cpc');
    expect(cpc?.totalSpend).toBe(2400);
    expect(cpc?.totalApplicants).toBe(120);
    expect(cpc?.costPerApplicant).toBeCloseTo(20, 6);
    expect(cpc?.costPerHire).toBeCloseTo(600, 6);
  });

  it('keeps the vacancy overlay off until a daily cost is entered', () => {
    for (const result of compareChannels(withNumbers)) {
      expect(result.vacancyCost).toBe(0);
      expect(result.totalWithVacancy).toBe(result.totalSpend);
    }
  });

  it('charges the vacancy overlay per role and per day once it is on', () => {
    const results = compareChannels({ ...withNumbers, dailyVacancyCost: 500 });
    const flat = results.find((result) => result.key === 'flatFee');
    expect(flat?.vacancyCost).toBe(500 * DEFAULT_TIME_TO_FILL_DAYS * 4);
    expect(flat?.totalWithVacancy).toBe((flat?.totalSpend ?? 0) + (flat?.vacancyCost ?? 0));
  });

  it('lists our own channel first, and ranks separately', () => {
    const results = compareChannels(withNumbers);
    expect(results[0].key).toBe('flatFee');
    const ranked = rankByCostPerHire(results);
    expect(ranked.length).toBe(3);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].costPerHire as number).toBeLessThanOrEqual(ranked[i].costPerHire as number);
    }
  });

  it.each(PHASES)('excludes non-comparable channels from the ranking (%s phase defaults)', (phase) => {
    const ranked = rankByCostPerHire(compareChannels({ ...defaultInputs(phase), roles: 1 }));
    expect(ranked.map((result) => result.key)).toEqual(['flatFee']);
  });
});
