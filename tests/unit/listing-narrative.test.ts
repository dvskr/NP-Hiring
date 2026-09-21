/**
 * lib/pseo/listing-narrative.ts (PLAN C.4): every sentence builder is pure,
 * so this file pins the copy templates at their floors. The rules under
 * test: null below each floor; zero clauses omitted, never printed as
 * "0 hybrid"; pluralization correct at exactly one; "median" never
 * "average"; the board median never called national and the BLS figure
 * cited inline; anesthesia and midwifery never receive the NP median; UTC
 * dates; one array feeds the FAQ accordion and its JSON-LD, so a missing
 * answer drops the whole entry; and no builder output contains an en dash,
 * an em dash, a spaced hyphen or a trend word.
 */
import { describe, it, expect } from 'vitest';
import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { BENCHMARK_MIN_EMPLOYERS, BENCHMARK_MIN_POSTINGS, type BenchmarkRow } from '@/components/tools/benchmark-model';
import {
  MIX_MIN_POSTINGS_HUB,
  MIX_MIN_POSTINGS_LISTING,
  emptyListingFacts,
  type EmployerFact,
  type FieldMix,
  type ListingFacts,
  type RecencyFacts,
  type WorkModeMix,
} from '@/lib/pseo/listing-facts';
import { getPracticeEnvironment, NLC_VERIFIED_LABEL } from '@/lib/pseo/practice-environment';
import { DESCRIPTION_MAX, TITLE_PAGE_PART_MAX } from '@/lib/pseo/category-metadata';
import {
  BOARD_MEDIAN_LABEL,
  CATEGORY_OVERLAP_NOTE,
  COMPANY_CLAIM_CTA,
  HUB_REFRESH_NOTE,
  HUB_REMOTE_LICENSURE_NOTE,
  NATIONAL_MEDIAN_SENTENCE,
  NATIONAL_REFERENCE_SENTENCE,
  NEARBY_STATES_NOTE,
  NP_MEDIAN_EXCLUDED_SLUGS,
  SALARY_NEARBY_NOT_PUBLISHED,
  buildBoardChecklistSentence,
  buildCategoryAcrossStateSentences,
  buildCategoryCityDescription,
  buildCategoryCityEmployersSentence,
  buildCategoryCityFaqs,
  buildCategoryCityPayParagraph,
  buildCategoryCityTitle,
  buildCityCardHiringLine,
  buildCityCardPayLine,
  buildCityCategoriesIntro,
  buildCityDescription,
  buildCityEmployersSentence,
  buildCityFaqs,
  buildCityPayParagraph,
  buildCityTitle,
  buildCompanyDescription,
  buildCompanyFaqs,
  buildCompanyFootprintSentence,
  buildCompanyPaySentence,
  buildCompanyStatePracticeLine,
  buildCompanyTitle,
  buildDirectoryDescription,
  buildDirectoryFaqs,
  buildDirectoryHowToUse,
  buildDirectoryTitle,
  buildFreshnessSentence,
  buildHiringForSentence,
  buildHubCategoriesSentence,
  buildHubCitiesSentences,
  buildHubDescription,
  buildHubEmployersSentence,
  buildHubFaqs,
  buildHubPayParagraph,
  buildHubRecencySentence,
  buildHubScheduleSentence,
  buildHubSettingsSentence,
  buildHubTitle,
  buildHubWorkModeSentence,
  buildLandingStatesSentence,
  buildLicensureSentences,
  buildListingJobTypesSentence,
  buildListingSettingsSentence,
  buildListingWorkModeSentence,
  buildListingsAuthoritySentence,
  buildLiveRolesBadge,
  buildLowInventoryIntro,
  buildMetroAreaSentence,
  buildMetroCategoriesSentence,
  buildMetroDescription,
  buildMetroEmployersFaq,
  buildMetroGuideLine,
  buildMetroHeadlineSub,
  buildMetroTitle,
  buildMetroZeroJobsSentence,
  buildNearbyDirectoriesSentence,
  buildNearbyStatesSentence,
  buildNewGradSentence,
  buildPostedPaySentence,
  buildPracticingAsRoleParagraph,
  buildPracticingInStateParagraph,
  buildRecencySentence,
  buildRelatedCategorySub,
  buildRoleSetup,
  buildSalaryNearbyCaption,
  buildSalaryPracticeEnvironmentParagraph,
  buildSalaryStateDescription,
  buildSalaryStateFaqAdditions,
  buildSalaryStateSummary,
  buildSalaryStateTitle,
  buildScopedCitiesSentence,
  buildScopedEmployersSentence,
  buildSettingStateDescription,
  buildSettingStateFaqs,
  buildSettingStateTitle,
  buildSpecialtyAuthoritySentence,
  buildSpecialtyCtaLine,
  buildSpecialtyDescription,
  buildSpecialtyFaqAdditions,
  buildStatewideEmployersSentence,
  buildTerseWorkModeLine,
  formatCountLabel,
  formatDollars,
  formatK,
  formatUtcDate,
  formatUtcDateShort,
  receivesNpMedian,
  type FaqEntry,
} from '@/lib/pseo/listing-narrative';

const NP = brand.niche.short;
const NP_PROSE = brand.niche.descriptor;
const BRAND = brand.name;
const BLS = STAT_SOURCES.averageSalary.formatted;
const BLS_SOURCE = STAT_SOURCES.averageSalary.source;
const NOW = new Date('2026-09-16T12:00:00Z');
const SEP_1 = new Date('2026-09-01T00:00:00Z');
const BENCH: BenchmarkRow = { scope: 'Texas', median: 132000, p25: 118000, p75: 150000, postings: 6, employers: 3 };
const TEXAS = getPracticeEnvironment('Texas')!;

function emp(list: Array<[string, number]>): EmployerFact[] {
  return list.map(([name, count]) => ({ name, count, companyPath: null }));
}
function named(list: Array<[string, number]>): Array<{ name: string; count: number }> {
  return list.map(([name, count]) => ({ name, count }));
}
function mode(total: number, remote: number, hybrid: number, onsite: number): WorkModeMix {
  return { total, remote, hybrid, onsite };
}
function mix(total: number, top: Array<[string, number]>): FieldMix {
  return { total, labeledTotal: top.reduce((sum, [, n]) => sum + n, 0), top: top.map(([label, count]) => ({ label, count })) };
}
function recency(over: Partial<RecencyFacts> = {}): RecencyFacts {
  return { total: 5, datedCount: 5, last7: 1, last30: 2, newestPostedAt: SEP_1, ...over };
}
function facts(over: Partial<ListingFacts> = {}): ListingFacts {
  return { ...emptyListingFacts(NOW), ...over };
}

/** Every string a builder returns during this file is collected for the copy lint at the end. */
const seen: string[] = [];
function keep<T extends string | null | undefined>(value: T): T {
  if (typeof value === 'string') seen.push(value);
  return value;
}
function keepFaqs(entries: FaqEntry[]): FaqEntry[] {
  for (const entry of entries) seen.push(entry.question, entry.answer);
  return entries;
}

describe('formatting helpers', () => {
  it('print absolute UTC dates and dollar figures', () => {
    expect(keep(formatUtcDate(SEP_1))).toBe('September 1, 2026');
    expect(keep(formatUtcDateShort(SEP_1))).toBe('Sep 1');
    expect(keep(formatUtcDate(new Date('2026-09-01T23:59:59Z')))).toBe('September 1, 2026');
    expect(keep(formatK(132000))).toBe('$132K');
    expect(keep(formatDollars(129210))).toBe('$129,210');
    expect(keep(formatCountLabel({ label: 'Texas', count: 4 }))).toBe('Texas (4)');
    expect(keep(formatCountLabel({ name: 'Austin', count: 1 }))).toBe('Austin (1)');
  });

  it('the board median is never called national and the BLS figure is cited inline', () => {
    expect(keep(BOARD_MEDIAN_LABEL)).toBe(`Median across all ${BRAND} postings`);
    expect(BOARD_MEDIAN_LABEL.toLowerCase()).not.toContain('national');
    expect(keep(NATIONAL_MEDIAN_SENTENCE)).toBe(`Nationally, ${NP_PROSE}s earn a median annual wage of ${BLS} (${BLS_SOURCE}).`);
    expect(keep(NATIONAL_REFERENCE_SENTENCE)).toBe(`For reference, the national median wage for ${NP_PROSE}s is ${BLS} (${BLS_SOURCE}).`);
  });

  it('anesthesia and midwifery are the categories that never receive the NP median', () => {
    expect([...NP_MEDIAN_EXCLUDED_SLUGS].sort()).toEqual(['anesthesia', 'midwifery']);
    expect(receivesNpMedian('anesthesia')).toBe(false);
    expect(receivesNpMedian('midwifery')).toBe(false);
    expect(receivesNpMedian('family-practice')).toBe(true);
    expect(receivesNpMedian(undefined)).toBe(true);
  });
});

