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
  DEFAULT_INPUTS,
  DEFAULT_TIME_TO_FILL_DAYS,
  FLAT_FEE_COST_PER_DAY,
  FLAT_FEE_PRICING,
  FREE_POST_SCOPE_NOTE,
  compareChannels,
  flatFeeSpend,
  rankByCostPerHire,
  type CostPerHireInputs,
} from '@/components/tools/cost-per-hire-model';

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
    expect(FLAT_FEE_PRICING.postingPrice).toBe(config.postingPrice);
    expect(FLAT_FEE_PRICING.renewalPrice).toBe(config.renewalPrice);
    expect(FLAT_FEE_PRICING.freePostsPerDomain).toBe(config.freePostsPerEmail);
    expect(FLAT_FEE_PRICING.paidDurationDays).toBe(config.durationDays);
    expect(FLAT_FEE_PRICING.freeDurationDays).toBe(config.freeDurationDays);
    expect(FLAT_FEE_PRICING.candidateUnlocksPerPosting).toBe(config.limits.candidateUnlocksPerPosting);
    expect(FLAT_FEE_PRICING.inmailsPerPosting).toBe(config.limits.inmailsPerPosting);
    expect(FLAT_FEE_COST_PER_DAY).toBeCloseTo(config.postingPrice / config.durationDays, 8);
  });

  it('hardcodes no price in the model or the widget', () => {
    for (const file of ['components/tools/cost-per-hire-model.ts', NEW_COMPONENTS[2]]) {
      const code = readCode(file);
      expect(code).not.toContain(String(config.postingPrice));
      expect(code).not.toContain(String(config.renewalPrice));
    }
  });

  it('derives its only two non-zero defaults from repo data', () => {
    // Applicant volume: a plan feature, stated as such — not a response-rate benchmark.
    expect(DEFAULT_APPLICANTS_PER_ROLE).toBe(config.limits.candidateUnlocksPerPosting);
    // Time to fill: the posting window, applied identically to every channel.
    expect(DEFAULT_TIME_TO_FILL_DAYS).toBe(config.durationDays);
    expect(DEFAULT_INPUTS.flatFeeTimeToFillDays).toBe(DEFAULT_TIME_TO_FILL_DAYS);
    expect(DEFAULT_INPUTS.cpcTimeToFillDays).toBe(DEFAULT_TIME_TO_FILL_DAYS);
    expect(DEFAULT_INPUTS.agencyTimeToFillDays).toBe(DEFAULT_TIME_TO_FILL_DAYS);
    // First-year base: the cited median, the only salary figure this board asserts.
    expect(DEFAULT_FIRST_YEAR_BASE).toBe(Number(STAT_SOURCES.averageSalary.value));
    expect(DEFAULT_INPUTS.firstYearBase).toBe(DEFAULT_FIRST_YEAR_BASE);
  });

  it('starts every unsourceable input at zero', () => {
    expect(DEFAULT_INPUTS.cpcSpendPerRole).toBe(0);
    expect(DEFAULT_INPUTS.cpcApplicantsPerRole).toBe(0);
    expect(DEFAULT_INPUTS.agencyFeePct).toBe(0);
    expect(DEFAULT_INPUTS.dailyVacancyCost).toBe(0);
  });
});

/**
 * The free-post quota is the one place this tool states a RULE about our own
 * pricing rather than a price, and it is the first employer-facing surface to
 * state its scope at all (/pricing does not). The enforced rule is 1 free post
 * per employer EMAIL DOMAIN, lifetime, shared across every employee at that
 * domain — counted in app/api/jobs/post-free/route.ts against the immutable
 * EmployerJob.quotaDomain snapshot taken from the signup email.
 *
 * "Per account" is the failure this block exists to catch: a health system with
 * five recruiter accounts on one domain would tick the free-post box, read the
 * quota as one each, and model five free posts instead of one — understating its
 * flat-fee spend by 4 × the posting price. The scope is therefore asserted from
 * ONE exported string, and every surface is checked to render that string rather
 * than its own paraphrase.
 */
