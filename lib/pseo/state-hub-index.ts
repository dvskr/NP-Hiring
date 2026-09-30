/**
 * lib/pseo/state-hub-index.ts
 *
 * The state hub's index input (`/jobs/state/{state}`), computed by one set of
 * rules for every reader of the verdict:
 *   - the hub page's robots (from its own ListingFacts),
 *   - the aggregate-pseo cron, whose strict category x state gate needs the
 *     parent hub's verdict and posting count (CQ-01: "an indexable parent
 *     state hub", "the setting at most 70 percent of the hub's jobs"),
 *   - the primary sitemap (app/sitemap.ts statePages).
 *
 * The live data section count (thin-spec-3 S1 to S7) used to be written out
 * twice, once in the hub page and once in app/sitemap.ts, each file warning
 * that the copies must stay identical "until the count moves into the shared
 * layer". This is that layer.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { getPublishableSalaryGuideStates } from '@/lib/salary-analytics';
import { tallyListingFacts, type ListingFactRow, type ListingFacts } from './listing-facts';
import {
  buildHubCategoriesSentence,
  buildHubCitiesSentences,
  buildHubEmployersSentence,
  buildHubRecencySentence,
  buildHubSettingsSentence,
  buildHubWorkModeSentence,
} from './listing-narrative';
import { shouldIndexStateHub, type StateHubIndexInput } from './render-gate';
import { STATE_CODES, stateToSlug } from './setting-state-config';

/** The facts the section count reads (a ListingFacts satisfies it). */
export type HubSectionFacts = Pick<
  ListingFacts,
  'total' | 'distinctEmployers' | 'topEmployers' | 'cities' | 'categoryTop' | 'workMode' | 'settings' | 'recency'
>;

/**
 * HUB-S1 to S7 as the index gate counts them: each section's own builder
 * decides (null means the section is omitted) and S7 counts only when the
 * state publishes a gated median.
 */
export function countHubLiveDataSections(stateName: string, facts: HubSectionFacts, publishesMedian: boolean): number {
  return [
    buildHubEmployersSentence({ stateName, facts }) !== null, // S1
    buildHubCitiesSentences(facts.cities) !== null, // S2
    buildHubCategoriesSentence(facts.categoryTop) !== null, // S3
    buildHubWorkModeSentence(facts.workMode) !== null, // S4
    buildHubSettingsSentence(facts.settings) !== null, // S5
    buildHubRecencySentence(facts.recency) !== null, // S6
    publishesMedian, // S7
  ].filter(Boolean).length;
}

/** The hub gate input from the hub's facts: distinct postings, employers, sections. */
export function stateHubIndexInput(
  stateName: string,
  facts: HubSectionFacts & Pick<ListingFacts, 'distinctPostings'>,
  publishesMedian: boolean,
  page: number = 1,
): StateHubIndexInput {
  return {
    activeJobs: facts.distinctPostings,
    distinctEmployers: facts.distinctEmployers,
    liveDataSections: countHubLiveDataSections(stateName, facts, publishesMedian),
    page,
  };
}

/** One jurisdiction's hub verdict, as the cron and the sitemap read it. */
export interface StateHubVerdict {
  stateName: string;
  stateSlug: string;
  input: StateHubIndexInput;
  indexable: boolean;
  /** Distinct postings on the hub (the denominator of the setting share). */
  postings: number;
}

/**
 * Hub verdicts for every STATE_CODES jurisdiction from a canonical row pool.
 * A row belongs to a hub under the hub page's own bucket, `state = name OR
 * stateCode = code` (exact equality, as the page's Prisma query compares).
 * Pure over its inputs.
 */
export function computeStateHubVerdicts(
  rows: ReadonlyArray<ListingFactRow>,
  publishableStates: ReadonlySet<string>,
  now: Date = new Date(),
): Map<string, StateHubVerdict> {
  const verdicts = new Map<string, StateHubVerdict>();
  for (const [stateName, stateCode] of Object.entries(STATE_CODES)) {
    const stateRows = rows.filter((row) => row.state === stateName || row.stateCode === stateCode);
    if (stateRows.length === 0) continue;
    const tally = tallyListingFacts(stateRows, now);
    const facts = {
      ...tally,
      total: stateRows.length,
      topEmployers: tally.topEmployers.map(({ name, count }) => ({ name, count, companyPath: null })),
    };
    const input = stateHubIndexInput(stateName, facts, publishableStates.has(stateName));
    verdicts.set(stateName, {
      stateName,
      stateSlug: stateToSlug(stateName),
      input,
      indexable: shouldIndexStateHub(input),
      postings: facts.distinctPostings,
    });
  }
  return verdicts;
}

/** The projection the verdicts read: the listing-facts row plus the title. */
const HUB_ROW_SELECT = {
  employer: true,
  title: true,
  companyId: true,
  city: true,
  state: true,
  stateCode: true,
  isRemote: true,
  isHybrid: true,
  jobType: true,
  setting: true,
  categoryTags: true,
  originalPostedAt: true,
  createdAt: true,
  newGradFriendly: true,
  salaryIsEstimated: true,
  normalizedMinSalary: true,
} as const satisfies Prisma.JobSelect;

/** Memory guard; the canonical pool is about one thousand rows today. */
const HUB_ROW_CAP = 10_000;

/**
 * Every hub verdict from one canonical row query plus the publishable
 * salary states. A capped pool undercounts, so it can only close a gate,
 * never open one. The salary lookup failing costs S7 only (no median is then
 * counted as published). The row query is allowed to throw: the caller
 * decides whether a failure closes every hub (the cron) or omits the section
 * (the sitemap).
 */
export async function loadStateHubVerdicts(now: Date = new Date()): Promise<Map<string, StateHubVerdict>> {
  const [rows, publishable] = await Promise.all([
    prisma.job.findMany({
      where: canonicalBucketWhere({ OR: [{ state: { not: null } }, { stateCode: { not: null } }] }, now),
      select: HUB_ROW_SELECT,
      orderBy: { createdAt: 'desc' },
      take: HUB_ROW_CAP,
    }),
    readPublishableStates(),
  ]);
  const pool: ListingFactRow[] = Array.isArray(rows) ? rows : [];
  return computeStateHubVerdicts(pool, publishable, now);
}

/** States whose salary guide publishes a gated median; empty on failure (S7 then counts nowhere). */
async function readPublishableStates(): Promise<ReadonlySet<string>> {
  try {
    const states = await getPublishableSalaryGuideStates();
    return states instanceof Set ? states : new Set<string>();
  } catch (error) {
    console.error('[state-hub-index] publishable salary states lookup failed; S7 counts for no state:', error);
    return new Set<string>();
  }
}