describe('employers', () => {
  it('HUB-S1 needs two employers and names the remainder only when it exists', () => {
    expect(buildHubEmployersSentence({ stateName: 'Texas', facts: facts({ total: 3, distinctEmployers: 1, topEmployers: emp([['Alpha Health', 3]]) }) })).toBeNull();
    expect(keep(buildHubEmployersSentence({
      stateName: 'Texas',
      facts: facts({ total: 5, distinctEmployers: 3, topEmployers: emp([['Alpha Health', 3], ['Beta Clinic', 1], ['Gamma Care', 1]]) }),
    }))).toBe(`The employers with the most open ${NP} roles in Texas right now are Alpha Health (3 roles), Beta Clinic (1) and Gamma Care (1).`);
    expect(keep(buildHubEmployersSentence({
      stateName: 'Texas',
      facts: facts({ total: 9, distinctEmployers: 5, topEmployers: emp([['Alpha Health', 4], ['Beta Clinic', 2], ['Gamma Care', 1]]) }),
    }))).toContain('2 other employers account for the remaining 2 postings.');
    expect(keep(buildHubEmployersSentence({
      stateName: 'Texas',
      facts: facts({ total: 8, distinctEmployers: 4, topEmployers: emp([['Alpha Health', 4], ['Beta Clinic', 2], ['Gamma Care', 1]]) }),
    }))).toContain('1 other employer accounts for the remaining 1 posting.');
  });

  it('CITY-C1 needs two employers, handles the all-ones case and ties', () => {
    expect(buildCityEmployersSentence({ city: 'Austin', facts: facts({ distinctEmployers: 1, topEmployers: emp([['Alpha', 2]]) }) })).toBeNull();
    expect(keep(buildCityEmployersSentence({ city: 'Austin', facts: facts({ distinctEmployers: 2, topEmployers: emp([['Alpha', 1], ['Beta', 1]]) }) })))
      .toBe(`2 employers each have one active ${NP} listing in Austin.`);
    expect(keep(buildCityEmployersSentence({ city: 'Austin', facts: facts({ distinctEmployers: 3, topEmployers: emp([['Alpha', 3], ['Beta', 1], ['Gamma', 1]]) }) })))
      .toBe(`3 employers have active ${NP} listings in Austin right now. Alpha has the most, with 3 listings.`);
    expect(keep(buildCityEmployersSentence({ city: 'Austin', facts: facts({ distinctEmployers: 3, topEmployers: emp([['Alpha', 2], ['Beta', 2], ['Gamma', 1]]) }) })))
      .toBe(`3 employers have active ${NP} listings in Austin right now. Alpha and Beta have the most, with 2 each.`);
  });

  it('CS-S1 and LAND-L1 name a single employer outright and pluralize at one', () => {
    expect(buildScopedEmployersSentence({ label: 'Remote', scope: 'in Texas', facts: facts() })).toBeNull();
    expect(keep(buildScopedEmployersSentence({ label: 'Remote', scope: 'in Texas', facts: facts({ total: 1, distinctEmployers: 1, topEmployers: emp([['Alpha', 1]]) }) })))
      .toBe('The only current Remote listing in Texas is posted by Alpha.');
    expect(keep(buildScopedEmployersSentence({ label: 'Remote', scope: 'in Texas', facts: facts({ total: 4, distinctEmployers: 1, topEmployers: emp([['Alpha', 4]]) }) })))
      .toBe('All 4 current Remote listings in Texas are posted by Alpha.');
    expect(keep(buildScopedEmployersSentence({ label: 'Remote', scope: 'nationwide', facts: facts({ total: 5, distinctEmployers: 2, topEmployers: emp([['Alpha', 3], ['Beta', 2]]) }) })))
      .toBe('5 listings nationwide come from 2 employers. Alpha has the most, with 3.');
  });

  it('CC-K1, DIR-L2 and the statewide line', () => {
    expect(buildCategoryCityEmployersSentence({ labelSentence: 'remote', city: 'Austin', facts: facts({ distinctEmployers: 1, topEmployers: emp([['Alpha', 2]]) }) })).toBeNull();
    expect(keep(buildCategoryCityEmployersSentence({ labelSentence: 'remote', city: 'Austin', facts: facts({ distinctEmployers: 2, topEmployers: emp([['Alpha', 2], ['Beta', 1]]) }) })))
      .toBe('2 employers have active remote listings in Austin. Alpha leads with 2.');
    expect(buildCityCardHiringLine(named([['Alpha', 2]]))).toBeNull();
    expect(keep(buildCityCardHiringLine(named([['Alpha', 2], ['Beta', 1]])))).toBe('Hiring: Alpha (2) and Beta (1)');
    expect(buildStatewideEmployersSentence({ stateName: 'Texas', facts: facts({ distinctEmployers: 1, topEmployers: emp([['Alpha', 2]]) }) })).toBeNull();
    expect(keep(buildStatewideEmployersSentence({ stateName: 'Texas', facts: facts({ distinctEmployers: 3, topEmployers: emp([['Alpha', 3], ['Beta', 2], ['Gamma', 1]]) }) })))
      .toBe('Across Texas, the employers with the most open roles are Alpha, Beta and Gamma.');
  });
});

describe('locations', () => {
  it('HUB-S2 needs two cities, names sub-threshold cities without linking them', () => {
    expect(buildHubCitiesSentences(named([['Austin', 4]]))).toBeNull();
    const out = buildHubCitiesSentences(named([['Austin', 4], ['Dallas', 2], ['Houston', 1], ['Waco', 1]]))!;
    expect(keep(out.spread)).toBe('Open roles are spread across 4 cities. Austin leads with 4, followed by Dallas (2) and Houston (1).');
    expect(keep(out.subThreshold)).toBe('Cities with fewer than 3 open roles: Waco.');
    expect(buildHubCitiesSentences(named([['Austin', 4], ['Dallas', 3]]))!.subThreshold).toBeNull();
  });

  it('CS-S2 needs two cities on remote and telehealth, one elsewhere', () => {
    expect(buildScopedCitiesSentence({ slug: 'remote', cities: named([['Austin', 2]]) })).toBeNull();
    expect(buildScopedCitiesSentence({ slug: 'telehealth', cities: named([['Austin', 2]]) })).toBeNull();
    expect(keep(buildScopedCitiesSentence({ slug: 'outpatient', cities: named([['Austin', 2]]) }))).toBe('Every listing with a stated location is in Austin.');
    expect(keep(buildScopedCitiesSentence({ slug: 'remote', cities: named([['Austin', 4], ['Dallas', 2], ['Houston', 1]]) })))
      .toBe('Listings with a stated location are spread across 3 cities, led by Austin (4), Dallas (2) and Houston (1).');
  });

  it('LAND-L2, CC-K4, DIR-L1, DIR-L6, DIR-L7', () => {
    expect(buildLandingStatesSentence([])).toBeNull();
    expect(keep(buildLandingStatesSentence(named([['Texas', 4]])))).toBe('Every current listing with a state is in Texas.');
    expect(keep(buildLandingStatesSentence(named([['Texas', 4], ['Ohio', 1]])))).toBe('Current listings span 2 states, led by Texas (4) and Ohio (1).');

    const across = buildCategoryAcrossStateSentences({ city: 'Austin', stateName: 'Texas', labelSentence: 'remote', cityCount: 4, stateCount: 10, otherCities: named([['Dallas', 2]]) });
    expect(keep(across.share)).toBe('Austin accounts for 4 of the 10 active remote listings in Texas.');
    expect(keep(across.others)).toBe('Other Texas cities with remote listings: Dallas (2).');
    const none = buildCategoryAcrossStateSentences({ city: 'Austin', stateName: 'Texas', labelSentence: 'remote', cityCount: 4, stateCount: null, otherCities: [] });
    expect(none).toEqual({ share: null, others: null });

    expect(buildMetroAreaSentence({ metroArea: 'Greater Boston', cities: named([['Boston', 3]]) })).toBeNull();
    expect(keep(buildMetroAreaSentence({ metroArea: 'Greater Boston', cities: named([['Boston', 3], ['Cambridge', 2]]) })))
      .toBe('In the Greater Boston metro area, open roles are split across Boston (3) and Cambridge (2).');
    expect(buildNearbyDirectoriesSentence([])).toBeNull();
    expect(keep(buildNearbyDirectoriesSentence([{ name: 'Ohio', cities: 1 }, { name: 'Indiana', cities: 3 }]))).toBe('Nearby directories: Ohio (1 city hiring), Indiana (3).');
    expect(keep(buildMetroGuideLine({ city: 'Austin', count: 1 }))).toBe('Austin metro guide (1 open role across the metro)');
  });

  it('HUB-S9 says nearby, never borders, and needs one nearby state with jobs', () => {
    expect(buildNearbyStatesSentence([{ name: 'Oklahoma', count: 0, authorityDescription: 'Restricted Practice' }])).toBeNull();
    const out = keep(buildNearbyStatesSentence([
      { name: 'Oklahoma', count: 3, authorityDescription: 'Restricted Practice' },
      { name: 'Louisiana', count: 1, authorityDescription: 'Reduced Practice' },
      { name: 'Arkansas', count: 0, authorityDescription: 'Reduced Practice' },
    ]));
    expect(out).toBe(`Nearby states with open ${NP} roles on this site: Oklahoma (3 roles, Restricted Practice) and Louisiana (1 role, Reduced Practice).`);
    expect(keep(NEARBY_STATES_NOTE)).not.toMatch(/border/i);
  });
});

