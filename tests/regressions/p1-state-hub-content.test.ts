/**
 * P1 #11 + #16 (state side) regression pins for the plain /jobs/state/<state>
 * hubs, extended for the pSEO thin-content program (PLAN.md C.4 item 1:
 * HUB-S1 to HUB-S10, HUB-removals, HUB-meta).
 *
 * #11: buildPlainStateNarrative gives each of the 51 state hubs a
 * deterministic, per-state paragraph built ONLY from caller-supplied live
 * aggregates plus repo regulatory data (practice authority, NLC
 * membership): never invented figures.
 *
 * #16 (state side): the category pill list on the state hub derives from
 * STATE_ELIGIBLE_CATEGORY_SLUGS plus live inventory gating instead of the
 * old stale 11-slug hardcoded array.
 *
 * Thin content: every count and listing reads the canonical predicate
 * through getListingFacts; the sections are the shared builders and
 * components; pay is the gated median or the cited BLS figure; one FAQ
 * array feeds the accordion and the FAQPage node; robots read the same
 * gate the sitemap reads.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { brand } from '@/config/brand';
import { buildPlainStateNarrative } from '@/lib/pseo/state-narrative';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { STATE_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import { COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { DESCRIPTION_MAX } from '@/lib/pseo/category-metadata';
import { emptyListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts';
import {
  buildHubCategoriesSentence,
  buildHubCitiesSentences,
  buildHubDescription,
  buildHubEmployersSentence,
  buildHubFaqs,
  buildHubRecencySentence,
  buildHubSettingsSentence,
  buildHubTitle,
  buildHubWorkModeSentence,
} from '@/lib/pseo/listing-narrative';
import { getPracticeEnvironment } from '@/lib/pseo/practice-environment';
import { buildLicenseGuideSteps, getLicenseGuideState } from '@/lib/blog-license-guides';
import {
  MIN_DATA_SECTIONS_FOR_STATE_HUB_INDEX,
  MIN_JOBS_FOR_STATE_HUB_INDEX,
  shouldIndexStateHub,
} from '@/lib/pseo/render-gate';
import { postedPaySentence } from '@/components/seo/pseo';

const ROOT = process.cwd();
const PAGE = 'app/jobs/state/[state]/page.tsx';
const pageSrc = () => fs.readFileSync(path.join(ROOT, PAGE), 'utf8');

/** En dash and em dash, built from code points so this file carries neither byte. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const DOLLARS = /\$[\d,]+(?:\.\d+)?K?/g;

const baseInput = {
  stateName: 'Texas',
  stateCode: 'TX',
  totalJobs: 42,
  medianSalaryK: 128,
  uniqueEmployerCount: 17,
  topCategoryLabels: ['Remote', 'Family Practice', 'Telehealth'],
  topCityNames: ['Houston', 'Dallas', 'Austin'],
} as const;

/* Fixture facts, the shape getListingFacts returns for a state bucket. */

const NOW = new Date('2026-09-20T00:00:00Z');

/** A well stocked hub: every live data section renders. */
const FULL: ListingFacts = {
  total: 12,
  distinctEmployers: 3,
  topEmployers: [
    { name: 'Lakeside Health', count: 6, companyPath: '/companies/lakeside-health' },
    { name: 'Northwind Clinics', count: 4, companyPath: null },
    { name: 'Harbor Medical Group', count: 2, companyPath: null },
  ],
  cities: [
    { name: 'Austin', stateCode: 'TX', count: 5 },
    { name: 'Dallas', stateCode: 'TX', count: 4 },
    { name: 'Waco', stateCode: 'TX', count: 2 },
    { name: 'Tyler', stateCode: 'TX', count: 1 },
  ],
  states: [{ name: 'Texas', count: 12 }],
  workMode: { total: 12, remote: 4, hybrid: 0, onsite: 8 },
  jobTypes: { total: 12, labeledTotal: 10, top: [{ label: 'Full-Time', count: 7 }, { label: 'Part-Time', count: 3 }] },
  settings: { total: 12, labeledTotal: 9, top: [{ label: 'Outpatient', count: 6 }, { label: 'Inpatient', count: 3 }] },
  categoryTop: [{ label: 'Family Practice', count: 5 }, { label: 'Remote', count: 4 }],
  recency: { total: 12, datedCount: 12, last7: 2, last30: 7, newestPostedAt: new Date('2026-09-15T00:00:00Z') },
  newGradFriendly: 2,
  salaryDisclosedCount: 7,
  benchmark: { scope: 'Texas', median: 128_000, p25: 115_000, p75: 142_000, postings: 7, employers: 3 },
  computedAt: NOW,
  sampled: false,
};

