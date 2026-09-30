/**
 * Job.contentChangedAt bookkeeping (indexing audit CS-02 / TECH-04,
 * fixSoon 5).
 *
 * contentChangedAt drives the job sitemap lastmod and the job page's
 * "Last updated" line. It must move only when what a visitor or a search
 * engine reads changes. updatedAt stays the plain write timestamp: every
 * view count, link check, presence check and freshness-decay write moves
 * it, and deindex-expired uses it as its cursor.
 *
 * Writers that edit a posting (ingest create and renewal, employer and admin
 * edits, the location and description rewriters, enrichment) call
 * contentChangeStamp with the stored row and the data they are about to
 * write, and spread the result into their update.
 */

/**
 * Job columns that appear on the job page or in its JobPosting markup.
 * Bookkeeping columns (viewCount, applyClickCount, qualityScore,
 * lastLinkCheckedAt, lastEnrichedAt, healthLastSeenAt, updatedAt) are
 * deliberately absent.
 */
export const RENDERED_JOB_FIELDS = [
  'title',
  'employer',
  'location',
  'description',
  'descriptionSummary',
  'applyLink',
  'applyOnPlatform',
  'jobType',
  'mode',
  'city',
  'state',
  'stateCode',
  'country',
  'isRemote',
  'isHybrid',
  'salaryRange',
  'minSalary',
  'maxSalary',
  'salaryPeriod',
  'displaySalary',
  'normalizedMinSalary',
  'normalizedMaxSalary',
  'salaryIsEstimated',
  'benefits',
  'setting',
  'population',
  'experienceLevel',
  'experienceLabel',
  'minYearsExperience',
  'maxYearsExperience',
  'newGradFriendly',
  'experienceQualifier',
  'expiresAt',
] as const;

export type RenderedJobField = (typeof RENDERED_JOB_FIELDS)[number];

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function toTime(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' || typeof v === 'number') {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (a instanceof Date || b instanceof Date) return toTime(a) === toTime(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    const norm = (x: unknown): string =>
      JSON.stringify(Array.isArray(x) ? [...x].map(String).sort() : []);
    return norm(a) === norm(b);
  }
  return a === b;
}

/**
 * The rendered fields `next` actually changes relative to `prior`. Fields
 * absent from `next`, or set to undefined (Prisma's "leave alone"), are not
 * changes. Null, undefined and '' count as the same empty value.
 */
export function changedRenderedFields(
  prior: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): RenderedJobField[] {
  return RENDERED_JOB_FIELDS.filter(
    (field) => field in next && next[field] !== undefined && !sameValue(prior[field], next[field]),
  );
}

/**
 * `{ contentChangedAt: now }` when the write changes a rendered field or
 * brings an unpublished row back (`revived`), otherwise `{}`. Spread it into
 * the update data.
 */
export function contentChangeStamp(
  prior: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
  options: { revived?: boolean; now?: Date } = {},
): { contentChangedAt?: Date } {
  const changed = changedRenderedFields(prior, next).length > 0;
  return changed || options.revived ? { contentChangedAt: options.now ?? new Date() } : {};
}
