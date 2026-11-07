/**
 * The NP guides store catalog: six PDF guides, three bundles and one
 * checkout add-on. Every price the store shows or charges comes from here;
 * the checkout route resolves a product slug against this file and never
 * takes an amount from the request. The prices apply from the end of the
 * launch promotion (config.promoEndsAt); until then every product is free
 * to claim (lib/guides/phase.ts).
 *
 * Files live in the private Supabase Storage bucket GUIDES_BUCKET under
 * `<slug>.pdf` (scripts/guides/upload-guides.ts puts them there). Replacing a
 * file there is how a reader gets an updated edition: downloads always serve
 * the current object.
 */

export const GUIDE_SLUGS = [
    'compensation-report',
    'first-year-playbook',
    'interview-prep-pack',
    'negotiate-like-an-np',
    'telehealth-playbook',
    'launch-your-practice',
] as const;

export type GuideSlug = (typeof GUIDE_SLUGS)[number];

export interface Guide {
    readonly kind: 'guide';
    readonly slug: GuideSlug;
    readonly title: string;
    readonly subtitle: string;
    readonly priceCents: number;
    readonly pages: number;
    /** The PDF's file name in the repo's ignored "NP Guides" folder, and the name readers download it under. */
    readonly sourceFile: string;
    readonly audience: string;
    readonly summary: string;
    readonly contents: readonly string[];
}

export interface Bundle {
    readonly kind: 'bundle';
    readonly slug: BundleSlug;
    readonly title: string;
    readonly subtitle: string;
    readonly priceCents: number;
    readonly guides: readonly GuideSlug[];
    readonly audience: string;
    readonly summary: string;
    /** The bundle the store points people to. */
    readonly bestValue?: boolean;
}

export type BundleSlug = 'career-bundle' | 'practice-owner-bundle' | 'complete-library';
export type Product = Guide | Bundle;
export type ProductSlug = GuideSlug | BundleSlug;

export const GUIDES_BUCKET = 'guides';

