/**
 * P1 #11 + #16 (state side) regression pins — plain /jobs/state/<state> hubs.
 *
 * #11: buildPlainStateNarrative gives each of the 51 state hubs a
 * deterministic, per-state-differentiated paragraph built ONLY from
 * caller-supplied live aggregates + repo regulatory data (practice
 * authority, NLC membership) — never invented figures.
 *
 * #16 (state side): the category pill list on the state hub derives from
 * STATE_ELIGIBLE_CATEGORY_SLUGS + live inventory gating instead of the old
 * stale 11-slug hardcoded array.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlainStateNarrative } from '@/lib/pseo/state-narrative';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { STATE_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';

const ROOT = process.cwd();
const pageSrc = () =>
  fs.readFileSync(path.join(ROOT, 'app/jobs/state/[state]/page.tsx'), 'utf8');

const baseInput = {
  stateName: 'Texas',
  stateCode: 'TX',
  totalJobs: 42,
  avgSalaryK: 128,
  uniqueEmployerCount: 17,
  topCategoryLabels: ['Remote', 'Family Practice', 'Telehealth'],
  topCityNames: ['Houston', 'Dallas', 'Austin'],
} as const;

describe('P1 #11: buildPlainStateNarrative', () => {
  it('is deterministic for identical input', () => {
    expect(buildPlainStateNarrative({ ...baseInput })).toBe(
      buildPlainStateNarrative({ ...baseInput }),
    );
  });

  it('differentiates all 51 jurisdictions even with identical stats', () => {
    const states = Object.keys(STATE_PRACTICE_AUTHORITY);
    expect(states.length).toBeGreaterThanOrEqual(51);
    const narratives = states.map((stateName) =>
      buildPlainStateNarrative({ ...baseInput, stateName }),
    );
    expect(new Set(narratives).size).toBe(states.length);
    for (const narrative of narratives) {
      // Substantive prose, not a one-liner shell.
      expect(narrative.length).toBeGreaterThan(300);
    }
  });

  it('uses the live salary aggregate and never invents a figure', () => {
    expect(buildPlainStateNarrative({ ...baseInput })).toContain('$128K');
    const withoutSalary = buildPlainStateNarrative({ ...baseInput, avgSalaryK: 0 });
    // No disclosed-pay data → no dollar figure of any kind.
    expect(withoutSalary).not.toContain('$');
    expect(withoutSalary).not.toContain('NaN');
  });

  it('branches the NLC note on real membership', () => {
    const ca = buildPlainStateNarrative({
      ...baseInput, stateName: 'California', stateCode: 'CA',
    });
    expect(ca).toContain('not a Nurse Licensure Compact member');
    const tx = buildPlainStateNarrative({ ...baseInput });
    expect(tx).toContain('Nurse Licensure Compact membership');
    expect(tx).not.toContain('not a Nurse Licensure Compact member');
  });

  it('reflects the practice-authority tier from lib/state-practice-authority', () => {
    const firstStateOfTier = (tier: string): string => {
      const entry = Object.entries(STATE_PRACTICE_AUTHORITY)
        .find(([, info]) => info.authority === tier);
      expect(entry, `no state with ${tier} authority in the dataset`).toBeDefined();
      return entry![0];
    };
    expect(
      buildPlainStateNarrative({ ...baseInput, stateName: firstStateOfTier('full') }),
    ).toContain('full practice authority');
    expect(
      buildPlainStateNarrative({ ...baseInput, stateName: firstStateOfTier('reduced') }),
    ).toContain('reduced practice authority');
    expect(
      buildPlainStateNarrative({ ...baseInput, stateName: firstStateOfTier('restricted') }),
    ).toContain('restricted practice authority');
  });

  it('mentions the live category and city inventory it was given', () => {
    const narrative = buildPlainStateNarrative({ ...baseInput });
    expect(narrative).toContain('Family Practice');
    expect(narrative).toContain('Houston, Dallas, and Austin');
    expect(narrative).toContain('42 active');
    expect(narrative).toContain('17 employers');
  });

  it('omits inventory clauses cleanly when data is empty', () => {
    const narrative = buildPlainStateNarrative({
      ...baseInput,
      topCategoryLabels: [],
      topCityNames: [],
      uniqueEmployerCount: 0,
    });
    expect(narrative).not.toContain('undefined');
    expect(narrative).not.toContain('concentrated in');
    expect(narrative).not.toContain('posting volume');
  });
});

describe('P1 #11/#16: /jobs/state/[state] page wiring', () => {
  it('renders the plain-state narrative', () => {
    expect(pageSrc()).toContain('buildPlainStateNarrative');
    expect(pageSrc()).toContain('{stateNarrative}');
  });

  it('derives category pills from the registry instead of a hardcoded slug list', () => {
    expect(pageSrc()).toContain('STATE_ELIGIBLE_CATEGORY_SLUGS');
    // The stale 11-slug hardcode is gone.
    expect(pageSrc()).not.toContain("{ slug: 'remote', label: 'Remote' }");
    // Inventory gating still applies before a pill renders.
    expect(pageSrc()).toMatch(/validSettingSlugs\.has\(slug\)/);
  });

  it('every state-eligible slug has a display label so pills never render raw slugs', () => {
    for (const slug of STATE_ELIGIBLE_CATEGORY_SLUGS) {
      expect(
        SETTING_CONFIGS[slug]?.label,
        `SETTING_CONFIGS is missing a label for state-eligible slug "${slug}"`,
      ).toBeTruthy();
    }
  });

  it('guards the pill block so an empty inventory renders no bare heading', () => {
    expect(pageSrc()).toContain('{categoryPills.length > 0 && (');
  });

  it('filters unlabeled rows before slicing the narrative category list', () => {
    // Slice-before-filter would silently shorten the list whenever a stale
    // pseoStats row for a retired slug outranks a live one.
    const src = pageSrc();
    const block = src.slice(
      src.indexOf('const topCategoryLabels'),
      src.indexOf('const stateNarrative'),
    );
    expect(block).toBeTruthy();
    expect(block.indexOf('.filter(')).toBeLessThan(block.indexOf('.slice('));
  });
});

describe('P1 #11: state hubs never fabricate a salary band', () => {
  it('has no unsourced $130K literals left anywhere on the page', () => {
    const src = pageSrc();
    // Three no-live-data fallbacks used to invent a band: the hero stat
    // ("$130K+"), the salary bento ("$130K–$200K+"), and the FAQ answer
    // ("$130K to $200K+") — the last of which also fed the FAQPage JSON-LD.
    expect(src).not.toMatch(/\$130K/i);
    expect(src).not.toMatch(/\$200K\+/i);
  });

  it('cites the BLS median from stats-sources on the no-data branches', () => {
    const src = pageSrc();
    expect(src).toContain("from '@/lib/stats-sources'");
    // Both the visible bento and the FAQ answer (→ JSON-LD) cite it.
    expect(
      src.match(/STAT_SOURCES\.averageSalary\.formatted/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(src).toContain('STAT_SOURCES.averageSalary.source');
  });

  it('omits the hero salary stat entirely rather than inventing one', () => {
    expect(pageSrc()).toMatch(
      /\.\.\.\(stats\.avgSalary > 0[\s\S]{0,160}label: 'avg salary'/,
    );
  });

  // The literal-string pins above only catch a band someone typed out. The
  // 4th fabricated band on this page was *computed* — the AggregateOffer
  // JSON-LD derived lowPrice/highPrice from `stats.avgSalary * 0.8 / * 1.2`,
  // an unsourced +/-20% spread the page never displayed — so it sailed past
  // them. This pin is on the shape of the fabrication, not its text.
  it('never derives a salary figure by arithmetic on the live average', () => {
    const src = pageSrc();
    // Comparisons (`stats.avgSalary > 0`) and interpolation (`$${...}K`) are
    // fine; multiplying/dividing/offsetting the aggregate invents a number.
    const derived = src.match(
      /stats\.avgSalary\s*[*/+-]\s*[\d.(]|[\d.)]\s*[*/]\s*stats\.avgSalary/g,
    );
    expect(
      derived,
      `computed salary figure(s) with no source: ${JSON.stringify(derived)}`,
    ).toBeNull();
  });

  it('emits no AggregateOffer price bounds in structured data', () => {
    const src = pageSrc();
    // schema.org lowPrice/highPrice mean cheapest/dearest offer in the set.
    // Neither the avg-of-mins/avg-of-maxes pair nor a collapsed point value
    // is a truthful reading, and neither is visible on the page.
    expect(src).not.toMatch(/'@type':\s*'AggregateOffer'/);
    expect(src).not.toMatch(/\b(lowPrice|highPrice)\s*:/);
  });

  it('keeps every JSON-LD dollar figure traceable to a live aggregate or a cited source', () => {
    const src = pageSrc();
    // No hardcoded thousands-scale money literals anywhere in the file —
    // any salary number must come from stats.* or STAT_SOURCES.*.
    const moneyLiterals = src.match(/\$\s?\d{2,3}(,\d{3}|[Kk]\b|000\b)/g);
    expect(
      moneyLiterals,
      `hardcoded salary literal(s): ${JSON.stringify(moneyLiterals)}`,
    ).toBeNull();
  });
});

