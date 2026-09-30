/**
 * lib/pseo/category-row-match.ts
 *
 * The in-memory twin of categoryPredicate (lib/pseo/category-tagger.ts):
 * whether one already-loaded job row belongs to a category. The category
 * tallies on state hubs, metro guides and salary guides ('Most common
 * categories here', 'Remote has 3') count with it, so a tile can never
 * print a number the category's own page would not list (CQ-05: Kansas
 * read 'Remote has 1' while all three of its jobs were hybrid).
 *
 * The row is evaluated against the very clause the pages query with, by
 * the in-memory Prisma evaluator the /jobs filter counts already use
 * (app/api/jobs/filter-counts/where-evaluator.ts). When the clause reads a
 * column the row does not carry (the description, for the legacy keyword
 * arm of a description rule), the row's stored tag decides instead, which
 * is what the clause's primary arm tests.
 */
import { isMemoryEvaluable, matchesWhere } from '@/app/api/jobs/filter-counts/where-evaluator';
import { categoryPredicate, type CategoryTag } from './category-tagger';
import { isJobTypeCategory } from './category-structural';

/** The columns a row may carry; only categoryTags is required. */
export interface CategoryMatchRow {
  categoryTags: readonly string[] | null;
  title?: string | null;
  jobType?: string | null;
  isRemote?: boolean | null;
  isHybrid?: boolean | null;
  newGradFriendly?: boolean | null;
  minYearsExperience?: number | null;
}

/**
 * Categories whose predicate reads more than the stored tag. For every
 * other category a TAGGED row matches exactly when it carries the tag (the
 * legacy arm needs an empty tag list), so only these, and untagged rows,
 * are evaluated.
 */
export function readsStructuredFields(slug: CategoryTag): boolean {
  return slug === 'remote' || slug === 'telehealth' || slug === 'new-grad' || isJobTypeCategory(slug);
}

const predicateCache = new Map<CategoryTag, Record<string, unknown>>();

function predicateOf(slug: CategoryTag): Record<string, unknown> {
  let clause = predicateCache.get(slug);
  if (!clause) {
    clause = categoryPredicate(slug);
    predicateCache.set(slug, clause);
  }
  return clause;
}

/** The row's present columns (an undefined key is absent; null is a value), with a cache key. */
function presentColumns(row: CategoryMatchRow): { columns: ReadonlySet<string>; key: string } {
  const keys = Object.keys(row).filter((key) => (row as unknown as Record<string, unknown>)[key] !== undefined).sort();
  return { columns: new Set(keys), key: keys.join(',') };
}

const evaluableCache = new Map<string, boolean>();

function matches(slug: CategoryTag, row: CategoryMatchRow, present: { columns: ReadonlySet<string>; key: string }): boolean {
  const tags = row.categoryTags ?? [];
  if (tags.length > 0 && !readsStructuredFields(slug)) return tags.includes(slug);
  const clause = predicateOf(slug);
  const cacheKey = `${slug}|${present.key}`;
  let evaluable = evaluableCache.get(cacheKey);
  if (evaluable === undefined) {
    evaluable = isMemoryEvaluable(clause, present.columns);
    evaluableCache.set(cacheKey, evaluable);
  }
  if (!evaluable) return tags.includes(slug);
  return matchesWhere(clause, { id: '', ...row, categoryTags: [...tags] });
}

/** Whether `row` belongs to `slug` under the category's one predicate. */
export function rowMatchesCategory(slug: CategoryTag, row: CategoryMatchRow): boolean {
  return matches(slug, row, presentColumns(row));
}

/** Every category in `slugs` the row belongs to. */
export function categoriesOfRow(slugs: readonly CategoryTag[], row: CategoryMatchRow): CategoryTag[] {
  const present = presentColumns(row);
  return slugs.filter((slug) => matches(slug, row, present));
}