describe('mixes omit zero clauses and respect their floors', () => {
  it('HUB-S4 work mode', () => {
    expect(buildHubWorkModeSentence(mode(MIX_MIN_POSTINGS_HUB - 1, 2, 0, 2))).toBeNull();
    expect(keep(buildHubWorkModeSentence(mode(5, 2, 0, 3)))).toBe('2 of 5 open roles are remote and 3 are on site.');
    expect(keep(buildHubWorkModeSentence(mode(5, 5, 0, 0)))).toBe('All 5 open roles are remote.');
    expect(keep(buildHubWorkModeSentence(mode(6, 1, 2, 3)))).toBe('1 of 6 open roles is remote, 2 are hybrid and 3 are on site.');
    expect(keep(HUB_REMOTE_LICENSURE_NOTE)).toContain('licensure');
  });

  it('HUB-S4 schedule and HUB-S5 settings', () => {
    expect(buildHubScheduleSentence(mix(10, [['Full-Time', 3], ['Part-Time', 1]]))).toBeNull();
    expect(buildHubScheduleSentence(mix(20, [['Full-Time', 4], ['Part-Time', 2]]))).toBeNull();
    expect(keep(buildHubScheduleSentence(mix(10, [['Full-Time', 4], ['Part-Time', 2]])))).toBe('Where employers list a schedule, Full-Time leads with 4, then Part-Time (2).');
    expect(keep(buildHubSettingsSentence(mix(5, [['Outpatient', 5]])))).toBe('All 5 postings that name a clinical setting name Outpatient.');
    expect(keep(buildHubSettingsSentence(mix(8, [['Outpatient', 4], ['Inpatient', 2]])))).toBe('Among the 6 postings that name a clinical setting, Outpatient appears most often (4), followed by Inpatient (2).');
  });

  it('CITY-C3 sentences', () => {
    expect(buildListingWorkModeSentence({ mix: mode(2, 0, 0, 2), subject: `active ${NP} listings in Austin` })).toBeNull();
    expect(keep(buildListingWorkModeSentence({ mix: mode(3, 0, 0, 3), subject: `active ${NP} listings in Austin` }))).toBe(`All 3 active ${NP} listings in Austin are in person.`);
    expect(keep(buildListingWorkModeSentence({ mix: mode(5, 2, 1, 2), subject: `active ${NP} listings in Austin` }))).toBe(`Of the 5 active ${NP} listings in Austin, 2 are in person, 1 is hybrid and 2 are remote.`);
    expect(buildListingSettingsSentence(mix(5, [['Outpatient', 3]]))).toBeNull();
    expect(keep(buildListingSettingsSentence(mix(5, [['Outpatient', 2], ['Inpatient', 1]])))).toBe('Clinical settings named in these listings include Outpatient (2) and Inpatient (1).');
    expect(keep(buildListingJobTypesSentence(mix(5, [['Full-Time', 2], ['Part-Time', 1]])))).toBe('By job type, 2 are Full-Time and 1 is Part-Time.');
  });

  it('CS-S3 role setup skips the page axis and prints counts, never percentages', () => {
    const source = facts({
      workMode: mode(5, 2, 1, 2),
      jobTypes: mix(5, [['Full-Time', 3], ['Per Diem', 1]]),
      settings: mix(5, [['Outpatient', 3], ['Inpatient', 1]]),
    });
    const all = buildRoleSetup({ slug: 'family-practice', facts: source });
    expect(keep(all.workMode)).toBe('2 of 5 are remote, 1 hybrid and 2 on site.');
    expect(keep(all.jobType)).toBe('Full-Time is the most common arrangement (3), followed by Per Diem (1).');
    expect(keep(all.setting)).toBe('The most common setting is Outpatient (3), followed by Inpatient (1).');
    expect(all.rendered).toBe(true);
    expect(`${all.workMode}${all.jobType}${all.setting}`).not.toContain('%');

    expect(buildRoleSetup({ slug: 'remote', facts: source }).workMode).toBeNull();
    expect(buildRoleSetup({ slug: 'telehealth', facts: source }).workMode).toBeNull();
    expect(buildRoleSetup({ slug: 'full-time', facts: source }).jobType).toBeNull();
    expect(buildRoleSetup({ slug: 'travel', facts: source }).jobType).toBeNull();
    expect(buildRoleSetup({ slug: 'inpatient', facts: source }).setting).toBeNull();
    expect(buildRoleSetup({ slug: 'hospital', facts: source }).setting).toBeNull();
    expect(buildRoleSetup({ slug: 'remote', facts: source }).rendered).toBe(true);

    const thin = buildRoleSetup({ slug: 'family-practice', facts: facts({ workMode: mode(2, 1, 0, 1), jobTypes: mix(2, [['Full-Time', 2]]), settings: mix(2, [['Outpatient', 2]]) }) });
    expect(thin).toEqual({ workMode: null, jobType: null, setting: null, rendered: false });
  });

  it('DIR-L4 and METRO-M5 lines', () => {
    expect(buildTerseWorkModeLine(mode(3, 0, 0, 3))).toBeNull();
    expect(buildTerseWorkModeLine(mode(2, 1, 0, 1))).toBeNull();
    expect(keep(buildTerseWorkModeLine(mode(4, 2, 0, 2)))).toBe('2 on site, 2 remote');
    expect(buildMetroCategoriesSentence([])).toBeNull();
    expect(keep(buildMetroCategoriesSentence([{ label: 'Remote', count: 3 }]))).toBe('Most common category here: Remote (3). A posting can count in more than one.');
    expect(keep(buildMetroCategoriesSentence([{ label: 'Remote', count: 3 }, { label: 'Full-Time', count: 2 }]))).toMatch(/^Most common categories here: Remote \(3\) and Full-Time \(2\)\./);
  });

  it('HUB-S3 and CITY-C2', () => {
    expect(buildHubCategoriesSentence([{ label: 'Remote', count: 4 }])).toBeNull();
    expect(buildHubCategoriesSentence([{ label: 'Remote', count: 4 }, { label: 'Full-Time', count: 0 }])).toBeNull();
    expect(keep(buildHubCategoriesSentence([{ label: 'Remote', count: 4 }, { label: 'Full-Time', count: 2 }, { label: 'Travel', count: 0 }])))
      .toBe('By category, Remote has 4 open roles and Full-Time has 2.');
    expect(keep(CATEGORY_OVERLAP_NOTE)).toContain('more than one category');
    expect(keep(buildCityCategoriesIntro('Austin'))).toContain('the counts overlap');
  });
});