// The plain-state narrative turned lib/state-practice-authority.ts from a
// bento tint into a flat regulatory assertion in body prose AND — via
// practiceAuthority.details in stateFaqs[1] — inside the FAQPage JSON-LD.
// That raises the bar on the dataset: a stale tier is now a published false
// claim on a YMYL surface, so pin it against the site's own cited figure.
describe('P1 #11: practice-authority tiers agree with the site-wide cited FPA stat', () => {
  const fullJurisdictions = () =>
    Object.entries(STATE_PRACTICE_AUTHORITY)
      .filter(([, info]) => info.authority === 'full')
      .map(([name]) => name);

  it('classifies exactly as many full-practice states as STAT_SOURCES claims', () => {
    // STAT_SOURCES.fullPracticeStates is rendered as a cited AANP stat on
    // /jobs, /faq, /salary-guide and /for-employers/resources/how-to-hire.
    // D.C. is a jurisdiction in the dataset, not a state, so exclude it
    // before comparing against the "<n> states + DC" figure.
    const fullStates = fullJurisdictions().filter(
      (name) => name !== 'District of Columbia',
    );
    expect(String(fullStates.length)).toBe(STAT_SOURCES.fullPracticeStates.value);
    expect(fullJurisdictions()).toContain('District of Columbia');
  });

  it('covers all 51 jurisdictions with no tier drift', () => {
    const entries = Object.values(STATE_PRACTICE_AUTHORITY);
    expect(entries.length).toBe(51);
    const count = (tier: string) =>
      entries.filter((info) => info.authority === tier).length;
    // 27 states + DC full / 12 reduced / 11 restricted — the AANP split the
    // file's own section headers describe. These only sum to 51 when New
    // York and Massachusetts are classified full.
    expect(count('full')).toBe(28);
    expect(count('reduced')).toBe(12);
    expect(count('restricted')).toBe(11);
  });

  it('does not assert a collaborative-agreement requirement in full-practice states', () => {
    for (const name of fullJurisdictions()) {
      const info = STATE_PRACTICE_AUTHORITY[name];
      // `details` is published verbatim as body prose and inside the
      // FAQPage JSON-LD on /jobs/state/<state>.
      expect(
        /requires? a (collaborative|supervisory|practice) agreement|must have a collaborativ|physician supervision/i.test(
          info.details,
        ),
        `${name} is classified full practice but its details string asserts an oversight requirement: "${info.details}"`,
      ).toBe(false);
      expect(
        buildPlainStateNarrative({ ...baseInput, stateName: name }),
      ).not.toContain('collaborative agreement with a physician');
    }
  });

  it('narrates New York and Massachusetts as full practice', () => {
    for (const stateName of ['New York', 'Massachusetts']) {
      expect(STATE_PRACTICE_AUTHORITY[stateName].authority).toBe('full');
      const narrative = buildPlainStateNarrative({ ...baseInput, stateName });
      expect(narrative).toContain('full practice authority');
      expect(narrative).not.toContain('reduced practice authority');
    }
  });
});