export const GUIDES: Readonly<Record<GuideSlug, Guide>> = {
    'compensation-report': {
        kind: 'guide',
        slug: 'compensation-report',
        title: '2026 NP Compensation Report',
        subtitle: 'What nurse practitioners earn by state, specialty, setting and pay model',
        priceCents: 900,
        pages: 30,
        sourceFile: 'nphiring-2026-np-compensation-report.pdf',
        audience: 'Any NP or student who wants the market numbers before a job search, a raise or a rate decision.',
        summary: 'NP pay from BLS, AANP and live postings, with a state by state table for all 50 states and DC, specialty and setting pay, W-2 vs. 1099 math and a negotiation method built on the data.',
        contents: [
            'Methodology and source hierarchy',
            'National pay distribution',
            'State by state pay table (50 states and DC)',
            'Specialty and setting',
            'Telehealth vs. in-person pay',
            'W-2 vs. 1099 pay',
            'RVU and productivity pay',
            'New graduate vs. experienced pay',
            'Job outlook and five market risks',
            'How to use this data in negotiation',
            'Sources and update log',
        ],
    },
    'first-year-playbook': {
        kind: 'guide',
        slug: 'first-year-playbook',
        title: 'First-Year NP Playbook',
        subtitle: 'From boards to your first contract in any specialty',
        priceCents: 1900,
        pages: 33,
        sourceFile: 'nphiring-first-year-np-playbook.pdf',
        audience: 'Final-semester NP students, new graduates waiting on boards, and NPs in their first year of practice, in every population focus.',
        summary: 'The order of operations from graduation to your first prescription, the right board exam, the job filters and the checklists to get through year one with every hour counted.',
        contents: [
            'Graduation to license in the right order',
            'Choosing and passing your board exam',
            'Practice authority, transition hours and a five-year plan',
            'Green flags and red flags in your first job search',
            'Collaborative agreements',
            'Your first 90 days clinically',
            'Your credential stack and CE plan',
            'Your first-year pay and what new grads earn',
            'The year-one checklist',
        ],
    },
    'interview-prep-pack': {
        kind: 'guide',
        slug: 'interview-prep-pack',
        title: 'NP Interview Prep Pack',
        subtitle: 'Primary care, urgent care, acute care and telehealth questions with model answers',
        priceCents: 1900,
        pages: 37,
        sourceFile: 'nphiring-np-interview-prep-pack.pdf',
        audience: 'New-grad and experienced NPs interviewing for primary care, urgent care, acute care, pediatric, women\'s health and telehealth roles.',
        summary: 'Twelve clinical scenarios with full model answers across five NP specialties, twelve behavioral questions with a STAR worksheet, and a seven-day mock interview plan.',
        contents: [
            'How NP interviews are structured',
            'Behavioral questions and the STAR worksheet',
            'Clinical scenarios with model answers (12 full answers plus 20 practice prompts)',
            'Telehealth platform interview questions',
            'Regulatory and ethics questions',
            'Questions to ask the employer',
            'Mock interview plan and day-before checklist',
        ],
    },
    'negotiate-like-an-np': {
        kind: 'guide',
        slug: 'negotiate-like-an-np',
        title: 'Negotiate Like an NP',
        subtitle: 'Scripts, offer math and contract red flags for every NP specialty',
        priceCents: 2900,
        pages: 38,
        sourceFile: 'nphiring-negotiate-like-an-np.pdf',
        audience: 'NPs weighing a first offer, a job change, a 1099 or telehealth contract, a shift-based role or a raise after year one.',
        summary: 'The data, the math and the exact words to move an offer toward the top of your specialty\'s range, with a 1099 vs. W-2 calculator and a 20-point contract red-flag audit.',
        contents: [
            'Know your number: market anchors for every NP specialty',
            'Total compensation, not salary',
            'Pay models decoded: salary, hourly, per visit, wRVU and collections',
            'The 1099 vs. W-2 calculator',
            'The offer comparison worksheet',
            'Negotiation scripts, word for word',
            'The 20-point contract red-flag audit and non-compete law in 2026',
            'Renegotiating after year one',
            'Sources and update log',
        ],
    },
    'telehealth-playbook': {
        kind: 'guide',
        slug: 'telehealth-playbook',
        title: 'The Telehealth NP Playbook',
        subtitle: 'Licensing across state lines, platform jobs and pricing your time (2026 to 2027)',
        priceCents: 2900,
        pages: 44,
        sourceFile: 'nphiring-telehealth-np-playbook.pdf',
        audience: 'NPs in any population focus who work for a telehealth platform, plan to join one, or want to run their own multistate telehealth practice.',
        summary: 'How to license across states, decide whether you need DEA, prescribe over video before and after January 1, 2027, bill correctly, judge a platform job and price your time.',
        contents: [
            'The 2026 to 2027 telehealth rulebook in one page',
            'Licensing across state lines',
            'Choosing your first three states (scoring worksheet)',
            'Adding a state license, step by step',
            'Prescriptive authority, furnishing numbers and state registrations',
            'DEA registration strategy for multistate practice',
            'Controlled-substance telehealth now and on January 1, 2027',
            'Medicare, Medicaid and commercial telehealth billing',
            'Telehealth platforms, pay models and due diligence',
            'The 1099 vs. W-2 rate calculator',
            'Compliance setup for telehealth practice',
            'Contract red flags for telehealth roles',
            'Checklists and templates',
        ],
    },
    'launch-your-practice': {
        kind: 'guide',
        slug: 'launch-your-practice',
        title: 'Launch Your NP Practice',
        subtitle: 'The 2026 toolkit for independent primary care, urgent care, women\'s health and specialty practices',
        priceCents: 3900,
        pages: 53,
        sourceFile: 'nphiring-launch-your-np-practice.pdf',
        audience: 'Board-certified NPs in any population focus who want to own a solo or small-group practice, in person, by telehealth or both.',
        summary: 'A 120-day launch timeline with the forms, costs, billing codes and templates for each step, from choosing your entity to your first claim.',
        contents: [
            'Can you own a practice in your state?',
            'Choosing your legal entity',
            'The 120-day launch timeline',
            'Identifiers and registrations',
            'Credentialing and payer enrollment',
            'Malpractice insurance for a practice owner',
            'HIPAA and your compliance program',
            'Choosing an EHR',
            'Billing and coding primer',
            'Cash-pay, insurance or hybrid',
            'Startup budget and break-even worksheet',
            'Collaborative agreements for owners in reduced and restricted states',
            'Templates you can copy',
        ],
    },
};

