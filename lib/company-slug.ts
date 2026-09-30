/**
 * Public URL slug for a company profile: `/companies/{slug}`.
 *
 * WHY THIS EXISTS (indexing audit L-01, CQ-16). Profile URLs used to be the
 * ingest dedup key, `Company.normalizedName`, with spaces turned into hyphens.
 * That key is built to MERGE spellings, not to read well: it splits CamelCase
 * ("LifeStance" to "life stance", "DaVita" to "da vita") and strips industry
 * words ("One Medical" to "one", "Denver Health" to "denver", "Medical
 * University of South Carolina" to "university of south carolina"). The
 * result was /companies/one, /companies/next, /companies/da-vita and a URL
 * that reads as a different university. The public slug now comes from the
 * display name (`Company.name`, which is unique), so the URL says who the
 * employer is: /companies/one-medical, /companies/davita.
 *
 * The dedup key is untouched: ingest still clusters on normalizedName, and
 * the old slug form still resolves (app/companies/[slug]/page.tsx answers it
 * with a permanent redirect to the display-name slug).
 *
 * This module is pure and import-free so the edge middleware, the sitemap,
 * the pSEO templates and the page resolver can all share it. Every link
 * builder must go through `companyProfilePath`; a hand-built
 * `/companies/${...}` drifts from the resolver the moment either changes.
 */

/**
 * Trailing legal-form tokens dropped from the slug ("Acme Health, LLC" reads
 * as acme-health). Only unambiguous corporate forms: "PA" and "PC" are left
 * alone because "PA" is also a state code and a clinician title.
 */
const LEGAL_FORM_TOKENS: ReadonlySet<string> = new Set([
    'inc',
    'incorporated',
    'llc',
    'pllc',
    'llp',
    'ltd',
    'corp',
    'corporation',
]);

/** Combining marks left behind by NFKD ("Clínica" to "Cli" + U+0301 + "nica"). */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Characters dropped without leaving a word break (St. Luke's to st lukes). */
const SILENT_PUNCTUATION = /['‘’`.]/g;

/** An ampersand joining two letters is part of a name (A&M, AT&T). */
const INNER_AMPERSAND = /([a-z0-9])&(?=[a-z0-9])/g;

/** The shape every slug this module emits has: kebab-case ASCII words. */
const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Kebab-case slug from a company's display name. Returns '' when the name has
 * no Latin letters or digits at all; callers use `companySlugFor`, which then
 * falls back to the legacy key so a profile never loses its URL.
 *
 *   "One Medical"                          -> one-medical
 *   "LifeStance Health"                    -> lifestance-health
 *   "Saint Luke's Health System"           -> saint-lukes-health-system
 *   "NY Psychotherapy & Counseling"        -> ny-psychotherapy-and-counseling
 *   "Texas A&M Health"                     -> texas-am-health
 *   "Clínica Sierra Vista, Inc."           -> clinica-sierra-vista
 */
export function companyProfileSlug(name: string): string {
    const tokens = name
        .normalize('NFKD')
        .replace(COMBINING_MARKS, '')
        .toLowerCase()
        .replace(SILENT_PUNCTUATION, '')
        .replace(INNER_AMPERSAND, '$1')
        .replace(/&/g, ' and ')
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
    while (tokens.length > 1 && LEGAL_FORM_TOKENS.has(tokens[tokens.length - 1])) {
        tokens.pop();
    }
    return tokens.join('-');
}

/**
 * The slug the profile route used before display-name slugs: the dedup key
 * with each space turned into a hyphen (rows written before the normalizer
 * went kebab-case still hold the space form).
 */
export function legacyCompanySlug(normalizedName: string): string {
    return normalizedName.trim().replace(/\s+/g, '-');
}

/** The two columns every company slug derives from. */
export interface CompanySlugSource {
    name: string;
    normalizedName: string;
}

/** The canonical public slug for a company row. */
export function companySlugFor(company: CompanySlugSource): string {
    return companyProfileSlug(company.name) || legacyCompanySlug(company.normalizedName);
}

/** `/companies/{slug}`, the only way a company profile link should be built. */
export function companyProfilePath(company: CompanySlugSource): string {
    return `/companies/${companySlugFor(company)}`;
}

/**
 * True when a path segment has the shape this module emits. The edge
 * middleware uses it to tell a slug that may be a live display-name slug
 * from structurally invalid input such as a percent-encoded space form.
 *
 * For a slug of this shape, normalizedName evidence proves nothing either
 * way, so the middleware must never answer 410 on it and must leave the
 * verdict to the page (which 404s a slug no live company owns):
 *   - a miss is expected: most display-name slugs ("one-medical") match no
 *     normalizedName row at all;
 *   - a hit on a row with no live jobs can still be a live company's
 *     canonical URL. normalizeCompanyName splits CamelCase, so live "DaVita"
 *     has normalizedName "da-vita" and display slug "davita", while a
 *     dormant variant row spelled "Davita" has normalizedName "davita".
 * Only a slug that fails this shape can never be a display-name slug.
 */
export function isCompanyProfileSlugShape(slug: string): boolean {
    return SLUG_SHAPE.test(slug);
}

/** A company row plus the live job count used to break slug ties. */
export interface CompanySlugCandidate extends CompanySlugSource {
    activeJobs: number;
}

/**
 * The company a display-name slug belongs to, among the given candidates.
 *
 * Two distinct rows can only share a display-name slug when their names
 * differ by case or punctuation alone ("MultiCare" and "Multicare"), which
 * the dedup key keeps apart because it splits CamelCase. Those are the same
 * employer spelled two ways, so the tie goes to the row with more live jobs
 * (the fuller profile), then to the name that sorts first by code unit (a
 * plain comparison, so the winner never depends on the server locale), so
 * every render agrees on one winner.
 */
export function pickCompanyForSlug<T extends CompanySlugCandidate>(
    slug: string,
    candidates: readonly T[],
): T | null {
    let winner: T | null = null;
    for (const candidate of candidates) {
        if (companySlugFor(candidate) !== slug) continue;
        if (
            winner === null ||
            candidate.activeJobs > winner.activeJobs ||
            (candidate.activeJobs === winner.activeJobs && candidate.name < winner.name)
        ) {
            winner = candidate;
        }
    }
    return winner;
}
