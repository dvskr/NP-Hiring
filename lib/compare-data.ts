/**
 * lib/compare-data.ts — single source of truth for the /compare pages
 * (P5 A2: vs-competitor comparison pages).
 *
 * TRUTH RULES (competitive teardown, Aug 2026):
 *   - Every factual claim about a named competitor in this file was
 *     RE-VERIFIED LIVE against the competitor's own public pages on
 *     COMPARE_REVIEW_DATE (the one review-date constant below). Claims the
 *     review could not confirm that day were dropped — including two from
 *     the original teardown: "Indeed has no NP-specialty facet" (Indeed's
 *     NP search showed a "Specialty" filter on the review date) and the
 *     salary-tail outlier claim (not reproducible on the review date).
 *   - Competitor claims are observational and dated: what a page showed,
 *     what pricing was published, what a facet counted — never
 *     characterizations of intent or quality stated as fact.
 *   - Our-side numbers DERIVE from the registries that render the actual
 *     product (tools registry, taxonomy registry, pricing config, licensure
 *     series), so the comparison pages cannot drift from the real app.
 *     Dormant/flag-gated features are simply not claimed.
 *   - All three pages read this module, so they share one review date and
 *     one claims corpus. tests/regressions/p5-comparison-pages-*.test.ts
 *     enforce the invariants.
 *
 * Competitor names appear in text only (nominative use). No logos.
 */
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { TOOLS } from '@/app/tools/tools-registry';
import { CATEGORY_AXES, ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { SALARY_SPECIALTY_SLUGS } from '@/app/salary-guide/specialty/specialty-config';
import { LICENSE_GUIDE_STATES } from '@/lib/blog-license-guides';
import { STATS_LAST_REVIEWED } from '@/lib/stats-sources';

/**
 * The one review date. Every competitor claim on every /compare page was
 * checked against the competitor's live public pages on this date. Bump it
 * ONLY after actually re-verifying every claim in this file again.
 */
export const COMPARE_REVIEW_DATE = '2026-08-06';
export const COMPARE_REVIEW_DATE_LABEL = 'August 6, 2026';

/** First publication date of the /compare series (Article.datePublished). */
export const COMPARE_PUBLISHED_AT = '2026-08-06';

/**
 * Standard cell text for a capability we looked for but did not find on the
 * pages listed in the profile's `pagesReviewed`. This is a statement about
 * OUR review (scoped by the method footer), never an assertion that the
 * competitor lacks the capability everywhere.
 */
export const NOT_FOUND_IN_REVIEW = 'Not found on the pages we reviewed';

/**
 * Our-side facts, derived from the same registries/config that render the
 * live product. If a registry changes, these pages update with it.
 */
export const OUR_FACTS = {
    /** Flat price per job post after the first free one (USD). */
    postingPriceUsd: config.postingPrice,
    /** Paid-post listing duration in days. */
    postingDurationDays: config.durationDays,
    /** Count of free interactive tools under /tools. */
    toolCount: TOOLS.length,
    /** NP clinical specialty category landing pages. */
    npSpecialtyCategoryCount: CATEGORY_AXES.specialty.length,
    /** APRN cohort category landing pages (beyond NP specialties). */
    aprnCategoryCount: CATEGORY_AXES.aprn.length,
    /** All category landing pages under /jobs/<slug>. */
    categoryPageCount: ALL_CATEGORY_SLUGS.length,
    /** State licensure guides in the live series (50 states + DC). */
    licensureGuideCount: LICENSE_GUIDE_STATES.length,
    /** Specialty salary pages under /salary-guide/specialty. */
    salarySpecialtyPageCount: SALARY_SPECIALTY_SLUGS.length,
    /** Date the consolidated stats literals were last editorially reviewed. */
    statsLastReviewed: STATS_LAST_REVIEWED,
} as const;

/** A competitor fact with the public URL it was verified against. */
export interface VerifiedClaim {
    /** The claim, written observationally; numbers are review-date snapshots. */
    text: string;
    /** The competitor's own public page the claim was checked against. */
    sourceUrl: string;
}

/** One row of the capability table. */
export interface CompareRow {
    dimension: string;
    us: string;
    them: string;
    /** Source URL when the `them` cell states a verified competitor fact. */
    themSourceUrl?: string;
}

export interface CompareGuidance {
    /** Honest reasons to use the competitor. */
    useThem: readonly string[];
    /** Reasons to use us. */
    useUs: readonly string[];
}

export interface CompetitorProfile {
    /** Route slug under /compare. */
    slug: string;
    competitorName: string;
    competitorUrl: string;
    /** H1 of the page. */
    title: string;
    metaTitle: string;
    metaDescription: string;
    /** Opening paragraphs (rendered in order). */
    intro: readonly string[];
    /** "What <competitor> does well" — verified strengths. */
    strengths: readonly VerifiedClaim[];
    /** "Where we differ" — our-side capabilities (repo-derived). */
    differences: readonly { title: string; body: string; href?: string }[];
    /** Capability table. */
    table: readonly CompareRow[];
    guidance: CompareGuidance;
    /** Public competitor pages fetched on COMPARE_REVIEW_DATE. */
    pagesReviewed: readonly { label: string; url: string }[];
}

const OUR_PRICE_CELL = `First post free, then $${OUR_FACTS.postingPriceUsd} flat for ${OUR_FACTS.postingDurationDays} days — published on /pricing`;

const OUR_TOOLS_CELL = `${OUR_FACTS.toolCount} free tools (pay calculators, cost-of-living and licensure planners, specialty finder, employer benchmarks)`;

const OUR_TAXONOMY_CELL = `${OUR_FACTS.categoryPageCount} ${brand.niche.short} category pages — ${OUR_FACTS.npSpecialtyCategoryCount} clinical specialties plus APRN, setting, job-type, and experience axes, with state pages`;

const OUR_SALARY_CELL = `Salary guide with state and specialty pages computed from live postings, a calculator, and a free PDF — every national statistic names its source (last reviewed ${OUR_FACTS.statsLastReviewed})`;

const OUR_LICENSURE_CELL = `${OUR_FACTS.licensureGuideCount}-jurisdiction licensure guide series plus a practice-authority guide, linking to each state board`;

export const COMPETITOR_PROFILES: readonly CompetitorProfile[] = [
    // ── Indeed ──────────────────────────────────────────────────────────────
    {
        slug: 'np-hiring-vs-indeed',
        competitorName: 'Indeed',
        competitorUrl: 'https://www.indeed.com',
        title: `${brand.name} vs Indeed for ${brand.niche.short} jobs`,
        metaTitle: `${brand.name} vs Indeed for ${brand.niche.short} Jobs — An Honest Comparison`,
        metaDescription: `How ${brand.name} compares with Indeed for ${brand.niche.descriptor} job searches and hiring: focus, pricing, salary data, and tools. Every claim dated and checked against Indeed's own pages.`,
        intro: [
            `Indeed is the largest general-purpose job site in the world, and for many ${brand.niche.descriptor}s it is the first place a search starts. ${brand.name} is a small, ${brand.niche.short}-only board. Those are genuinely different products, and this page lays out the differences without pretending the scale gap does not exist.`,
            `Everything stated here about Indeed was checked against Indeed's own public pages on ${COMPARE_REVIEW_DATE_LABEL} — the sources are listed at the bottom, and figures are snapshots from that date.`,
        ],
        strengths: [
            {
                text: `Scale nothing niche can match: Indeed's own about page describes it as the world's #1 job site (Comscore Total Visits, March 2026) and states 665M job seeker profiles and 3.5M+ employers.`,
                sourceUrl: 'https://www.indeed.com/about',
            },
            {
                text: `Salary data with visible provenance: Indeed's ${brand.niche.descriptor} salary page showed an average of $129,948 per year, stated as drawn from "53.4k salaries taken from job postings on Indeed in the past 36 months (updated August 2, 2026)". Publishing the sample size and refresh date on the page is a practice we respect and follow ourselves.`,
                sourceUrl: 'https://www.indeed.com/career/nurse-practitioner/salaries',
            },
            {
                text: `An employer-review corpus with "Work Wellbeing" scores — for example, one large health system's Indeed page showed 3,500+ employee reviews and a published wellbeing score on the review date. We do not host employer reviews at all, so for review research Indeed is simply the tool.`,
                sourceUrl: 'https://www.indeed.com/cmp/Mayo-Clinic/reviews',
            },
            {
                text: `Hiring Lab, a labor-market research arm with named, bylined researchers — a level of research investment no ${brand.niche.short}-specific board makes.`,
                sourceUrl: 'https://www.hiringlab.org/',
            },
            {
                text: `Real search filters on ${brand.niche.descriptor} queries: on the review date, Indeed's ${brand.niche.short} search showed Pay, Job type, License, Work setting, and a Specialty filter.`,
                sourceUrl: 'https://www.indeed.com/jobs?q=nurse+practitioner',
            },
        ],
        differences: [
            {
                title: `${brand.niche.short}-only, end to end`,
                body: `Every listing, category page, salary page, and tool here exists for the ${brand.niche.descriptor} and APRN market: ${OUR_FACTS.categoryPageCount} category landing pages, including ${OUR_FACTS.npSpecialtyCategoryCount} clinical specialty categories with per-state pages. On a generalist site, ${brand.niche.short} roles share infrastructure with every other occupation.`,
                href: '/jobs',
            },
            {
                title: 'Flat, published employer pricing',
                body: `Our pricing is one number on a public page: first post free, then $${OUR_FACTS.postingPriceUsd} flat for a ${OUR_FACTS.postingDurationDays}-day listing. Indeed's model is different by design — its pricing page states there is no flat upfront fee and sponsorship is results-based (per click or per started application, with budgets), alongside a monthly free-post allowance. Neither model is wrong; ours is simpler to budget for a single ${brand.niche.short} hire.`,
                href: '/pricing',
            },
            {
                title: `${OUR_FACTS.toolCount} free ${brand.niche.short}-specific tools`,
                body: `Contract-vs-salary math, cost-of-living comparison, a licensure and multi-state planner, a specialty finder, an employer salary benchmark, and more — built for ${brand.niche.short} decisions specifically, free, and ungated.`,
                href: '/tools',
            },
            {
                title: 'Licensure and practice-authority coverage',
                body: `A ${OUR_FACTS.licensureGuideCount}-jurisdiction licensure guide series and a full practice-authority guide, each linking to the actual state board rather than asserting fees and processing times as fact.`,
                href: '/resources/fpa-guide',
            },
            {
                title: 'Salary product with a citation regime',
                body: `State and specialty salary pages computed from live postings, a calculator, and a free downloadable guide. Every national statistic we publish names its source and vintage on the page (last editorial review: ${OUR_FACTS.statsLastReviewed}).`,
                href: '/salary-guide',
            },
        ],
        table: [
            {
                dimension: 'Focus',
                us: `${brand.niche.short}/APRN roles only`,
                them: 'All occupations, all industries, 60+ countries',
                themSourceUrl: 'https://www.indeed.com/about',
            },
            {
                dimension: 'Scale',
                us: 'Deliberately niche — one clinical profession',
                them: '665M job seeker profiles; 3.5M+ employers (self-reported)',
                themSourceUrl: 'https://www.indeed.com/about',
            },
            {
                dimension: 'Employer pricing',
                us: OUR_PRICE_CELL,
                them: 'No flat per-post fee; results-based sponsorship (per click / per started application) plus a monthly free-post allowance',
                themSourceUrl: 'https://www.indeed.com/hire/resources/howtohub/how-pricing-works-on-indeed',
            },
            {
                dimension: 'Salary data',
                us: OUR_SALARY_CELL,
                them: `${brand.niche.short} salary pages with stated sample size and refresh date`,
                themSourceUrl: 'https://www.indeed.com/career/nurse-practitioner/salaries',
            },
            {
                dimension: 'Employer reviews',
                us: 'None — we deliberately do not host reviews',
                them: 'Large review corpus with Work Wellbeing scores',
                themSourceUrl: 'https://www.indeed.com/companies',
            },
            {
                dimension: `${brand.niche.short} career tools`,
                us: OUR_TOOLS_CELL,
                them: NOT_FOUND_IN_REVIEW,
            },
            {
                dimension: 'Licensure guidance',
                us: OUR_LICENSURE_CELL,
                them: NOT_FOUND_IN_REVIEW,
            },
        ],
        guidance: {
            useThem: [
                `You want maximum listing volume and every employer in one place — no niche board matches Indeed's inventory.`,
                'You want to research employers through reviews and wellbeing scores before applying.',
                'You are hiring for many role types beyond advanced practice and want one pipeline.',
            ],
            useUs: [
                `You want only ${brand.niche.descriptor} roles, faceted by clinical specialty, practice setting, and state — with licensure and pay context on the same site.`,
                `You are an employer hiring one or a few ${brand.niche.short}s and prefer a flat published price over managing a bid budget.`,
                `You want ${brand.niche.short}-specific salary, licensure, and contract tools next to the search itself.`,
            ],
        },
        pagesReviewed: [
            { label: 'Indeed — About', url: 'https://www.indeed.com/about' },
            { label: `Indeed — ${brand.niche.descriptor} salaries`, url: 'https://www.indeed.com/career/nurse-practitioner/salaries' },
            { label: `Indeed — ${brand.niche.descriptor} job search`, url: 'https://www.indeed.com/jobs?q=nurse+practitioner' },
            { label: 'Indeed — How pricing works (employer resource)', url: 'https://www.indeed.com/hire/resources/howtohub/how-pricing-works-on-indeed' },
            { label: 'Indeed — company reviews (example page)', url: 'https://www.indeed.com/cmp/Mayo-Clinic/reviews' },
            { label: 'Indeed Hiring Lab', url: 'https://www.hiringlab.org/' },
        ],
    },

    // ── AANP JobCenter ──────────────────────────────────────────────────────
    {
        slug: 'np-hiring-vs-aanp-jobcenter',
        competitorName: 'AANP JobCenter',
        competitorUrl: 'https://jobcenter.aanp.org',
        title: `${brand.name} vs the AANP JobCenter`,
        metaTitle: `${brand.name} vs AANP JobCenter — An Honest Comparison`,
        metaDescription: `How ${brand.name} compares with the AANP JobCenter for ${brand.niche.descriptor}s and employers: access model, pricing, salary resources, and tools. Claims dated and checked against AANP's own pages.`,
        intro: [
            `The AANP JobCenter is the career board of the American Association of Nurse Practitioners — the profession's largest membership organization. That official standing is real and we do not compete with it: if you want the association itself (advocacy, CE, conferences, community), that is AANP, full stop.`,
            `This page compares the two job boards as job boards: how listings are accessed, what employers pay, and what career resources sit around the search. Everything stated about the AANP JobCenter was checked against its own public pages on ${COMPARE_REVIEW_DATE_LABEL}; figures are snapshots from that date.`,
        ],
        strengths: [
            {
                text: `Official association standing: the JobCenter describes itself as containing one of the largest sources of ${brand.niche.descriptor} jobs in the nation, "with access to more than 118k+ AANP members."`,
                sourceUrl: 'https://jobcenter.aanp.org/',
            },
            {
                text: `Real inventory: the job search showed 3,896 results on the review date.`,
                sourceUrl: 'https://jobcenter.aanp.org/jobs/',
            },
            {
                text: `A concrete membership perk: "AANP members receive an exclusive 2 day preview to new jobs" (the JobCenter's own wording). If you are already an AANP member, that head start is a genuine benefit.`,
                sourceUrl: 'https://jobcenter.aanp.org/',
            },
            {
                text: `Published, public employer pricing — no contact-sales wall: a single 30-day posting at $399, packages at $599 / $949 / $1,099, network distribution at $749, single resume purchase at $49, and 30-day unlimited resume access at $699 were all listed openly on the review date. The $599 package included placement in a monthly email described as reaching 90,000+ ${brand.niche.descriptor}s.`,
                sourceUrl: 'https://jobcenter.aanp.org/employer/pricing/',
            },
        ],
        differences: [
            {
                title: 'No membership tiers on listings',
                body: `Every listing here is visible to everyone the moment it publishes. The JobCenter is open to non-members too, but its own copy offers members an exclusive two-day preview of new jobs — reasonable for a membership organization, just a different model than ours.`,
                href: '/jobs',
            },
            {
                title: 'Employer price and duration',
                body: `First post free, then $${OUR_FACTS.postingPriceUsd} flat for ${OUR_FACTS.postingDurationDays} days here, versus $399 for a single 30-day posting there (their published price on the review date). Both prices are public — compare them directly for your hiring volume.`,
                href: '/pricing',
            },
            {
                title: 'Salary product',
                body: `We publish a ${brand.niche.short} salary guide with state and specialty pages computed from live postings, a calculator, an employer benchmark, and a free PDF — with named sources on every national statistic. We did not find a comparable salary data product on the JobCenter pages we reviewed.`,
                href: '/salary-guide',
            },
            {
                title: `Interactive ${brand.niche.short} tools`,
                body: `${OUR_FACTS.toolCount} free tools — contract-vs-salary math, cost-of-living comparison, licensure and multi-state planning, specialty matching, employer benchmarks — sit next to the job search.`,
                href: '/tools',
            },
            {
                title: 'Licensure and practice-authority editorial',
                body: `A ${OUR_FACTS.licensureGuideCount}-jurisdiction licensure series and a practice-authority guide, maintained with a no-stale-numbers rule: anything we cannot verify links to the state board instead of being asserted.`,
                href: '/resources/fpa-guide',
            },
        ],
        table: [
            {
                dimension: 'Operator',
                us: `Independent ${brand.niche.short}-only job board`,
                them: 'Career board of AANP, the professional association',
                themSourceUrl: 'https://jobcenter.aanp.org/',
            },
            {
                dimension: 'Listing access',
                us: 'All listings public immediately',
                them: 'Open to all; members get an exclusive 2-day preview of new jobs',
                themSourceUrl: 'https://jobcenter.aanp.org/',
            },
            {
                dimension: 'Inventory (snapshot)',
                us: 'Live counts shown per category on our browse pages',
                them: `3,896 job results on ${COMPARE_REVIEW_DATE_LABEL}`,
                themSourceUrl: 'https://jobcenter.aanp.org/jobs/',
            },
            {
                dimension: 'Employer pricing',
                us: OUR_PRICE_CELL,
                them: '$399 single 30-day post; packages $599–$1,099; resume access $49 single / $699 for 30-day unlimited — published publicly',
                themSourceUrl: 'https://jobcenter.aanp.org/employer/pricing/',
            },
            {
                dimension: 'Salary data',
                us: OUR_SALARY_CELL,
                them: NOT_FOUND_IN_REVIEW,
            },
            {
                dimension: `${brand.niche.short} career tools`,
                us: OUR_TOOLS_CELL,
                them: NOT_FOUND_IN_REVIEW,
            },
            {
                dimension: 'Association benefits (CE, advocacy, conferences)',
                us: 'None — we are not a membership organization',
                them: 'The core of what AANP is; the JobCenter is one member benefit among many',
                themSourceUrl: 'https://jobcenter.aanp.org/',
            },
        ],
        guidance: {
            useThem: [
                'You are (or want to be) an AANP member and value the early-preview window plus the association ecosystem around the board.',
                'You want a large single-source board operated under the profession’s official association brand.',
                'You are an employer who specifically wants distribution to AANP’s membership channels.',
            ],
            useUs: [
                `You want specialty-, setting-, and state-faceted ${brand.niche.short} search with salary and licensure context on the same site, no membership involved.`,
                `You are an employer comparing published prices: $${OUR_FACTS.postingPriceUsd} flat for ${OUR_FACTS.postingDurationDays} days here versus $399 for 30 days there (both public, as of ${COMPARE_REVIEW_DATE_LABEL}).`,
                `You want free ${brand.niche.short} tools — contract math, relocation, licensure planning — not just listings.`,
            ],
        },
        pagesReviewed: [
            { label: 'AANP JobCenter — home', url: 'https://jobcenter.aanp.org/' },
            { label: 'AANP JobCenter — job search', url: 'https://jobcenter.aanp.org/jobs/' },
            { label: 'AANP JobCenter — employer pricing', url: 'https://jobcenter.aanp.org/employer/pricing/' },
        ],
    },

    // ── ENP Network ─────────────────────────────────────────────────────────
    {
        slug: 'np-hiring-vs-enp-network',
        competitorName: 'ENP Network',
        competitorUrl: 'https://www.enpnetwork.com',
        title: `${brand.name} vs ENP Network`,
        metaTitle: `${brand.name} vs ENP Network — An Honest Comparison`,
        metaDescription: `How ${brand.name} compares with ENP Network for ${brand.niche.descriptor}s and employers: association network, events, preceptors, CE, pay transparency, pricing, and tools. Claims dated and source-checked.`,
        intro: [
            `ENP Network is the infrastructure player of the ${brand.niche.short} world: it hosts association communities, an events calendar, a preceptor marketplace, and a CE directory alongside its job board. Much of that we simply do not offer, and this page says so plainly.`,
            `Where the two differ most is the job-search product itself — pay transparency, salary data, tools, and pricing. Everything stated about ENP Network was checked against its own public pages on ${COMPARE_REVIEW_DATE_LABEL}; figures are snapshots from that date.`,
        ],
        strengths: [
            {
                text: `A real association network: ENP's homepage counted 267 ${brand.niche.descriptor} associations and described a membership of 319,842 active members on the review date. Distribution inside the profession's own associations is a moat no independent board has.`,
                sourceUrl: 'https://www.enpnetwork.com/',
            },
            {
                text: `An events calendar with 478 ${brand.niche.descriptor} events listed on the review date — we have no events product at all.`,
                sourceUrl: 'https://www.enpnetwork.com/nurse-practitioner-events',
            },
            {
                text: `A preceptor marketplace listing 2,202 preceptors on the review date. If you are a student or program looking for a preceptor, ENP has an actual product there; we publish guidance only.`,
                sourceUrl: 'https://www.enpnetwork.com/nurse-practitioner-preceptors',
            },
            {
                text: `An on-demand CE directory with 266 activities on the review date (255 listed as offering credit), faceted by credit type — another product category we do not offer.`,
                sourceUrl: 'https://www.enpnetwork.com/on-demand-ce-for-nurse-practitioners',
            },
            {
                text: `Fully itemized public employer pricing: job postings starting at $389, posting packages up to $5,245, and resume-access passes from $195 to $1,850 were all published openly on the review date — the same no-contact-sales transparency we practice.`,
                sourceUrl: 'https://www.enpnetwork.com/nurse-practitioner-jobs/for-employers',
            },
            {
                text: `A Direct Hire vs Staffing facet on job search — 3,028 direct-hire versus 783 staffing listings on the review date. Surfacing that split is genuinely useful and rare.`,
                sourceUrl: 'https://www.enpnetwork.com/nurse-practitioner-jobs',
            },
        ],
        differences: [
            {
                title: 'Pay visibility on listings',
                body: `On the review date, ENP's own Annual Pay search facet counted 3,567 listings as pay "Not provided" out of roughly 3,800 total — about 94%. We are not perfect either: we show pay when the posting supplies it and do not yet require it. But we surround listings with state-level pay computed from live data, salary badges where data exists, and a salary guide that names its sources.`,
                href: '/salary-guide',
            },
            {
                title: 'Salary product',
                body: `State and specialty salary pages computed from live postings, a calculator, an employer benchmark, and a free ungated PDF. We did not find a comparable salary data product on the ENP pages we reviewed.`,
                href: '/salary-guide',
            },
            {
                title: `${OUR_FACTS.toolCount} free interactive tools`,
                body: `Contract-vs-salary math, cost-of-living comparison, a licensure and multi-state planner, a specialty finder, and employer benchmarks — all free and ungated, next to the search.`,
                href: '/tools',
            },
            {
                title: 'Licensure editorial',
                body: `A ${OUR_FACTS.licensureGuideCount}-jurisdiction licensure guide series plus a practice-authority guide with board deep-links — editorial infrastructure we invest in heavily.`,
                href: '/resources/fpa-guide',
            },
            {
                title: 'Employer price point',
                body: `Both boards publish employer pricing openly — credit where due. The numbers differ: first post free then $${OUR_FACTS.postingPriceUsd} flat for ${OUR_FACTS.postingDurationDays} days here, versus postings starting at $389 there (their published price on the review date).`,
                href: '/pricing',
            },
        ],
        table: [
            {
                dimension: 'What it is',
                us: `${brand.niche.short}-only job board with salary + licensure editorial and tools`,
                them: `Professional network: associations, events, preceptors, CE, and a job board`,
                themSourceUrl: 'https://www.enpnetwork.com/',
            },
            {
                dimension: 'Association network',
                us: 'None',
                them: `267 associations; 319,842 active members (site's own counts)`,
                themSourceUrl: 'https://www.enpnetwork.com/',
            },
            {
                dimension: 'Events / preceptors / CE',
                us: 'None — guidance content only',
                them: '478 events; 2,202 preceptors; an on-demand CE directory (homepage counts, snapshots)',
                themSourceUrl: 'https://www.enpnetwork.com/',
            },
            {
                dimension: 'Pay shown on listings',
                us: 'Shown when the posting supplies it, plus state-level aggregates from live data',
                them: `Own search facet counted 3,567 of ~3,800 listings as pay "Not provided" (~94%) on ${COMPARE_REVIEW_DATE_LABEL}`,
                themSourceUrl: 'https://www.enpnetwork.com/nurse-practitioner-jobs',
            },
            {
                dimension: 'Salary data product',
                us: OUR_SALARY_CELL,
                them: NOT_FOUND_IN_REVIEW,
            },
            {
                dimension: `${brand.niche.short} career tools`,
                us: OUR_TOOLS_CELL,
                them: NOT_FOUND_IN_REVIEW,
            },
            {
                dimension: 'Employer pricing',
                us: OUR_PRICE_CELL,
                them: 'Postings from $389; packages to $5,245; resume passes $195–$1,850 — fully published',
                themSourceUrl: 'https://www.enpnetwork.com/nurse-practitioner-jobs/for-employers',
            },
        ],
        guidance: {
            useThem: [
                'You want your professional association’s community, bulletins, and events in one network.',
                'You need a preceptor or on-demand CE — ENP has real products in both categories.',
                'You are an employer who wants distribution across association sites and a resume database with published pass pricing.',
            ],
            useUs: [
                `You are searching by clinical specialty, setting, or state and want pay and licensure context around every step.`,
                `Pay matters to your search: we publish state-level pay from live data and a sourced salary guide rather than listings alone.`,
                `You are an employer hiring a ${brand.niche.short} and comparing published prices: first post free, then $${OUR_FACTS.postingPriceUsd} flat for ${OUR_FACTS.postingDurationDays} days.`,
            ],
        },
        pagesReviewed: [
            { label: 'ENP Network — home', url: 'https://www.enpnetwork.com/' },
            { label: 'ENP Network — job search', url: 'https://www.enpnetwork.com/nurse-practitioner-jobs' },
            { label: 'ENP Network — for employers (pricing)', url: 'https://www.enpnetwork.com/nurse-practitioner-jobs/for-employers' },
            { label: 'ENP Network — events', url: 'https://www.enpnetwork.com/nurse-practitioner-events' },
            { label: 'ENP Network — preceptors', url: 'https://www.enpnetwork.com/nurse-practitioner-preceptors' },
            { label: 'ENP Network — on-demand CE', url: 'https://www.enpnetwork.com/on-demand-ce-for-nurse-practitioners' },
        ],
    },
] as const;

/** Hub route. */
export const COMPARE_HUB_PATH = '/compare';

/** All comparison-page paths (for the hub, tests, and sitemap reporting). */
export const COMPARE_PAGE_PATHS: readonly string[] = COMPETITOR_PROFILES.map(
    (p) => `${COMPARE_HUB_PATH}/${p.slug}`,
);

/** Lookup by route slug — undefined for anything not configured. */
export function getCompetitorProfile(slug: string): CompetitorProfile | undefined {
    return COMPETITOR_PROFILES.find((p) => p.slug === slug);
}