describe('cost per hire — the free-post quota is scoped to the domain', () => {
  const CPH_SURFACES = [
    'components/tools/cost-per-hire-model.ts',
    NEW_COMPONENTS[2],
    routeFile('/tools/cost-per-hire-calculator'),
  ] as const;

  it('states the quota against the email domain, with the config count', () => {
    expect(FREE_POST_SCOPE_NOTE).toContain(String(config.freePostsPerEmail));
    expect(FREE_POST_SCOPE_NOTE).toMatch(/per employer email domain/i);
    expect(FREE_POST_SCOPE_NOTE).toMatch(/lifetime/i);
    expect(FREE_POST_SCOPE_NOTE).toMatch(/shared/i);
    // The unit is never a login. This is the whole point of the constant.
    expect(FREE_POST_SCOPE_NOTE).not.toMatch(/account/i);
    expect(FREE_POST_SCOPE_NOTE).not.toMatch(/\buser\b/i);
  });

  it('has every surface render the shared note instead of paraphrasing it', () => {
    for (const file of [NEW_COMPONENTS[2], routeFile('/tools/cost-per-hire-calculator')]) {
      // More than once: the import plus at least one interpolation. A surface
      // that imports the note and then writes its own wording would pass a
      // bare `toContain`.
      const uses = readCode(file).match(/FREE_POST_SCOPE_NOTE/g) ?? [];
      expect(uses.length).toBeGreaterThan(1);
    }
  });

  it('never restates the quota as account-scoped', () => {
    for (const file of CPH_SURFACES) {
      // Comments stripped: this is about the copy a reader is shown.
      const code = readCode(file);
      expect(code).not.toMatch(/per account/i);
      expect(code).not.toMatch(/post(ing)?s? on an account/i);
      expect(code).not.toMatch(/this account has already/i);
      expect(code).not.toMatch(/freePostsPerAccount/);
    }
  });

  it('caps free postings at the domain quota however many roles are modelled', () => {
    const many = flatFeeSpend({ ...DEFAULT_INPUTS, roles: 5, useFreeFirstPost: true });
    expect(many.freePostings).toBe(config.freePostsPerEmail);
    expect(many.paidPostings).toBe(5 - config.freePostsPerEmail);
    // The five-recruiter case from the FAQ, priced.
    expect(many.total).toBe((5 - config.freePostsPerEmail) * config.postingPrice);
  });

  it('is the same constant the gate enforces against', () => {
    const gate = read('app/api/jobs/post-free/route.ts');
    expect(gate).toContain('config.freePostsPerEmail');
    // Counted per domain off the immutable snapshot, not per user or per email.
    expect(gate).toMatch(/quotaDomain:\s*quotaDomain/);
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

  it.each([NEW_COMPONENTS[2], routeFile('/tools/cost-per-hire-calculator')])(
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
    ...DEFAULT_INPUTS,
    roles: 4,
    useFreeFirstPost: false,
    cpcSpendPerRole: 600,
    cpcApplicantsPerRole: 30,
    agencyFeePct: 18,
    firstYearBase: 130_000,
  };

  it('prices the flat-fee plan from posts and renewals', () => {
    const spend = flatFeeSpend({ ...withNumbers, renewalsPerRole: 1 });
    expect(spend.freePostings).toBe(0);
    expect(spend.paidPostings).toBe(4);
    expect(spend.renewals).toBe(4);
    expect(spend.total).toBe(4 * config.postingPrice + 4 * config.renewalPrice);
  });

  it('applies the free first post once, not per role', () => {
    const spend = flatFeeSpend({ ...withNumbers, useFreeFirstPost: true });
    expect(spend.freePostings).toBe(config.freePostsPerEmail);
    expect(spend.paidPostings).toBe(4 - config.freePostsPerEmail);
    expect(spend.total).toBe((4 - config.freePostsPerEmail) * config.postingPrice);
  });

  it('reports an unfilled channel as not comparable rather than as zero', () => {
    const results = compareChannels({ ...DEFAULT_INPUTS, roles: 2 });
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

  it('excludes non-comparable channels from the ranking', () => {
    const ranked = rankByCostPerHire(compareChannels({ ...DEFAULT_INPUTS, roles: 1 }));
    expect(ranked.map((result) => result.key)).toEqual(['flatFee']);
  });
});
