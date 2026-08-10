/**
 * Report editions — one config object per issue of each /reports surface
 * (P5 A7/A8), designed for annual re-issue.
 *
 * Next year's State of Hiring is a NEW entry in STATE_OF_HIRING_EDITIONS
 * plus a matching app/reports/<slug>/ folder — never an in-place rewrite
 * of an existing edition, because published editions get cited and a cited
 * page that silently becomes a different year's data breaks the citation.
 *
 * The /reports hub and the pages' metadata/JSON-LD all derive from these
 * objects, so the hub can never advertise an edition that has no config.
 * tests/regressions/p5-market-reports-model.test.ts pins that every
 * edition's path has a physical route folder.
 *
 * FORK NOTE: edition slugs carry the board's niche token (like the
 * app/jobs/<slug>/ category folders) — a fork defines its own slugs here
 * AND creates the matching folders.
 */
import { brand } from '@/config/brand';

/** Route of the reports hub page. */
export const REPORTS_HUB_PATH = '/reports';

export interface ReportEdition {
    /** Edition year, e.g. 2026. */
    year: number;
    /** URL slug under /reports/, matching a physical route folder. */
    slug: string;
    /** Absolute path of the edition page. */
    path: string;
    /** Human title used in the hub card, metadata, and Article schema. */
    title: string;
    /** One-sentence description for the hub card and meta description. */
    description: string;
    /** ISO date the edition was first published (Article.datePublished). */
    datePublished: string;
}

const STATE_OF_HIRING_2026: ReportEdition = {
    year: 2026,
    slug: 'state-of-np-hiring-2026',
    path: '/reports/state-of-np-hiring-2026',
    title: `The State of ${brand.niche.short} Hiring 2026`,
    description:
        `What active ${brand.niche.descriptor} job postings on ${brand.name} show about ` +
        `specialty demand, geography, work mode, and advertised pay — with the sample ` +
        `limits stated, and national context cited to its sources.`,
    datePublished: '2026-08-06',
};

/** Every issued State of Hiring edition, oldest first. */
export const STATE_OF_HIRING_EDITIONS: readonly ReportEdition[] = [STATE_OF_HIRING_2026];

/** The newest issued edition — what the hub features. */
export const CURRENT_STATE_OF_HIRING_EDITION: ReportEdition =
    STATE_OF_HIRING_EDITIONS[STATE_OF_HIRING_EDITIONS.length - 1];

/**
 * The pay-transparency report is a standing (continuously refreshed)
 * surface rather than an annual edition, but it shares the config shape so
 * the hub renders both from one array.
 */
export const PAY_TRANSPARENCY_REPORT: ReportEdition = {
    year: 2026,
    slug: 'pay-transparency',
    path: '/reports/pay-transparency',
    title: `${brand.niche.short} Job Pay Transparency: Our Numbers, Live`,
    description:
        `The share of active postings on ${brand.name} that disclose a real pay range, ` +
        `computed live from the database — plus how we label estimates, and dated ` +
        `observations on how other boards handle pay disclosure.`,
    datePublished: '2026-08-06',
};

/** Everything the /reports hub lists, in display order. */
export const ALL_REPORTS: readonly ReportEdition[] = [
    CURRENT_STATE_OF_HIRING_EDITION,
    PAY_TRANSPARENCY_REPORT,
];