describe('recency', () => {
  it('HUB-S6 needs three postings and a newest date, and uses the past tense', () => {
    expect(buildHubRecencySentence(recency({ total: 2 }))).toBeNull();
    expect(buildHubRecencySentence(recency({ newestPostedAt: null }))).toBeNull();
    expect(keep(buildHubRecencySentence(recency({ last7: 0, last30: 0 })))).toBe('None of 5 open roles were posted in the last 30 days. The newest was posted on September 1, 2026.');
    expect(keep(buildHubRecencySentence(recency({ last7: 0, last30: 1 })))).toBe('1 of 5 open roles was posted in the last 30 days. The newest was posted on September 1, 2026.');
    expect(keep(buildHubRecencySentence(recency({ last7: 1, last30: 2 })))).toBe('1 of 5 open roles was posted in the last 7 days and 2 in the last 30 days. The newest was posted on September 1, 2026.');
    expect(keep(HUB_REFRESH_NOTE)).toBe('Counts on this page refresh hourly from active postings.');
  });

  it('new-grad clause is omitted at zero and pluralized at one', () => {
    expect(buildNewGradSentence(0)).toBeNull();
    expect(keep(buildNewGradSentence(1))).toBe('1 posting says the employer is open to new graduates.');
    expect(keep(buildNewGradSentence(2))).toBe('2 postings say the employer is open to new graduates.');
  });

  it('CITY-C4 freshness needs a dated row; CS-S5 needs a newest date', () => {
    expect(buildFreshnessSentence(recency({ datedCount: 0 }))).toBeNull();
    expect(keep(buildFreshnessSentence(recency({ last30: 0 })))).toBe('None of the 5 listings were first posted in the last 30 days; the most recent was first posted on September 1, 2026.');
    expect(keep(buildFreshnessSentence(recency({ last30: 1 })))).toBe('1 of the 5 listings was first posted in the last 30 days. The most recent was first posted on September 1, 2026.');
    expect(keep(buildFreshnessSentence(recency({ last30: 2 })))).toBe('2 of the 5 listings were first posted in the last 30 days. The most recent was first posted on September 1, 2026.');
    expect(buildRecencySentence(recency({ newestPostedAt: null }))).toBeNull();
    expect(keep(buildRecencySentence(recency({ last30: 0 })))).toBe('The newest listing was posted on September 1, 2026.');
    expect(keep(buildRecencySentence(recency({ last30: 3 })))).toBe('3 of these 5 listings were posted in the last 30 days, and the newest was posted on September 1, 2026.');
  });
});

describe('pay: gated median or a cited BLS sentence, never a mean', () => {
  it('HUB-S7 and METRO-M2 paragraph, both branches', () => {
    expect(keep(buildHubPayParagraph({ scopeName: 'Texas', scopeNoun: 'state', facts: facts({ benchmark: BENCH }) })))
      .toBe(`The median posted salary for ${NP} roles in Texas is $132K, and the middle half of postings runs $118K to $150K. It is based on 6 postings from 3 employers that list annual pay. Hourly, estimated and non-${NP} postings are excluded.`);
    expect(keep(buildHubPayParagraph({ scopeName: 'Texas', scopeNoun: 'state', facts: facts({ salaryDisclosedCount: 0 }) })))
      .toBe(`No current posting in Texas states a salary, so this site publishes no state figure. The national median for ${NP_PROSE}s is ${BLS} (${BLS_SOURCE}).`);
    expect(keep(buildHubPayParagraph({ scopeName: 'Austin', scopeNoun: 'metro', facts: facts({ salaryDisclosedCount: 1 }) })))
      .toBe(`1 posting in Austin states a salary, which is below the minimum of ${BENCHMARK_MIN_POSTINGS} postings from ${BENCHMARK_MIN_EMPLOYERS} employers this site requires before publishing a metro figure. The national median for ${NP_PROSE}s is ${BLS} (${BLS_SOURCE}).`);
    expect(keep(buildHubPayParagraph({ scopeName: 'Texas', scopeNoun: 'state', facts: facts({ salaryDisclosedCount: 2 }) }))).toMatch(/^2 postings in Texas state a salary/);
  });

  it('CS-S4 and LAND-L4: benchmark, else a cited count, else nothing', () => {
    expect(keep(buildPostedPaySentence({ slug: 'outpatient', facts: facts({ total: 8, benchmark: BENCH }) })))
      .toBe('Across 6 listings from 3 employers that state an annual salary, the median posted pay is $132K. The middle half of those listings fall between $118K and $150K.');
    expect(keep(buildPostedPaySentence({ slug: 'outpatient', facts: facts({ total: 5, salaryDisclosedCount: 2 }) })))
      .toBe(`2 of 5 listings state an annual salary. This site publishes a median only once at least ${BENCHMARK_MIN_POSTINGS} listings from ${BENCHMARK_MIN_EMPLOYERS} employers do, so compare pay listing by listing. ${NATIONAL_MEDIAN_SENTENCE}`);
    expect(keep(buildPostedPaySentence({ slug: 'outpatient', facts: facts({ total: 1, salaryDisclosedCount: 1 }) }))).toMatch(/^1 of 1 listing states an annual salary\./);
    expect(buildPostedPaySentence({ slug: 'outpatient', facts: facts({ total: 5, salaryDisclosedCount: 0 }) })).toBeNull();
  });

  it('anesthesia and midwifery never receive the NP median', () => {
    for (const slug of ['anesthesia', 'midwifery']) {
      expect(buildPostedPaySentence({ slug, facts: facts({ total: 5, salaryDisclosedCount: 3 }) }), slug).toBeNull();
      const gated = keep(buildPostedPaySentence({ slug, facts: facts({ total: 8, benchmark: BENCH }) }));
      expect(gated, slug).toContain('$132K');
      expect(gated, slug).not.toContain(BLS);
      for (const categoryBenchmark of [BENCH, null]) {
        const paragraph = keep(buildCategoryCityPayParagraph({ slug, labelSentence: 'nurse anesthetist', city: 'Austin', categoryBenchmark, cityBenchmark: BENCH }));
        expect(paragraph, slug).not.toContain(BLS);
        expect(paragraph, slug).not.toMatch(/national/i);
      }
    }
    expect(keep(buildCategoryCityPayParagraph({ slug: 'remote', labelSentence: 'remote', city: 'Austin', categoryBenchmark: BENCH, cityBenchmark: null }))).toContain(BLS);
  });

  it('CITY-C5 always renders with the national reference in both branches', () => {
    expect(keep(buildCityPayParagraph({ city: 'Austin', benchmark: BENCH })))
      .toBe(`Across 6 listings from 3 employers that disclose annual pay, the median in Austin is $132,000. The middle half falls between $118,000 and $150,000. ${NATIONAL_REFERENCE_SENTENCE}`);
    expect(keep(buildCityPayParagraph({ city: 'Austin', benchmark: null })))
      .toBe(`Fewer than ${BENCHMARK_MIN_POSTINGS} listings from at least ${BENCHMARK_MIN_EMPLOYERS} employers in Austin disclose annual pay, so this page does not publish a local figure. ${NATIONAL_REFERENCE_SENTENCE}`);
  });

  it('CC-K3 has three branches', () => {
    expect(keep(buildCategoryCityPayParagraph({ slug: 'remote', labelSentence: 'remote', city: 'Austin', categoryBenchmark: BENCH, cityBenchmark: BENCH })))
      .toMatch(/^Across 6 remote listings from 3 employers that disclose annual pay, the median in Austin is \$132,000\./);
    expect(keep(buildCategoryCityPayParagraph({ slug: 'remote', labelSentence: 'remote', city: 'Austin', categoryBenchmark: null, cityBenchmark: BENCH })))
      .toMatch(new RegExp(`^Not enough remote listings disclose pay\\. Across 6 listings from 3 employers that disclose annual pay, the median across all ${NP} listings in Austin is \\$132,000\\.`));
    expect(keep(buildCategoryCityPayParagraph({ slug: 'remote', labelSentence: 'remote', city: 'Austin', categoryBenchmark: null, cityBenchmark: null })))
      .toMatch(/^Fewer than 5 listings from at least 3 employers in Austin disclose annual pay/);
  });

  it('DIR-L3 card line and CO-C2 count sentence', () => {
    expect(buildCityCardPayLine(null)).toBeNull();
    expect(keep(buildCityCardPayLine(BENCH))).toBe('Median posted pay $132K (6 postings)');
    expect(keep(buildCompanyPaySentence({ company: 'Acme', total: 1, disclosed: 1 }))).toBe('1 of 1 open role lists a pay range.');
    expect(keep(buildCompanyPaySentence({ company: 'Acme', total: 4, disclosed: 2 }))).toBe('2 of 4 open roles list a pay range.');
    expect(keep(buildCompanyPaySentence({ company: 'Acme', total: 4, disclosed: 0 }))).toBe(`None of Acme's current ${NP} listings on ${BRAND} state a pay range.`);
  });
});

