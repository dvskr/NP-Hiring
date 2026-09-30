/**
 * lib/work-mode-integrity.ts: whether a stored row's work mode is what the
 * ingest rules derive, and whether its flags are internally consistent
 * (indexing audit GFJ-01).
 *
 * Two readers share it:
 *   - scripts/backfill-remote-flags.ts (owner-run: dry run, --apply, and the
 *     assert-only --check);
 *   - app/api/cron/job-posting-integrity (daily): the same check, so drift
 *     "fails loudly" without anyone running the script.
 *
 * Pure: no database.
 */
import { parseLocation } from './location-parser';
import { detectAtsRemoteType, detectMode, hasRemoteEvidence } from './work-mode-detection';
import { reconcileWorkMode } from './job-normalizer';

// Employer-declared modes come from the post-job form's required work-mode
// field: structured input, authoritative over any keyword inference.
export const STRUCTURED_MODE_SOURCE_TYPES: ReadonlySet<string> = new Set(['employer', 'direct']);

/** The stored columns the checks read. */
export interface WorkModeRow {
  readonly id: string;
  readonly title: string;
  readonly employer: string;
  readonly location: string | null;
  readonly description: string | null;
  readonly mode: string | null;
  readonly isRemote: boolean;
  readonly isHybrid: boolean;
  readonly isPublished: boolean;
  readonly sourceType: string | null;
}

export interface PlannedWorkModeRepair {
  readonly id: string;
  readonly title: string;
  readonly employer: string;
  readonly location: string;
  readonly sourceType: string;
  readonly isPublished: boolean;
  readonly oldMode: string | null;
  readonly newMode: string | null;
  readonly oldIsRemote: boolean;
  readonly newIsRemote: boolean;
  readonly oldIsHybrid: boolean;
  readonly newIsHybrid: boolean;
}

/**
 * Run one stored row through the ingest-time derivation and report the
 * repair when the stored values differ. The text surface is ingest's own:
 * title + description + LOCATION (lib/job-normalizer.ts builds
 * `${title} ${fullDescription} ${location}` for detectMode). The location
 * matters: "Telecommute" and "Office Based - ..." are mode proof only via
 * detectMode, and omitting it derived null where ingest derives a mode, so
 * --apply wrote values the next renewal reverted (flip-flop).
 *
 * The structured mode is the employer's own field for employer-posted rows,
 * else an ATS "Remote Type" field in the description, as at ingest. An ATS
 * work-mode field that is not stored on the row (Lever workplaceType,
 * Workday remoteType) is invisible here; the dry run's CSV is reviewed
 * before any --apply for that reason.
 */
export function planWorkModeRepair(row: WorkModeRow): PlannedWorkModeRepair | null {
  const parsed = parseLocation(row.location || '');
  const structuredMode = STRUCTURED_MODE_SOURCE_TYPES.has(row.sourceType || '')
    ? row.mode
    : detectAtsRemoteType(row.description);
  const derived = reconcileWorkMode({
    title: row.title,
    detectedMode: detectMode(`${row.title} ${row.description || ''} ${row.location || ''}`),
    locationIsRemote: parsed.isRemote,
    locationIsHybrid: parsed.isHybrid,
    structuredMode,
  });

  const modeChanged = derived.mode !== row.mode;
  const flagsChanged = derived.isRemote !== row.isRemote || derived.isHybrid !== row.isHybrid;
  if (!modeChanged && !flagsChanged) return null;

  return {
    id: row.id,
    title: row.title,
    employer: row.employer,
    location: row.location || '',
    sourceType: row.sourceType || 'unknown',
    isPublished: row.isPublished,
    oldMode: row.mode,
    newMode: derived.mode,
    oldIsRemote: row.isRemote,
    newIsRemote: derived.isRemote,
    oldIsHybrid: row.isHybrid,
    newIsHybrid: derived.isHybrid,
  };
}

export type WorkModeViolation =
  /** isRemote and isHybrid both true: remote means FULLY remote. */
  | 'both_flags'
  /** A flag disagrees with the stored mode (Remote without isRemote, isHybrid on an In-Person row). */
  | 'flags_disagree_with_mode'
  /** Flagged remote with no remote wording anywhere in the location, title or description. */
  | 'remote_without_evidence';

/**
 * Invariant violations on a stored row, strictest first. These are the
 * checks the skeptic asked to enforce as database CHECK constraints (see
 * scripts/indexing-fixes/sql/work-mode-checks.sql), read in code so they
 * can be reported before the owner adds the constraints.
 */
export function workModeViolations(row: Pick<WorkModeRow, 'title' | 'location' | 'description' | 'mode' | 'isRemote' | 'isHybrid'>): WorkModeViolation[] {
  const out: WorkModeViolation[] = [];
  if (row.isRemote && row.isHybrid) out.push('both_flags');
  const mode = row.mode;
  const disagrees =
    (mode === 'Remote' && (!row.isRemote || row.isHybrid)) ||
    (mode === 'Hybrid' && (!row.isHybrid || row.isRemote)) ||
    (mode === 'In-Person' && (row.isRemote || row.isHybrid)) ||
    (mode !== 'Remote' && row.isRemote) ||
    (mode !== 'Hybrid' && row.isHybrid);
  if (disagrees) out.push('flags_disagree_with_mode');
  if (row.isRemote && !hasRemoteEvidence(`${row.location ?? ''}\n${row.title}\n${row.description ?? ''}`)) {
    out.push('remote_without_evidence');
  }
  return out;
}
