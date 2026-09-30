/**
 * Pure checks behind scripts/indexing-fixes/report-company-slug-changes.ts
 * (indexing audit L-01). Nothing here reads or writes the database.
 *
 * A "shadow" is a company row whose OLD profile slug (its normalizedName in
 * kebab form) is the same string as a live company's NEW display-name slug.
 * Two kinds matter:
 *
 *   1. live over live: another live company used to own the URL, so that old
 *      URL now shows the display-name owner instead of redirecting;
 *   2. dormant over live: a row with no live jobs holds the live company's
 *      canonical URL as its normalizedName. normalizeCompanyName splits
 *      CamelCase, so live "DaVita" is "da-vita" with display slug "davita",
 *      while a dormant variant spelled "Davita" is "davita". Before the
 *      middleware stopped ruling 410 on shape-valid slugs, the company gate
 *      found that dormant row, counted no jobs and answered 410 on the live
 *      profile's canonical URL. These rows are duplicate spellings: merge or
 *      delete them from the admin companies screen.
 */
import { companySlugFor, legacyCompanySlug, type CompanySlugSource } from '@/lib/company-slug';

/** A company row with its live job count. */
export interface LiveSlugCompany extends CompanySlugSource {
    activeJobs: number;
}

/** A live company whose display-name slug another row used to own. */
export interface SlugShadow<T extends CompanySlugSource> {
    /** The live company that now owns the URL. */
    company: LiveSlugCompany;
    /** The row whose old slug is that URL. */
    other: T;
    /** The shared slug. */
    slug: string;
}

/**
 * Group rows by old (legacy) slug. Two rows can share one: "da vita" (space
 * form, written before the normalizer went kebab-case) and "da-vita".
 */
function groupByLegacySlug<T extends CompanySlugSource>(rows: readonly T[]): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
        const slug = legacyCompanySlug(row.normalizedName);
        groups.set(slug, [...(groups.get(slug) ?? []), row]);
    }
    return groups;
}

/** Pair every live company with each row, other than itself, whose old slug is its new slug. */
function pairShadows<T extends CompanySlugSource>(
    live: readonly LiveSlugCompany[],
    others: readonly T[],
): SlugShadow<T>[] {
    const groups = groupByLegacySlug(others);
    return live.flatMap((company) => {
        const slug = companySlugFor(company);
        return (groups.get(slug) ?? [])
            .filter((other) => other.normalizedName !== company.normalizedName)
            .map((other) => ({ company, other, slug }));
    });
}

/** Live companies whose new slug equals another live company's old slug. */
export function findLiveShadows(live: readonly LiveSlugCompany[]): SlugShadow<LiveSlugCompany>[] {
    return pairShadows(live, live);
}

/**
 * The normalizedName values a row would need to hold for its old slug to
 * equal a live company's display-name slug: the slug itself (kebab rows) and
 * its space form (rows written before the normalizer went kebab-case). The
 * report script reads only these rows, so it never scans the whole table.
 */
export function shadowLookupKeys(live: readonly LiveSlugCompany[]): string[] {
    const keys = new Set<string>();
    for (const company of live) {
        const slug = companySlugFor(company);
        keys.add(slug);
        keys.add(slug.replace(/-/g, ' '));
    }
    return [...keys].sort();
}

/**
 * Rows with no live jobs whose old slug equals a live company's display-name
 * slug. A row in `dormant` that is also in `live` is ignored: live-over-live
 * shadows are findLiveShadows' job, and a row never shadows itself.
 */
export function findDormantShadows<T extends CompanySlugSource>(
    live: readonly LiveSlugCompany[],
    dormant: readonly T[],
): SlugShadow<T>[] {
    const liveNames = new Set(live.map((company) => company.normalizedName));
    return pairShadows(
        live,
        dormant.filter((row) => !liveNames.has(row.normalizedName)),
    );
}
