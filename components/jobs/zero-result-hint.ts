import type { ZeroResultSearchHint } from '@/lib/search-query-intent';

export type { ZeroResultSearchHint };

/**
 * Pull a well-formed zero-result hint out of an /api/jobs `search` field.
 * Anything malformed yields null so the empty state never renders a
 * fabricated or NaN count.
 */
export function readZeroResultHint(search: unknown): ZeroResultSearchHint | null {
  if (typeof search !== 'object' || search === null) return null;
  const hint = (search as { zeroResultHint?: unknown }).zeroResultHint;
  if (typeof hint !== 'object' || hint === null) return null;
  const { removedConstraint, removedLabel, availableCount } = hint as Record<string, unknown>;
  if (removedConstraint !== 'workMode' && removedConstraint !== 'state' && removedConstraint !== 'text') return null;
  if (typeof removedLabel !== 'string' || removedLabel.trim() === '') return null;
  if (typeof availableCount !== 'number' || !Number.isInteger(availableCount) || availableCount <= 0) return null;
  return { removedConstraint, removedLabel, availableCount };
}

/**
 * Empty-state sentence naming the constraint that emptied the search, e.g.
 * 'Removing text "zzqxv" from your search shows 12 jobs.' Copy rule: no
 * dashes, plain professional English.
 */
export function formatZeroResultHint(hint: ZeroResultSearchHint): string {
  const jobsWord = hint.availableCount === 1 ? 'job' : 'jobs';
  return `Removing ${hint.removedLabel} from your search shows ${hint.availableCount.toLocaleString('en-US')} ${jobsWord}.`;
}