/** The Delaware shape from the crawl: one posting, one employer, one city. */
const ONE_JOB: ListingFacts = {
  ...emptyListingFacts(NOW),
  total: 1,
  distinctEmployers: 1,
  topEmployers: [{ name: 'Bayhealth', count: 1, companyPath: null }],
  cities: [{ name: 'Dover', stateCode: 'DE', count: 1 }],
  states: [{ name: 'Delaware', count: 1 }],
  workMode: { total: 1, remote: 0, hybrid: 0, onsite: 1 },
  recency: { total: 1, datedCount: 1, last7: 0, last30: 1, newestPostedAt: new Date('2026-09-10T00:00:00Z') },
  salaryDisclosedCount: 1,
};

const CATEGORY_ROWS = [
  { label: 'Remote', count: 4 },
  { label: 'Family Practice', count: 5 },
  { label: 'Telehealth', count: 1 },
];

/**
 * The page's live-section recipe (HUB-S1 to S7), duplicated here on purpose:
 * the page and app/sitemap.ts each carry the same seven-line list, and the
 * source pin below proves the two lists name the same builders in the same
 * order. S7 counts only when the state publishes a gated median.
 */
function countLiveSections(stateName: string, facts: ListingFacts, publishesMedian: boolean): number {
  return [
    buildHubEmployersSentence({ stateName, facts }) !== null,
    buildHubCitiesSentences(facts.cities) !== null,
    buildHubCategoriesSentence(facts.categoryTop) !== null,
    buildHubWorkModeSentence(facts.workMode) !== null,
    buildHubSettingsSentence(facts.settings) !== null,
    buildHubRecencySentence(facts.recency) !== null,
    publishesMedian,
  ].filter(Boolean).length;
}

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

  it('uses the gated median and never invents a figure', () => {
    expect(buildPlainStateNarrative({ ...baseInput })).toContain('$128K');
    const withoutSalary = buildPlainStateNarrative({ ...baseInput, medianSalaryK: 0 });
    // No published median means no dollar figure of any kind.
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
  it('renders the plain-state narrative from the gated median, never a mean', () => {
    const src = pageSrc();
    expect(src).toContain('buildPlainStateNarrative');
    expect(src).toContain('{stateNarrative}');
    expect(src).toContain('medianSalaryK: facts.benchmark ? Math.round(facts.benchmark.median / 1000) : 0');
    expect(src).not.toContain('avgSalaryK');
  });

  it('derives category pills from the registry instead of a hardcoded slug list', () => {
    const src = pageSrc();
    expect(src).toContain('STATE_ELIGIBLE_CATEGORY_SLUGS');
    // The stale 11-slug hardcode is gone.
    expect(src).not.toContain("{ slug: 'remote', label: 'Remote' }");
    // Inventory gating still applies before a pill renders.
    expect(src).toMatch(/validSettingSlugs\.has\(slug\)/);
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

  it('reads only fresh setting-state rows and links a category only at the link-list floor (HUB-S3)', () => {
    const src = pageSrc();
    const query = src.slice(src.indexOf("type: 'setting-state'"), src.indexOf('orderBy: { totalJobs'));
    expect(query).toContain('updatedAt: { gte: pseoStatsFreshnessThreshold() }');
    expect(src).toContain('linkable: count >= MIN_JOBS_FOR_LINK_LIST_ROW');
    // The floor is the shared constant, never a re-typed number.
    const pills = src.slice(src.indexOf('const categoryPills'), src.indexOf('const categoryStateHref'));
    expect(pills).toBeTruthy();
    expect(pills).not.toMatch(/>=\s*\d/);
    expect(src).not.toMatch(/totalJobs\s*>=\s*\d/);
    // Plain text below the floor: the pill keeps its label and count, unlinked.
    expect(src).toMatch(/categoryPills\.map\(\(setting\) => setting\.linkable \? \(/);
    expect(src).toContain('CATEGORY_OVERLAP_NOTE');
  });

  it('filters unlabeled rows before slicing the narrative category list', () => {
    // Slice-before-filter would silently shorten the list whenever a stale
    // pseoStats row for a retired slug outranks a live one.
    const src = pageSrc();
    const block = src.slice(src.indexOf('const categoryRows = validSettingRows'), src.indexOf('return {', src.indexOf('const categoryRows')));
    expect(block).toContain('.filter((row): row is CategoryRow');
    expect(src).toContain('const topCategoryLabels = categoryRows.slice(0, 3)');
  });
});

describe('HUB thin content: every figure comes from the canonical facts loader', () => {
  it('counts, listings and sections read getListingFacts on the canonical bucket', () => {
    const src = pageSrc();
    expect(src).toContain("import { getListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts'");
    expect(src).toContain('getListingFacts(`state:${stateSlug}`, stateBucketWhere(stateName, stateCode))');
    expect(src).toContain('where: canonicalBucketWhere(stateBucketWhere(stateName, stateCode))');
    // The retired per-page aggregates: the posting mean, the employer
    // groupBy, the city groupBy and the six sequential neighbor counts.
    expect(src).not.toContain('_avg');
    expect(src).not.toContain('prisma.job.aggregate');
    expect(src).not.toMatch(/by:\s*\['employer'\]/);
    expect(src).not.toMatch(/by:\s*\['city'\]/);
    expect(src).not.toMatch(/isPublished/);
    // Nearby counts: one groupBy over the shared adjacency table.
    expect(src).toContain("import { getNeighboringStates } from '@/lib/pseo/neighboring-states'");
    expect(src).not.toContain('const NEIGHBORING_STATES');
    expect(src).toMatch(/by: \['state'\],\s*where: canonicalBucketWhere\(\{ state: \{ in: \[\.\.\.neighbors\] \} \}\)/);
  });

  it('renders HUB-S1, S2, S7 and S9 through the shared clay sections with their hub variants', () => {
    const src = pageSrc();
    expect(src).toMatch(/import \{[\s\S]*?EmployerRoster,[\s\S]*?LocationSpread,[\s\S]*?NearbyStatesTable,[\s\S]*?PostedPay,[\s\S]*?\} from '@\/components\/seo\/pseo'/);
    expect(src).toContain("variant={{ kind: 'hub', stateName }}");
    expect(src).toContain("variant={{ kind: 'hub', minLinkJobs: MIN_CITY_JOBS_FOR_LINK }}");
    expect(src).toContain("{ kind: 'location', scopeName: stateName, scopeNoun: 'state' } as const");
    expect(src).toContain('<NearbyStatesTable rows={nearbyRows} variant="hub"');
    // Nothing from the sticker kit on a clay page.
    expect(src).not.toContain('@/components/sticker');
    expect(src).not.toMatch(/\bstk-/);
  });

  it('renders HUB-S3 to S6 and S8 from the narrative builders, each behind its own null check', () => {
    const src = pageSrc();
    for (const call of [
      'buildHubCategoriesSentence(categoryRows)',
      'buildHubWorkModeSentence(facts.workMode)',
      'buildHubScheduleSentence(facts.jobTypes)',
      'buildHubSettingsSentence(facts.settings)',
      'buildHubRecencySentence(facts.recency)',
      'buildNewGradSentence(facts.newGradFriendly)',
      'buildLicenseGuideSteps(licenseState)',
      'buildBoardChecklistSentence(licenseState.boardName)',
    ]) {
      expect(src, call).toContain(call);
    }
    for (const guard of [
      '{categoriesSentence && (',
      '{workModeSentence && (',
      '{settingsSentence && (',
      '{recencySentence && (',
      '{paySentence && (',
      '{licenseState && (',
    ]) {
      expect(src, guard).toContain(guard);
    }
    expect(src).toContain('HUB_REMOTE_LICENSURE_NOTE');
    expect(src).toContain('HUB_REFRESH_NOTE');
    // The hub never carries the HowTo node; the license guide owns it.
    expect(src).not.toContain('HowTo');
    // Step text prints only while the guide is not published; names always.
    expect(src).toContain('{!licenseGuideLive && <span');
  });

  it('removed the boilerplate the plan names (HUB-removals) and keeps one alert CTA', () => {
    const src = pageSrc();
    for (const gone of [
      'Growth & Outlook',
      'continues to grow',
      'Salary Insights',
      'Top Employers',
      'Key information for',
      "title: 'Telehealth'",
      'Remote telehealth, outpatient clinics',
      'added daily',
      'updated daily',
      'avg salary',
      'Average',
      'average',
      'StateFAQ',
      'TrendingUp',
    ]) {
      expect(src, gone).not.toContain(gone);
    }
    // The sidebar card is the one alert CTA; the bento copy is gone.
    expect(src.match(/Create Alert/g)).toHaveLength(1);
    expect(src.match(/\/job-alerts\?location=/g)).toHaveLength(1);
  });

  it('HUB-meta: title and description come from the builders, robots from the sitemap gate', () => {
    const src = pageSrc();
    const meta = src.slice(src.indexOf('export async function generateMetadata'), src.indexOf('/** Decorative icon chip'));
    expect(meta).toContain('buildHubTitle({');
    expect(meta).toContain('buildHubDescription({');
    expect(meta).not.toContain('keywords');
    expect(meta).toContain('shouldIndexStateHub({ activeJobs: facts.total, liveDataSections, page })');
    expect(meta).toMatch(/\.\.\.\(!indexable && \{\s*robots: \{\s*index: false,\s*follow: true,/);
    expect(meta).toContain('canonical: `${brand.baseUrl}/jobs/state/${stateSlug}`');
    // The hero deck is the same live summary, not the generic sentence.
    expect(src).toContain('description={heroDescription}');
  });

  it('counts the live data sections with the same seven-line recipe as app/sitemap.ts', () => {
    const recipe = (source: string): string[] => {
      const start = source.indexOf('buildHubEmployersSentence({ stateName, facts');
      const end = source.indexOf('// S7', start);
      expect(start, 'S1 line missing').toBeGreaterThan(-1);
      expect(end, 'S7 line missing').toBeGreaterThan(start);
      return [...source.slice(start, end).matchAll(/build(Hub\w+)\(/g)].map((m) => m[1]);
    };
    const page = recipe(pageSrc());
    const sitemap = recipe(fs.readFileSync(path.join(ROOT, 'app/sitemap.ts'), 'utf8'));
    expect(page).toEqual(['HubEmployersSentence', 'HubCitiesSentences', 'HubCategoriesSentence', 'HubWorkModeSentence', 'HubSettingsSentence', 'HubRecencySentence']);
    expect(sitemap).toEqual(page);
    expect(pageSrc()).toContain('publishable.has(stateName)');
  });

  it('HUB-S10: one array from buildHubFaqs feeds the accordion and a gated FAQPage node', () => {
    const src = pageSrc();
    expect(src.match(/const stateFaqs = \[/g)).toHaveLength(1);
    expect(src).toContain('...buildHubFaqs({');
    expect(src).toMatch(/\{stateFaqs\.map\(\(faq/);
    expect(src).toContain('<p className="faq-answer"');
    expect(src).toContain('{stateFaqs.length >= FAQ_SCHEMA_MIN_ENTRIES && (');
    expect(src).toMatch(/mainEntity: stateFaqs\.map/);
    expect(src).toContain(".replace(/</g, '\\\\u003c')");
  });

  it('house style: no en or em dash anywhere in the file', () => {
    expect(pageSrc()).not.toMatch(DASHES);
  });
});

describe('P1 #11: state hubs never fabricate a salary band', () => {
  it('has no unsourced $130K literals left anywhere on the page', () => {
    const src = pageSrc();
    expect(src).not.toMatch(/\$130K/i);
    expect(src).not.toMatch(/\$200K\+/i);
  });

  it('prints pay only through the gated location variant, which cites BLS below the gate', () => {
    const variant = { kind: 'location', scopeName: 'Delaware', scopeNoun: 'state' } as const;
    const belowGate = postedPaySentence(variant, { ...ONE_JOB, benchmark: null, salaryDisclosedCount: 1 });
    expect(belowGate).toBeTruthy();
    expect(belowGate).toContain(STAT_SOURCES.averageSalary.formatted);
    expect(belowGate).toContain(STAT_SOURCES.averageSalary.source);
    // The only dollar figure below the gate is the cited BLS median.
    expect(belowGate!.match(DOLLARS)).toEqual([STAT_SOURCES.averageSalary.formatted]);
    expect(belowGate).toContain('median');
    expect(belowGate).not.toMatch(/average/i);
    // No disclosed pay at all: the section is omitted, never padded.
    expect(postedPaySentence(variant, { ...ONE_JOB, benchmark: null, salaryDisclosedCount: 0 })).toBeNull();
    // Above the gate: the median and the middle half, in "to" form.
    const gated = postedPaySentence({ ...variant, scopeName: 'Texas' }, FULL);
    expect(gated).toContain('$128K');
    expect(gated).toContain('$115K to $142K');
    expect(gated).toContain('7 postings from 3 employers');
    expect(gated).not.toMatch(DASHES);
  });

  it('never derives a salary figure by arithmetic on the median', () => {
    const src = pageSrc();
    // Unit conversion to $K is fine; a factor or an offset invents a number.
    const derived = src.match(/benchmark\.median\s*[*+-]\s*[\d.(]|[\d.)]\s*[*/]\s*benchmark\.median/g);
    expect(derived, `computed salary figure(s) with no source: ${JSON.stringify(derived)}`).toBeNull();
  });

  it('emits no AggregateOffer price bounds in structured data', () => {
    const src = pageSrc();
    expect(src).not.toMatch(/'@type':\s*'AggregateOffer'/);
    expect(src).not.toMatch(/\b(lowPrice|highPrice)\s*:/);
  });

  it('keeps every dollar figure traceable to the facts loader or a cited source', () => {
    const src = pageSrc();
    // No hardcoded thousands-scale money literals anywhere in the file:
    // any salary number must come from facts.benchmark or the builders.
    const moneyLiterals = src.match(/\$\s?\d{2,3}(,\d{3}|[Kk]\b|000\b)/g);
    expect(moneyLiterals, `hardcoded salary literal(s): ${JSON.stringify(moneyLiterals)}`).toBeNull();
    expect(src).not.toContain('STAT_SOURCES');
  });
});

describe('HUB-meta and HUB-S10 builders over the hub fixtures', () => {
  const texas = getPracticeEnvironment('Texas');
  const delaware = getPracticeEnvironment('Delaware');
  const stepNames = (slug: string): string[] => {
    const state = getLicenseGuideState(slug);
    return state ? buildLicenseGuideSteps(state).map((s) => s.name) : [];
  };

  it('title prints the count only at the display floor and never the brand name', () => {
    const full = buildHubTitle({ stateName: 'Texas', stateCode: 'TX', total: FULL.total, distinctEmployers: FULL.distinctEmployers, benchmark: FULL.benchmark });
    expect(FULL.total).toBeGreaterThanOrEqual(COUNT_DISPLAY_FLOOR);
    expect(full).toBe('12 NP Jobs in Texas (TX): $128K Median Pay');
    const thin = buildHubTitle({ stateName: 'Delaware', stateCode: 'DE', total: ONE_JOB.total, distinctEmployers: ONE_JOB.distinctEmployers, benchmark: null });
    expect(thin).toBe('NP Jobs in Delaware (DE): 1 Employer Hiring');
    for (const title of [full, thin]) {
      expect(title).not.toContain(brand.name);
      expect(title).not.toMatch(DASHES);
    }
  });

  it('description stays inside the budget and never ends mid-word', () => {
    for (const [stateName, facts, env] of [['Texas', FULL, texas], ['Delaware', ONE_JOB, delaware]] as const) {
      const description = buildHubDescription({
        stateName,
        facts,
        authorityDescription: env?.authorityDescription ?? null,
        topCategories: CATEGORY_ROWS.map((r) => r.label),
      });
      expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(description).toMatch(/\.$/);
      expect(description).not.toMatch(DASHES);
      expect(description).not.toMatch(/average/i);
    }
    expect(buildHubDescription({ stateName: 'Texas', facts: FULL, authorityDescription: texas!.authorityDescription, topCategories: [] }))
      .toContain('Median posted pay $128K');
  });

  it('FAQ: seven conditional questions on a full hub, fewer on a thin one, no freshness claim', () => {
    const full = buildHubFaqs({ stateName: 'Texas', facts: FULL, env: texas, categoryRows: CATEGORY_ROWS, stepNames: stepNames('texas') });
    expect(full).toHaveLength(7);
    expect(full.map((f) => f.question)).toEqual([
      'How many NP jobs are in Texas?',
      'What is the practice authority in Texas?',
      'What is the median NP salary in Texas?',
      'Which cities in Texas have the most NP jobs?',
      'Which employers are hiring NPs in Texas?',
      'Are remote NP roles available in Texas?',
      'How do I get licensed as an NP in Texas?',
    ]);
    const joined = full.map((f) => `${f.question} ${f.answer}`).join(' ');
    expect(joined).not.toMatch(/added daily|updated daily|average/i);
    expect(joined).not.toMatch(DASHES);
    expect(joined).toContain('Counts refresh hourly.');

    const thin = buildHubFaqs({ stateName: 'Delaware', facts: ONE_JOB, env: delaware, categoryRows: [], stepNames: stepNames('delaware') });
    // Employers (1 employer), remote (0 remote) drop out with their answers.
    expect(thin.map((f) => f.question)).not.toContain('Which employers are hiring NPs in Delaware?');
    expect(thin.map((f) => f.question)).not.toContain('Are remote NP roles available in Delaware?');
    // Below the gate the only dollar figure anywhere is the cited BLS median.
    const dollars = thin.map((f) => f.answer).join(' ').match(DOLLARS) ?? [];
    expect(new Set(dollars)).toEqual(new Set([STAT_SOURCES.averageSalary.formatted]));
  });

  it('index gate: a full hub indexes, the Delaware shape renders noindex', () => {
    const fullSections = countLiveSections('Texas', FULL, true);
    expect(fullSections).toBe(7);
    expect(shouldIndexStateHub({ activeJobs: FULL.total, liveDataSections: fullSections })).toBe(true);
    const thinSections = countLiveSections('Delaware', ONE_JOB, false);
    expect(thinSections).toBeLessThan(MIN_DATA_SECTIONS_FOR_STATE_HUB_INDEX);
    expect(ONE_JOB.total).toBeLessThan(MIN_JOBS_FOR_STATE_HUB_INDEX);
    expect(shouldIndexStateHub({ activeJobs: ONE_JOB.total, liveDataSections: thinSections })).toBe(false);
    // Page 2 of a full hub never indexes.
    expect(shouldIndexStateHub({ activeJobs: FULL.total, liveDataSections: fullSections, page: 2 })).toBe(false);
  });
});

// The plain-state narrative turned lib/state-practice-authority.ts from a
// bento tint into a flat regulatory assertion in body prose AND, through
// env.details inside buildHubFaqs, inside the FAQPage JSON-LD. That raises
// the bar on the dataset: a stale tier is now a published false claim on a
// YMYL surface, so pin it against the site's own cited figure.
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
    // 27 states + DC full / 12 reduced / 11 restricted, the AANP split the
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
