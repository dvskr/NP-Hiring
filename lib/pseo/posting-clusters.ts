/**
 * lib/pseo/posting-clusters.ts
 *
 * What a pSEO index gate counts (indexing audit fixSoon 8, CQ-10): distinct
 * postings and role clusters, never raw rows.
 *
 *   - A POSTING is one employer's role at one location. Rows that repeat the
 *     same employer, the same normalized title and the same city and state
 *     are exact duplicates of one posting and count once. Genuine per-city
 *     requisitions (the same title in two towns) stay separate postings,
 *     because the employer posts them separately.
 *   - A ROLE CLUSTER is one employer's role anywhere: the same employer and
 *     normalized title across every location count once. Four copies of
 *     "Family Nurse Practitioner" from one staffing firm in four towns
 *     are four postings but one role cluster.
 *
 * Employers merge through the identity lib/pseo/city-employers.ts uses for
 * every employer roster, so the employer count here equals the
 * distinctEmployers a page prints. Titles normalize with normalizeTitle from
 * lib/deduplicator.ts, the rule ingestion keys duplicates on, so "the same
 * title" means the same thing at ingest and at the gate.
 *
 * A row whose title was not selected (`title` undefined) cannot be compared,
 * so it counts as its own posting and its own cluster: an unknown title never
 * merges two rows. Pure, so the gates are testable without a database.
 */
import { normalizeTitle } from '@/lib/deduplicator';
import { employerIdentityKey } from './city-employers';

/** The Job columns the counts read. `title` is optional for legacy selects. */
export interface PostingRow {
  employer: string | null;
  title?: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
}

export interface PostingCounts {
  /** Rows counted. */
  rows: number;
  /** Rows after exact duplicates (employer, normalized title, city and state) collapse. */
  postings: number;
  /** Distinct employers, aliases merged. Rows with no employer name are not an employer. */
  employers: number;
  /** Distinct (employer, normalized title) pairs. */
  roleClusters: number;
  /** Postings held by the largest employer (0 when no row names an employer). */
  topEmployerPostings: number;
}

/** The ingestion deduplicator's title normalization; empty for a missing title. */
export function normalizeRoleTitle(title: string | null | undefined): string {
  return title ? normalizeTitle(title) : '';
}

function locationKey(row: PostingRow): string {
  const city = row.city?.trim().toLowerCase() ?? '';
  const state = (row.stateCode?.trim() || row.state?.trim() || '').toLowerCase();
  return `${city}|${state}`;
}

/** Tally postings, employers and role clusters over a row set. */
export function countPostings(rows: ReadonlyArray<PostingRow>): PostingCounts {
  const postingKeys = new Set<string>();
  const clusterKeys = new Set<string>();
  const postingsByEmployer = new Map<string, Set<string>>();
  rows.forEach((row, index) => {
    const employer = employerIdentityKey(row.employer);
    const titleKnown = row.title !== undefined;
    const title = titleKnown ? normalizeRoleTitle(row.title) : `#row-${index}`;
    const posting = `${employer ?? `#no-employer-${index}`}|${title}|${locationKey(row)}`;
    postingKeys.add(titleKnown ? posting : `#row-${index}`);
    clusterKeys.add(`${employer ?? `#no-employer-${index}`}|${title}`);
    if (employer) {
      const set = postingsByEmployer.get(employer) ?? new Set<string>();
      set.add(titleKnown ? posting : `#row-${index}`);
      postingsByEmployer.set(employer, set);
    }
  });
  let topEmployerPostings = 0;
  for (const set of postingsByEmployer.values()) topEmployerPostings = Math.max(topEmployerPostings, set.size);
  return {
    rows: rows.length,
    postings: postingKeys.size,
    employers: postingsByEmployer.size,
    roleClusters: clusterKeys.size,
    topEmployerPostings,
  };
}

/**
 * The distinct-posting count of a whole scope when only a sample of its rows
 * was tallied: the full canonical total minus the duplicates the sample
 * found. Exact whenever the sample is the whole scope (every pSEO scope today
 * sits far under the row caps), and never below zero.
 */
export function distinctPostingTotal(total: number, sample: Pick<PostingCounts, 'rows' | 'postings'>): number {
  const duplicates = Math.max(0, sample.rows - sample.postings);
  return Math.max(0, total - duplicates);
}