describe('licensure and practice environment', () => {
  it('CS-S6 sentences, with certification only on the APRN roles', () => {
    const sentences = buildLicensureSentences(TEXAS);
    expect(keep(sentences.classification)).toBe(`AANP classifies Texas as a restricted practice state. ${TEXAS.details}`);
    expect(keep(sentences.nlc)).toMatch(/^Texas is a Nurse Licensure Compact member\. The compact covers the RN license/);
    expect(keep(sentences.board)).toBe('Applications, fees and renewal rules come from the Texas Board of Nursing.');
    expect(sentences.certification).toBeNull();
    expect(buildLicensureSentences(TEXAS, 'remote').certification).toBeNull();
    expect(keep(buildLicensureSentences(TEXAS, 'anesthesia').certification)).toBe('CRNA certification is administered by NBCRNA.');
    expect(keep(buildLicensureSentences(TEXAS, 'midwifery').certification)).toBe('CNM certification is administered by AMCB.');
  });

  it('CITY-C6, CC-K6, HUB-S8, SAL-S1 and CO-C3 read from one environment', () => {
    const city = keep(buildPracticingInStateParagraph(TEXAS));
    expect(city.startsWith(`${TEXAS.authorityLabel}. ${TEXAS.details} Texas is a Nurse Licensure Compact member.`)).toBe(true);
    expect(city).toContain('APRN licensure is issued by the Texas Board of Nursing.');
    expect(keep(buildPracticingAsRoleParagraph(TEXAS, 'FNP-BC or FNP-C'))).toBe(`${city} Certification for this role: FNP-BC or FNP-C.`);
    expect(keep(buildBoardChecklistSentence(TEXAS.boardName))).toBe('Forms, fees and processing times change, so work from the Texas Board of Nursing checklist.');
    expect(keep(buildSalaryPracticeEnvironmentParagraph(TEXAS, NLC_VERIFIED_LABEL)))
      .toBe(`${TEXAS.authorityLabel}. ${TEXAS.details} Texas is a member of the Nurse Licensure Compact (verified against the NCSBN roster on ${NLC_VERIFIED_LABEL}). Licensure applications run through the Texas Board of Nursing.`);
    expect(keep(buildCompanyStatePracticeLine(TEXAS))).toBe(`Texas: Restricted Practice, a Nurse Licensure Compact member. ${TEXAS.details}`);
  });

  it('LAND-L3 never renders on the APRN axis and drops zero buckets', () => {
    const states = named([['Texas', 3], ['Arizona', 2], ['Ohio', 1]]);
    expect(buildListingsAuthoritySentence({ slug: 'anesthesia', states, total: 6 })).toBeNull();
    expect(buildListingsAuthoritySentence({ slug: 'midwifery', states, total: 6 })).toBeNull();
    expect(buildListingsAuthoritySentence({ slug: 'remote', states, total: MIX_MIN_POSTINGS_LISTING - 1 })).toBeNull();
    expect(buildListingsAuthoritySentence({ slug: 'remote', states: named([['Texas', 3]]), total: 3 })).toBeNull();
    expect(buildListingsAuthoritySentence({ slug: 'remote', states: named([['Atlantis', 3], ['Narnia', 2]]), total: 5 })).toBeNull();
    expect(keep(buildListingsAuthoritySentence({ slug: 'remote', states, total: 6 })))
      .toBe("By AANP's state classification, 2 of the 6 listings with a state are in full practice states, 1 in reduced practice states and 3 in restricted practice states.");
    expect(keep(buildListingsAuthoritySentence({ slug: 'remote', states: named([['Texas', 3], ['Ohio', 1]]), total: 4 })))
      .toBe("By AANP's state classification, 1 of the 4 listings with a state is in reduced practice states and 3 in restricted practice states.");
  });

  it('SPEC-P2 needs five openings with a known state', () => {
    expect(buildSpecialtyAuthoritySentence({ label: 'family practice', states: named([['Arizona', 3], ['Texas', 1]]) })).toBeNull();
    expect(keep(buildSpecialtyAuthoritySentence({ label: 'family practice', states: named([['Arizona', 4], ['Texas', 2]]) })))
      .toBe('Of the 6 open family practice roles with a listed state, 4 are in full practice authority states (Arizona) and 2 in restricted practice states, using the AANP classification.');
  });
});

describe('small blocks pluralize at one and carry no trend claims', () => {
  it('LAND-L6 and LAND-L7', () => {
    expect(keep(buildRelatedCategorySub(0))).toBe('Role overview');
    expect(keep(buildRelatedCategorySub(1))).toBe('1 open role');
    expect(keep(buildRelatedCategorySub(3))).toBe('3 open roles');
    expect(keep(buildLowInventoryIntro({ label: 'Remote', total: 0 }))).toBe('There are no current Remote listings. These related categories have more openings right now:');
    expect(keep(buildLowInventoryIntro({ label: 'Remote', total: 1 }))).toBe('There is 1 current Remote listing. These related categories have more openings right now:');
    expect(keep(buildLowInventoryIntro({ label: 'Remote', total: 2 }))).toBe('There are 2 current Remote listings. These related categories have more openings right now:');
  });

  it('METRO copy, hero badge and SAL summary', () => {
    expect(keep(buildMetroZeroJobsSentence('Austin'))).toBe('There are no open Austin roles on this site right now. Set an alert and we will email you when one is posted.');
    expect(keep(buildMetroHeadlineSub('TX'))).toBe('jobs in TX.');
    expect(keep(buildLiveRolesBadge(1))).toBe('1 live role');
    expect(keep(buildLiveRolesBadge(12))).toBe('12 live roles');
    expect(keep(buildSalaryStateSummary({ stateName: 'Texas', benchmark: BENCH }))).toBe(`Median posted pay for ${NP_PROSE}s in Texas, from 6 postings with disclosed pay across 3 employers.`);
    expect(keep(buildSalaryStateSummary({ stateName: 'Texas', benchmark: null }))).toBe(`Open ${NP_PROSE} roles in Texas, the state's practice rules, and how pay data is published here.`);
  });

  it('SAL-S4 omits every zero clause', () => {
    expect(buildHiringForSentence(facts())).toBeNull();
    expect(keep(buildHiringForSentence(facts({ total: 5, distinctEmployers: 2, workMode: mode(5, 2, 0, 3), recency: recency({ last7: 0, last30: 1 }), newGradFriendly: 1 }))))
      .toBe('5 open roles from 2 employers. 2 remote, 3 on site. 1 was added in the last 30 days; the newest was posted on September 1, 2026. 1 is marked open to new graduates.');
    expect(keep(buildHiringForSentence(facts({ total: 1, distinctEmployers: 1, workMode: mode(1, 0, 0, 1), recency: recency({ total: 1, last7: 0, last30: 0 }) }))))
      .toBe('1 open role from 1 employer. 1 on site. The newest was posted on September 1, 2026.');
  });

  it('SAL-S5 caption, SPEC CTA, CO-C1 footprint, DIR-L5 editorial', () => {
    expect(keep(SALARY_NEARBY_NOT_PUBLISHED)).toBe('Not published (sample below minimum)');
    expect(keep(buildSalaryNearbyCaption(NLC_VERIFIED_LABEL))).toContain(`published at ${BENCHMARK_MIN_POSTINGS} or more postings from ${BENCHMARK_MIN_EMPLOYERS} or more employers`);
    expect(buildSpecialtyCtaLine({ label: 'Family Practice', total: 0 })).toBeNull();
    expect(keep(buildSpecialtyCtaLine({ label: 'Family Practice', total: 1 }))).toBe('1 Family Practice opening is live right now.');
    expect(keep(buildSpecialtyCtaLine({ label: 'Family Practice', total: 4 }))).toBe('4 Family Practice openings are live right now.');
    expect(buildCompanyFootprintSentence({ company: 'Acme', total: 0, states: [], topSpecialties: [], newestPostedAt: null })).toBeNull();
    expect(keep(buildCompanyFootprintSentence({ company: 'Acme', total: 3, states: named([['Texas', 2], ['Ohio', 1]]), topSpecialties: ['Family Practice'], newestPostedAt: SEP_1 })))
      .toBe(`Acme has 3 open ${NP_PROSE} roles on ${BRAND} in Texas and Ohio. Most openings are for Family Practice. The newest was posted on September 1, 2026.`);
    expect(keep(buildCompanyFootprintSentence({ company: 'Acme', total: 1, states: [], topSpecialties: [], newestPostedAt: null })))
      .toBe(`Acme has 1 open ${NP_PROSE} role on ${BRAND} in remote roles with no listed state.`);
    expect(keep(COMPANY_CLAIM_CTA)).toBe('Hiring here? Ask to claim this profile.');
    expect(keep(buildDirectoryHowToUse(3))).toContain('once it carries 3 or more open roles');
  });
});