export const BUNDLES: Readonly<Record<BundleSlug, Bundle>> = {
    'career-bundle': {
        kind: 'bundle',
        slug: 'career-bundle',
        title: 'Career Bundle',
        subtitle: 'Land the job and negotiate the offer',
        priceCents: 3900,
        guides: ['first-year-playbook', 'interview-prep-pack', 'negotiate-like-an-np', 'compensation-report'],
        audience: 'Students, new grads and anyone changing jobs.',
        summary: 'Everything for a job search: the first-year roadmap, interview answers, negotiation scripts and the pay data behind your ask.',
    },
    'practice-owner-bundle': {
        kind: 'bundle',
        slug: 'practice-owner-bundle',
        title: 'Practice Owner Bundle',
        subtitle: 'Open and grow your own NP practice',
        priceCents: 4900,
        guides: ['launch-your-practice', 'telehealth-playbook', 'compensation-report'],
        audience: 'NPs opening a practice or working independently by telehealth.',
        summary: 'The practice launch toolkit, the multistate telehealth rules and the pay data to set your rates.',
    },
    'complete-library': {
        kind: 'bundle',
        slug: 'complete-library',
        title: 'Complete NP Library',
        subtitle: 'All six guides',
        priceCents: 6900,
        guides: [...GUIDE_SLUGS],
        audience: 'Every NP, from final semester to practice owner.',
        summary: 'Every guide in the store: the pay data, the first-year roadmap, interview answers, negotiation scripts, the telehealth rules and the practice launch toolkit.',
        bestValue: true,
    },
};

/** Bundle display order on the store. */
export const BUNDLE_ORDER: readonly BundleSlug[] = ['career-bundle', 'practice-owner-bundle', 'complete-library'];

/** "Add the Compensation Report for $5" at checkout, for products that do not already include it. */
export const ADD_ON = { guide: 'compensation-report' as GuideSlug, priceCents: 500 } as const;

export function isGuideSlug(value: string): value is GuideSlug {
    return (GUIDE_SLUGS as readonly string[]).includes(value);
}

export function getProduct(slug: string): Product | null {
    if (isGuideSlug(slug)) return GUIDES[slug];
    // Own keys only: a slug like "__proto__" or "constructor" must not
    // resolve to something inherited from Object.prototype.
    return Object.hasOwn(BUNDLES, slug) ? (BUNDLES as Readonly<Record<string, Bundle>>)[slug] : null;
}

export function allProducts(): readonly Product[] {
    return [...BUNDLE_ORDER.map((slug) => BUNDLES[slug]), ...GUIDE_SLUGS.map((slug) => GUIDES[slug])];
}

export function productGuides(product: Product): readonly GuideSlug[] {
    return product.kind === 'guide' ? [product.slug] : product.guides;
}

/** What the bundle's guides cost bought one at a time. */
export function separatePriceCents(bundle: Bundle): number {
    return bundle.guides.reduce((sum, slug) => sum + GUIDES[slug].priceCents, 0);
}

export function savingsCents(bundle: Bundle): number {
    return separatePriceCents(bundle) - bundle.priceCents;
}

export function addOnEligible(product: Product): boolean {
    return !productGuides(product).includes(ADD_ON.guide);
}

/** Every guide a purchase unlocks: the product's guides, plus the add-on when it was bought and eligible. */
export function resolvePurchaseGuides(product: Product, withAddOn: boolean): GuideSlug[] {
    const guides = [...productGuides(product)];
    if (withAddOn && addOnEligible(product)) guides.push(ADD_ON.guide);
    return guides;
}

/** Bundles that contain this guide, cheapest first. */
export function bundlesContaining(guide: GuideSlug): Bundle[] {
    return BUNDLE_ORDER.map((slug) => BUNDLES[slug])
        .filter((bundle) => bundle.guides.includes(guide))
        .sort((a, b) => a.priceCents - b.priceCents);
}

/** "$39", or "$4.50" when there are cents. */
export function formatPrice(cents: number): string {
    return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export function totalPages(product: Product): number {
    return productGuides(product).reduce((sum, slug) => sum + GUIDES[slug].pages, 0);
}
