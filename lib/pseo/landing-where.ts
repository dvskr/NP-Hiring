/**
 * lib/pseo/landing-where.ts
 *
 * The ONE bucket clause per category landing (`/jobs/{category}`). The
 * shared landing template, the 23 bespoke landing pages (their own listings
 * and their sibling cards) and the aggregate-pseo cron (the stored
 * 'category-landing' verdict the primary sitemap reads) all call
 * landingBucketWhere, so a landing's count, its sibling card elsewhere and
 * its index verdict are one number.
 *
 * One predicate per category (indexing audit CQ-05, CQ-14, fixSoon 11): the
 * bucket is the category's categoryPredicate (lib/pseo/category-tagger.ts),
 * the same clause its /jobs/{category}/{state} and /jobs/{category}/city
 * pages count with (their configs spread it beside the location keys). The
 * legacy CATEGORY_FILTERS title sweeps in lib/filters.ts no longer decide
 * any landing: /jobs/full-time used to count a title keyword ("32
 * openings") while its 25 state pages counted the full-time tag, and
 * /jobs/remote counted isRemote while /jobs/remote/texas counted a
 * description keyword. Now:
 *   - remote is the fully remote work mode (isRemote and not isHybrid);
 *   - telehealth is the telehealth tag on a fully remote job;
 *   - the job types read the structured jobType (title keywords only when
 *     it is blank);
 *   - new grad is the /jobs "Open to new grads" clause;
 *   - every other category is its stored tag.
 * The caller composes the canonical predicate (canonicalBucketWhere), which
 * adds the site-wide exclusions.
 */
import type { Prisma } from '@prisma/client';
import { CANONICAL_CATEGORY_SLUGS, categoryPredicate, type CategoryTag } from './category-tagger';
import { SETTING_CONFIGS } from './setting-state-config';

/**
 * Placeholder location handed to a config's buildWhere so its location keys
 * can be stripped. The value never reaches the database.
 */
const LOCATION_PROBE = 'probe';

/**
 * A location-scoped config clause lifted to the whole category: every
 * SETTING_CONFIGS and ALL_CATEGORY_CONFIGS buildWhere returns its `state`
 * and `city` keys at the top level (pinned by
 * tests/regressions/pseo-index-gate.test.ts), so dropping them leaves the
 * category clause.
 */
export function stripLocationKeys(where: Record<string, unknown>): Prisma.JobWhereInput {
  return Object.fromEntries(
    Object.entries(where).filter(([key]) => key !== 'state' && key !== 'city'),
  ) as Prisma.JobWhereInput;
}

/** The category half of a setting x state config, or null for a slug with no config. */
export function settingCategoryWhere(slug: string): Prisma.JobWhereInput | null {
  const config = SETTING_CONFIGS[slug];
  if (!config) return null;
  return stripLocationKeys(config.buildWhere(LOCATION_PROBE) as Record<string, unknown>);
}

function isCanonicalSlug(slug: string): slug is CategoryTag {
  return (CANONICAL_CATEGORY_SLUGS as readonly string[]).includes(slug);
}

/**
 * The bucket clause for a category landing slug: the published rows of the
 * category's one predicate. Equal, key for key, to the setting x state
 * clause without its state for every slug that has state pages
 * (tests/unit/landing-where.test.ts pins it). A slug outside the taxonomy
 * matches nothing rather than every published job.
 */
export function landingBucketWhere(slug: string): Prisma.JobWhereInput {
  if (!isCanonicalSlug(slug)) return { isPublished: true, id: { in: [] } };
  return { isPublished: true, ...categoryPredicate(slug) } as Prisma.JobWhereInput;
}