describe('FAQ arrays drop an entry whenever its answer is missing', () => {
  it('HUB-S10 keeps only the questions its data supports', () => {
    const thin = keepFaqs(buildHubFaqs({ stateName: 'Texas', facts: facts({ total: 4, workMode: mode(4, 1, 0, 3) }), env: null, categoryRows: [], stepNames: [] }));
    expect(thin.map((f) => f.question)).toEqual([
      `How many ${NP} jobs are in Texas?`,
      `What is the median ${NP} salary in Texas?`,
    ]);
    expect(thin[0].answer).toBe(`There are 4 open ${NP} roles in Texas on ${BRAND}. Counts refresh hourly.`);

    const full = keepFaqs(buildHubFaqs({
      stateName: 'Texas',
      facts: facts({
        total: 5, distinctEmployers: 3, topEmployers: emp([['Alpha', 3], ['Beta', 1], ['Gamma', 1]]),
        cities: [{ name: 'Austin', stateCode: 'TX', count: 3 }, { name: 'Dallas', stateCode: 'TX', count: 2 }],
        workMode: mode(5, 2, 0, 3), benchmark: BENCH,
      }),
      env: TEXAS,
      categoryRows: [{ label: 'Remote', count: 4 }, { label: 'Full-Time', count: 2 }],
      stepNames: ['Hold an active RN license', 'Complete a graduate program'],
    }));
    expect(full).toHaveLength(7);
    expect(full[0].answer).toBe(`There are 5 open ${NP} roles in Texas on ${BRAND}. By category, Remote has 4 open roles and Full-Time has 2. Counts refresh hourly.`);
    expect(full[1].answer).toBe(`${TEXAS.details} Source: ${STAT_SOURCES.fullPracticeStates.source}.`);
    expect(full[3].answer).toBe(`Austin has the most open ${NP} roles in Texas (3), followed by Dallas (2).`);
    expect(full[5].answer).toBe('2 of 5 open Texas roles are listed as remote. Each posting names the states it requires licensure in.');
    expect(full[6].answer).toBe('The first steps are to hold an active RN license and complete a graduate program. Applications run through the Texas Board of Nursing.');
    expect(full.every((f) => f.answer.length > 0)).toBe(true);
  });

  it('CITY-C8 pluralizes at one and omits the unsupported questions', () => {
    const one = keepFaqs(buildCityFaqs({ city: 'Austin', stateCode: 'TX', facts: facts({ total: 1, distinctEmployers: 1, topEmployers: emp([['Alpha', 1]]), recency: recency({ total: 1, datedCount: 0 }) }), env: null, categoryLabels: [] }));
    expect(one.map((f) => f.question)).toEqual([`How many ${NP} jobs are open in Austin, TX?`, `What do ${NP} listings in Austin pay?`]);
    expect(one[0].answer).toBe(`There is 1 active ${NP} listing in Austin.`);

    const full = keepFaqs(buildCityFaqs({
      city: 'Austin', stateCode: 'TX',
      facts: facts({ total: 5, distinctEmployers: 3, topEmployers: emp([['Alpha', 3], ['Beta', 1], ['Gamma', 1]]), settings: mix(5, [['Outpatient', 2], ['Inpatient', 1]]), recency: recency({ last30: 2 }) }),
      env: TEXAS, categoryLabels: ['Family Practice', 'Remote'],
    }));
    expect(full).toHaveLength(5);
    expect(full[0].answer).toBe(`There are 5 active ${NP} listings in Austin from 3 employers. 2 of the 5 listings were first posted in the last 30 days. The most recent was first posted on September 1, 2026.`);
    expect(full[2].answer).toBe('Listings in Austin include Family Practice and Remote roles. Clinical settings named in these listings include Outpatient (2) and Inpatient (1).');
    expect(full[3].answer).toMatch(/Alpha \(3\), Beta \(1\) and Gamma \(1\)\.$/);
  });

  it('CS-S9 needs a benchmark for the pay question and dataset answers for the two licensure questions', () => {
    const none = keepFaqs(buildSettingStateFaqs({ label: 'Remote', stateName: 'Texas', slug: 'remote', facts: facts(), physicianAnswer: null, nlcAnswer: null }));
    expect(none).toEqual([]);
    const full = keepFaqs(buildSettingStateFaqs({
      label: 'Remote', stateName: 'Texas', slug: 'remote',
      facts: facts({ total: 4, distinctEmployers: 1, topEmployers: emp([['Alpha', 4]]), recency: recency({ last30: 0 }), benchmark: BENCH }),
      physicianAnswer: 'Yes, in Texas.', nlcAnswer: 'Yes.',
    }));
    expect(full.map((f) => f.question)).toEqual([
      `How many Remote ${NP} jobs are open in Texas?`,
      `What do Remote ${NP} jobs in Texas pay?`,
      `Do ${NP}s need a collaborating physician in Texas?`,
      'Is Texas part of the Nurse Licensure Compact?',
    ]);
    expect(full[0].answer).toBe('All 4 current Remote listings in Texas are posted by Alpha. The newest listing was posted on September 1, 2026.');
    expect(buildSettingStateFaqs({ label: 'Remote', stateName: 'Texas', slug: 'remote', facts: facts({ total: 4, salaryDisclosedCount: 2 }), physicianAnswer: null, nlcAnswer: null }).some((f) => /pay/.test(f.question))).toBe(false);
  });

  it('CC-K8 replaces the opinion question with the employers question, omitted below two employers', () => {
    const base = { slug: 'remote', label: 'Remote', labelSentence: 'remote', city: 'Austin', stateName: 'Texas', cityBenchmark: null, env: TEXAS, qualifications: 'An active APRN license.' };
    const full = keepFaqs(buildCategoryCityFaqs({ ...base, facts: facts({ total: 3, distinctEmployers: 2, topEmployers: emp([['Alpha', 2], ['Beta', 1]]), recency: recency({ total: 3, last30: 1 }) }) }));
    expect(full.map((f) => f.question)).toEqual([
      `How many Remote ${NP} jobs are in Austin?`,
      'What do remote listings in Austin pay?',
      `Does Texas allow ${NP}s full practice authority?`,
      'Which employers are hiring remote roles in Austin?',
      'What qualifications do I need for remote jobs in Austin?',
    ]);
    expect(full[0].answer).toBe('There are 3 active remote listings in Austin from 2 employers. 1 of the 3 listings was first posted in the last 30 days. The most recent was first posted on September 1, 2026.');
    expect(full.some((f) => /good place/i.test(f.question))).toBe(false);
    const single = keepFaqs(buildCategoryCityFaqs({ ...base, env: null, qualifications: null, facts: facts({ total: 3, distinctEmployers: 1, topEmployers: emp([['Alpha', 3]]), recency: recency({ total: 3, datedCount: 0 }) }) }));
    expect(single.map((f) => f.question)).toEqual([`How many Remote ${NP} jobs are in Austin?`, 'What do remote listings in Austin pay?']);
    expect(single[0].answer).toBe('There are 3 active remote listings in Austin.');
  });

  it('DIR-L8, METRO-M6, SAL-S6, SPEC and CO-C6', () => {
    const directory = keepFaqs(buildDirectoryFaqs({ stateName: 'Texas', cities: [], facts: facts(), minCityJobs: 3 }));
    expect(directory.map((f) => f.question)).toEqual(['Why do some cities not have their own page?']);
    expect(keepFaqs(buildDirectoryFaqs({ stateName: 'Texas', cities: named([['Austin', 4], ['Dallas', 3]]), facts: facts({ distinctEmployers: 2, topEmployers: emp([['Alpha', 3], ['Beta', 1]]) }), minCityJobs: 3 }))).toHaveLength(3);

    expect(buildMetroEmployersFaq({ city: 'Austin', employers: named([['Alpha', 2]]) })).toBeNull();
    const metro = buildMetroEmployersFaq({ city: 'Austin', employers: named([['Alpha', 2], ['Beta', 1]]) })!;
    keepFaqs([metro]);
    expect(metro.answer).toBe(`Employers with open ${NP} roles in the Austin area right now include Alpha (2) and Beta (1).`);

    const salary = keepFaqs(buildSalaryStateFaqAdditions({ env: TEXAS, nlcVerifiedLabel: NLC_VERIFIED_LABEL, topEmployers: named([['Alpha', 2]]) }));
    expect(salary).toHaveLength(2);
    expect(salary[1].answer).toBe(`Texas is a member of the Nurse Licensure Compact, verified against the NCSBN roster on ${NLC_VERIFIED_LABEL}.`);
    expect(keepFaqs(buildSalaryStateFaqAdditions({ env: TEXAS, nlcVerifiedLabel: NLC_VERIFIED_LABEL, topEmployers: named([['Alpha', 2], ['Beta', 1]]) }))).toHaveLength(3);

    expect(buildSpecialtyFaqAdditions({ credential: 'FNP', statesSentence: null, workMode: null })).toEqual([]);
    expect(buildSpecialtyFaqAdditions({ credential: 'FNP', statesSentence: null, workMode: mode(4, 1, 0, 3) })).toEqual([]);
    const specialty = keepFaqs(buildSpecialtyFaqAdditions({ credential: 'FNP', statesSentence: 'Current listings span 2 states.', workMode: mode(5, 0, 0, 5) }));
    expect(specialty[1].answer).toBe('None of the 5 open FNP roles are listed as remote right now.');
    expect(keepFaqs(buildSpecialtyFaqAdditions({ credential: 'FNP', statesSentence: null, workMode: mode(5, 1, 0, 4) }))[0].answer).toBe('1 of 5 open FNP roles is listed as remote.');

    expect(buildCompanyFaqs({ company: 'Acme', total: 0, states: [], disclosed: 0, workMode: mode(0, 0, 0, 0), newGradFriendly: 0 })).toEqual([]);
    const company = keepFaqs(buildCompanyFaqs({ company: 'Acme', total: 2, states: named([['Texas', 2]]), disclosed: 1, workMode: mode(2, 2, 0, 0), newGradFriendly: 1 }));
    expect(company).toHaveLength(5);
    expect(company[3].answer).toBe(`Yes. All 2 current ${NP} listings from Acme are remote.`);
    expect(company[4].answer).toBe('1 of its current listings is marked open to new graduates.');
    expect(keepFaqs(buildCompanyFaqs({ company: 'Acme', total: 3, states: [], disclosed: 0, workMode: mode(3, 1, 0, 2), newGradFriendly: 0 })).map((f) => f.question))
      .toEqual([`How many ${NP_PROSE} jobs does Acme have open?`, `Does Acme list pay on its ${NP} jobs?`, `Are Acme's ${NP} roles remote?`]);
  });
});

