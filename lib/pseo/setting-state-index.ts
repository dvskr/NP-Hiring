/**
 * lib/pseo/setting-state-index.ts
 *
 * The facts the strict category x state index gate reads (CQ-01, fixSoon
 * 16), built from the setting's rows in one state and the parent state hub's
 * verdict, and the sibling de-duplication the cron applies across every
 * setting of a state. The aggregate-pseo cron is the only writer of the
 * verdict (PseoStats.indexable, type 'setting-state'); the page robots, the
 * cities sitemap and the sitemap index read that stored verdict through
 * isSettingStateIndexable (lib/pseo/render-gate.ts). Pure.
 */
import { countPostings, type PostingRow } from './posting-clusters';
import {
  MAX_SIBLING_OVERLAP_FOR_SETTING_STATE_INDEX,
  STRUCTURED_REMOTE_SETTING_SLUGS,
  type SettingStateIndexFacts,
} from './render-gate';

/** The Job columns the gate facts read. */
export interface SettingStateGateRow extends PostingRow {
  /** The job id: sibling settings are compared on their counted job sets. */
  id?: string;
  isRemote: boolean;
  isHybrid: boolean;
  /** The employer's first-posted date; createdAt when absent. */
  originalPostedAt?: Date | null;
  createdAt?: Date | null;
}

/** The parent hub's verdict and posting count (lib/pseo/state-hub-index.ts). */
export interface ParentHubFacts {
  indexable: boolean;
  postings: number;
}

/** The recency window of the gate's "posted in the last 30 days" rule. */
export const SETTING_STATE_RECENCY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fully remote by the structured work mode: remote and not hybrid (the same
 * test JobPosting TELECOMMUTE uses in components/JobStructuredData.tsx).
 */
export function isFullyRemote(row: Pick<SettingStateGateRow, 'isRemote' | 'isHybrid'>): boolean {
  return row.isRemote === true && row.isHybrid !== true;
}

/**
 * The rows a setting's gate counts: every row, except that the work-mode
 * settings (remote, telehealth) count only fully remote rows, never the
 * category tag that description keywords also set (CQ-05).
 */
export function settingStateGateRows<T extends SettingStateGateRow>(slug: string, rows: ReadonlyArray<T>): T[] {
  return STRUCTURED_REMOTE_SETTING_SLUGS.includes(slug) ? rows.filter(isFullyRemote) : [...rows];
}

/** Rows first posted inside the recency window (originalPostedAt, else createdAt). */
export function countRecentPostings(
  rows: ReadonlyArray<Pick<SettingStateGateRow, 'originalPostedAt' | 'createdAt'>>,
  now: Date = new Date(),
): number {
  const cutoff = now.getTime() - SETTING_STATE_RECENCY_DAYS * DAY_MS;
  let count = 0;
  for (const row of rows) {
    const posted = row.originalPostedAt ?? row.createdAt ?? null;
    const t = posted ? posted.getTime() : Number.NaN;
    if (t >= cutoff) count += 1;
  }
  return count;
}

/**
 * Strict gate facts for one setting in one state. A missing hub verdict
 * (no hub rows, or the hub read failed) closes the gate: the parent must be
 * known to index before a child can. Rows without a posted or created date
 * never count as recent.
 */
export function buildSettingStateIndexFacts(input: {
  slug: string;
  rows: ReadonlyArray<SettingStateGateRow>;
  hub: ParentHubFacts | null | undefined;
  now?: Date;
}): SettingStateIndexFacts {
  const gateRows = settingStateGateRows(input.slug, input.rows);
  const counts = countPostings(gateRows);
  return {
    postings: counts.postings,
    employers: counts.employers,
    roleClusters: counts.roleClusters,
    topEmployerPostings: counts.topEmployerPostings,
    hubIndexable: input.hub?.indexable === true,
    hubPostings: input.hub?.postings ?? 0,
    postedLast30Days: countRecentPostings(gateRows, input.now),
  };
}

/** The job ids a setting's gate counted (fully remote rows only for remote and telehealth). */
export function settingStateGateJobIds(slug: string, rows: ReadonlyArray<SettingStateGateRow>): string[] {
  return settingStateGateRows(slug, rows).flatMap((row) => (row.id ? [row.id] : []));
}

/* ─── Sibling de-duplication (CQ-01) ────────────────────────────────────── */

/**
 * Share of the smaller job set that the other set also holds: 1 for
 * identical sets or a subset, 0 when either is empty.
 */
export function siblingOverlap(a: readonly string[], b: readonly string[]): number {
  const small = a.length <= b.length ? a : b;
  const large = new Set(a.length <= b.length ? b : a);
  if (small.length === 0) return 0;
  let shared = 0;
  for (const id of new Set(small)) if (large.has(id)) shared += 1;
  return shared / new Set(small).size;
}

/** One setting of one state, as the cron computed it. */
export interface SettingStateSiblingCandidate {
  slug: string;
  /** The job ids the gate counted (settingStateGateJobIds). */
  jobIds: readonly string[];
  /** Distinct postings behind them: the size siblings are ranked by. */
  postings: number;
  /** The strict gate's verdict (shouldIndexSettingState) before de-duplication. */
  passes: boolean;
}

/**
 * The settings of ONE state that keep their passing verdict: the passing
 * candidates, largest first (postings, then jobs, then slug for a stable
 * order), each kept unless it shares MAX_SIBLING_OVERLAP_FOR_SETTING_STATE_INDEX
 * or more of its jobs with a larger sibling already kept. Identical sets and
 * near-copies therefore index once, as the larger page.
 */
export function dedupeSiblingSettingStates(candidates: readonly SettingStateSiblingCandidate[]): Set<string> {
  const passing = candidates
    .filter((c) => c.passes)
    .sort((a, b) => b.postings - a.postings || b.jobIds.length - a.jobIds.length || a.slug.localeCompare(b.slug));
  const kept: SettingStateSiblingCandidate[] = [];
  for (const candidate of passing) {
    const duplicate = kept.some((k) => siblingOverlap(k.jobIds, candidate.jobIds) >= MAX_SIBLING_OVERLAP_FOR_SETTING_STATE_INDEX);
    if (!duplicate) kept.push(candidate);
  }
  return new Set(kept.map((c) => c.slug));
}