describe('titles print counts only at the display floor and stay inside the SERP budget', () => {
  it('HUB-meta', () => {
    expect(keep(buildHubTitle({ stateName: 'Texas', stateCode: 'TX', total: COUNT_DISPLAY_FLOOR - 1, distinctEmployers: 1, benchmark: null }))).toBe(`${NP} Jobs in Texas (TX): 1 Employer Hiring`);
    expect(keep(buildHubTitle({ stateName: 'Texas', stateCode: 'TX', total: COUNT_DISPLAY_FLOOR, distinctEmployers: 3, benchmark: BENCH }))).toBe(`${COUNT_DISPLAY_FLOOR} ${NP} Jobs in Texas (TX): $132K Median Pay`);
    const description = keep(buildHubDescription({ stateName: 'Texas', facts: facts({ total: 12, distinctEmployers: 4, cities: [{ name: 'Austin', stateCode: 'TX', count: 5 }] }), authorityDescription: 'Restricted Practice', topCategories: ['Remote', 'Full-Time', 'Travel'] }));
    expect(description).toBe(`12 open ${NP_PROSE} roles in Texas from 4 employers, led by Austin. Restricted Practice state. Top categories: Remote and Full-Time.`);
    // A crowded page drops clauses from the end rather than overflow or cut mid-word.
    const crowded = keep(buildHubDescription({ stateName: 'Texas', facts: facts({ total: 12, distinctEmployers: 4, cities: [{ name: 'Austin', stateCode: 'TX', count: 5 }, { name: 'Dallas', stateCode: 'TX', count: 3 }], benchmark: BENCH }), authorityDescription: 'Restricted Practice', topCategories: ['Remote', 'Full-Time'] }));
    expect(crowded).toBe(`12 open ${NP_PROSE} roles in Texas from 4 employers, led by Austin and Dallas. Restricted Practice state. Median posted pay $132K.`);
    expect(crowded.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it('CITY-C9', () => {
    expect(keep(buildCityTitle({ displayName: 'Austin', stateCode: 'TX', total: 6, distinctEmployers: 2, benchmark: BENCH }))).toBe(`6 ${NP} Jobs in Austin, TX: $132K Median`);
    expect(keep(buildCityTitle({ displayName: 'Austin', stateCode: 'TX', total: 6, distinctEmployers: 2, benchmark: null }))).toBe(`6 ${NP} Jobs in Austin, TX from 2 Employers`);
    expect(keep(buildCityTitle({ displayName: 'Austin', stateCode: 'TX', total: 3, distinctEmployers: 1, benchmark: null }))).toBe(`${NP} Jobs in Austin, TX`);
    const long = keep(buildCityTitle({ displayName: 'Rancho Santa Margarita Heights', stateCode: 'CA', total: 6, distinctEmployers: 2, benchmark: BENCH }));
    expect(long.length).toBeLessThanOrEqual(TITLE_PAGE_PART_MAX);
    expect(long).toBe(`6 ${NP} Jobs in Rancho Santa Margarita Heights, CA`);

    const description = keep(buildCityDescription({ displayName: 'Austin', stateName: 'Texas', facts: facts({ total: 6, distinctEmployers: 2, topEmployers: emp([['One Medical', 4], ['Beta', 2]]), workMode: mode(6, 1, 1, 4), recency: recency() }) }));
    expect(description).toBe(`6 active ${NP} listings in Austin, Texas from 2 employers, including One Medical. 2 offer remote or hybrid work. Newest posted Sep 1.`);
    expect(keep(buildCityDescription({ displayName: 'Austin', stateName: 'Texas', facts: facts({ total: 1, distinctEmployers: 1, topEmployers: emp([['Beta', 1]]), workMode: mode(1, 0, 0, 1), recency: recency({ newestPostedAt: null }) }) })))
      .toBe(`1 active ${NP} listing in Austin, Texas from Beta. All are in person.`);
  });

  it('CS-meta', () => {
    expect(keep(buildSettingStateTitle({ titleLabel: 'Remote', stateName: 'Texas', total: COUNT_DISPLAY_FLOOR - 1 }))).toBe(`Remote ${NP} Jobs in Texas`);
    expect(keep(buildSettingStateTitle({ titleLabel: 'Remote', stateName: 'Texas', total: COUNT_DISPLAY_FLOOR }))).toBe(`Remote ${NP} Jobs in Texas: ${COUNT_DISPLAY_FLOOR} Openings`);
    const longBase = `Adult-Gerontology Primary Care ${NP} Jobs in North Carolina`;
    expect(keep(buildSettingStateTitle({ titleLabel: 'Adult-Gerontology Primary Care', stateName: 'North Carolina', total: 40 }))).toBe(longBase);
    const description = keep(buildSettingStateDescription({ label: 'Remote', slug: 'remote', stateName: 'Texas', facts: facts({ total: 1, distinctEmployers: 1, cities: [{ name: 'Austin', stateCode: 'TX', count: 1 }] }), authorityDescription: 'Restricted Practice', statsAsOf: SEP_1 }));
    expect(description).toBe(`1 remote ${NP} opening in Texas from 1 employer. Restricted Practice state. Updated Sep 1.`);
    expect(keep(buildSettingStateDescription({ label: 'Outpatient', slug: 'outpatient', stateName: 'Texas', facts: facts({ total: 6, distinctEmployers: 2, cities: [{ name: 'Austin', stateCode: 'TX', count: 4 }], benchmark: BENCH }), authorityDescription: null, statsAsOf: null })))
      .toBe(`6 outpatient ${NP} openings in Texas from 2 employers. Median posted pay $132K. Top city: Austin.`);
  });

  it('CC-K9, DIR-meta, METRO-meta', () => {
    expect(keep(buildCategoryCityTitle({ labelNoun: `Remote ${NP}`, city: 'Austin', stateCode: 'TX', total: COUNT_DISPLAY_FLOOR - 1 }))).toBe(`Remote ${NP} Jobs in Austin, TX`);
    expect(keep(buildCategoryCityTitle({ labelNoun: 'Nurse Anesthetist', city: 'Austin', stateCode: 'TX', total: COUNT_DISPLAY_FLOOR }))).toBe(`Nurse Anesthetist Jobs in Austin, TX (${COUNT_DISPLAY_FLOOR} Open)`);
    const ccDescription = keep(buildCategoryCityDescription({ labelSentence: 'remote', city: 'Austin', stateCode: 'TX', facts: facts({ total: 3, distinctEmployers: 2, topEmployers: emp([['Alpha', 2], ['Beta', 1]]), workMode: mode(3, 3, 0, 0) }), authorityDescription: 'Restricted Practice' }));
    expect(ccDescription).toBe('3 active remote listings in Austin, TX from 2 employers, led by Alpha. 3 are hybrid or remote. Restricted Practice state.');
    expect(keep(buildCategoryCityDescription({ labelSentence: 'outpatient', city: 'Austin', stateCode: 'TX', facts: facts({ total: 3, distinctEmployers: 1, workMode: mode(3, 0, 0, 3), settings: mix(3, [['Outpatient', 2], ['Clinic', 1]]) }), authorityDescription: null })))
      .toBe('3 active outpatient listings in Austin, TX. Settings include Outpatient and Clinic.');

    expect(keep(buildDirectoryTitle({ stateName: 'Texas', trackedCities: 1 }))).toBe(`${NP} Jobs by City in Texas: 1 City Hiring`);
    expect(keep(buildDirectoryTitle({ stateName: 'Texas', trackedCities: 3 }))).toBe(`${NP} Jobs by City in Texas: 3 Cities Hiring`);
    expect(keep(buildDirectoryDescription({ stateName: 'Texas', totalStateJobs: 12, trackedCities: 3, leadCities: ['Austin', 'Dallas', 'Houston'] })))
      .toBe(`12 open ${NP_PROSE} roles across 3 Texas cities, led by Austin and Dallas. See live counts and employers city by city.`);

    expect(keep(buildMetroTitle({ city: 'Austin', stateCode: 'TX', total: COUNT_DISPLAY_FLOOR - 1, year: 2026 }))).toBe(`${NP} Jobs in Austin, TX (2026)`);
    expect(keep(buildMetroTitle({ city: 'Austin', stateCode: 'TX', total: COUNT_DISPLAY_FLOOR, year: 2026 }))).toBe(`${COUNT_DISPLAY_FLOOR} ${NP} Jobs in Austin, TX (2026)`);
    const metroInput = { city: 'Austin', stateCode: 'TX', stateName: 'Texas', practiceAuthority: 'Restricted', nearbyCities: ['Round Rock', 'Cedar Park', 'Georgetown'], subMarkets: ['Downtown', 'North Austin'] };
    expect(keep(buildMetroDescription({ ...metroInput, benchmark: null })))
      .toBe(`Open ${NP} roles in Austin, TX and nearby Round Rock and Cedar Park. Texas is a restricted practice state. Hiring across Downtown and North Austin.`);
    const crowdedMetro = keep(buildMetroDescription({ ...metroInput, benchmark: BENCH }));
    expect(crowdedMetro).toBe(`Open ${NP} roles in Austin, TX and nearby Round Rock and Cedar Park. Texas is a restricted practice state. Median posted pay $132K.`);
    expect(crowdedMetro.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it('SAL-meta, CO-meta and SPEC-meta', () => {
    expect(keep(buildSalaryStateTitle({ stateName: 'Texas', stateCode: 'TX', benchmark: BENCH, year: 2026 }))).toBe(`${NP} Salary in Texas (TX): $132,000 Median, 2026`);
    expect(keep(buildSalaryStateTitle({ stateName: 'Texas', stateCode: 'TX', benchmark: null, year: 2026 }))).toBe(`${NP} Jobs and Pay Data in Texas (TX), 2026`);
    const gated = keep(buildSalaryStateDescription({ env: TEXAS, facts: facts({ total: 9, benchmark: BENCH }) }));
    expect(gated).toBe(`Median posted ${NP} pay in Texas is $132,000 across 6 postings from 3 employers, middle half $118,000 to $150,000. 9 open roles, restricted practice.`);
    const below = keep(buildSalaryStateDescription({ env: TEXAS, facts: facts({ total: 2, distinctEmployers: 1 }) }));
    // The gate clause is assembled last and is dropped whenever the first two fill the budget.
    expect(below).toBe(`2 open ${NP} roles in Texas from 1 employer. Texas is a restricted practice state and a Nurse Licensure Compact member.`);
    expect(gated.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(below.length).toBeLessThanOrEqual(DESCRIPTION_MAX);

    expect(keep(buildCompanyTitle({ company: 'Acme', states: named([['Texas', 2]]), allRemote: false }))).toBe(`Acme ${NP} Jobs in Texas`);
    expect(keep(buildCompanyTitle({ company: 'Acme', states: named([['Texas', 2], ['Ohio', 1]]), allRemote: false }))).toBe(`Acme ${NP} Jobs in Texas and Ohio`);
    expect(keep(buildCompanyTitle({ company: 'Acme', states: named([['Texas', 2], ['Ohio', 1], ['Iowa', 1]]), allRemote: false }))).toBe(`Acme ${NP} Jobs in 3 States`);
    expect(keep(buildCompanyTitle({ company: 'Acme', states: [], allRemote: true }))).toBe(`Acme ${NP} Jobs (Remote)`);
    expect(keep(buildCompanyTitle({ company: 'Acme', states: [], allRemote: false }))).toBe(`Acme ${NP} Jobs`);
    const longCompany = 'Consolidated Regional Healthcare Partners of the Southwest';
    expect(keep(buildCompanyTitle({ company: longCompany, states: named([['Texas', 2], ['Ohio', 1]]), allRemote: false }))).toBe(`${longCompany} ${NP} Jobs`);
    expect(keep(buildCompanyDescription({ company: 'Acme', total: 3, states: named([['Texas', 2], ['Ohio', 1]]), topSpecialty: 'Family Practice', disclosed: 1 })))
      .toBe(`Acme has 3 open ${NP_PROSE} roles on ${BRAND} in Texas and Ohio, mostly Family Practice. 1 of 3 lists pay. Apply from each listing.`);

    expect(keep(buildSpecialtyDescription({ role: 'Nurse Anesthetist (CRNA)', total: 4, benchmark: null, isNicheRole: false }))).toBe(`Nurse Anesthetist (CRNA) salary guide: 4 open roles on ${BRAND}.`);
    // The niche-role cite is the short inline form (agency plus vintage) derived from the stats entry.
    expect(keep(buildSpecialtyDescription({ role: 'FNP', total: 1, benchmark: null, isNicheRole: true })))
      .toBe(`FNP salary guide: 1 open role on ${BRAND}. National all-${NP} median ${BLS} (BLS OEWS, May 2024).`);
    const gatedSpecialty = keep(buildSpecialtyDescription({ role: 'Family Nurse Practitioner (FNP)', total: 1, benchmark: BENCH, isNicheRole: true }));
    expect(gatedSpecialty).toBe(`Family Nurse Practitioner (FNP) salary guide: 1 open role on ${BRAND}, board median $132,000 across 6 postings with disclosed pay.`);
    expect(gatedSpecialty.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});

describe('copy lint over every string the builders produced in this file', () => {
  it('collected a meaningful sample', () => {
    expect(seen.length).toBeGreaterThan(150);
  });

  it('never emits an en dash, an em dash or a spaced hyphen', () => {
    // Built from code points so this file itself carries neither a dash character nor a spaced hyphen.
    const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]| ${String.fromCharCode(0x2d)} `);
    for (const text of seen) expect(text).not.toMatch(dashes);
  });

  it('never says average, never calls the board median national, never uses a trend word', () => {
    for (const text of seen) {
      expect(text).not.toMatch(/\baverage\b/i);
      expect(text).not.toMatch(/\b(growing|hot|in demand|added daily|updated daily|updated today)\b/i);
      expect(text).not.toMatch(/board median[^.]*national/i);
    }
  });

  it('never pads a zero, a $0 or an N/A', () => {
    for (const text of seen) {
      expect(text).not.toMatch(/\b0 (remote|hybrid|on site|in person|are|is|was|were|posting|postings|listing|listings|open|employer|employers|other)\b/);
      expect(text).not.toMatch(/\$0\b/);
      expect(text).not.toMatch(/\bN\/A\b/);
    }
  });
});
