/**
 * The guides store catalog: this board's six PDF guides with three bundles,
 * the sister board's six psych editions with their library (owner decision
 * 2026-11-26), and one checkout add-on per edition. Every price the store
 * shows or charges comes from here; the checkout route resolves a product
 * slug against this file and never takes an amount from the request. The
 * prices are the owner's of 2026-11-26, the same for both editions. They
 * apply as soon as this deployment can take the payment (the Stripe key and
 * the webhook secret set); until then every product is free to claim
 * (lib/guides/phase.ts#guidePhase).
 *
 * The psych editions' copy and file names are the sister board's, so they
 * live in config/psych-editions.ts; their prices and page counts are here.
 * Their slugs all start with `psych-`, so none can collide with this board's
 * own.
 *
 * Files live in the private Supabase Storage bucket GUIDES_BUCKET under
 * `<slug>.pdf` (scripts/guides/upload-guides.ts puts them there). Replacing a
 * file there is how a reader gets an updated edition: downloads always serve
 * the current object.
 */
import { psychEditions, type PsychEditionCopy } from '@/config/psych-editions';

/** This board's own six guides. */
export const OWN_GUIDE_SLUGS = [
    'compensation-report',
    'first-year-playbook',
    'interview-prep-pack',
    'negotiate-like-an-np',
    'telehealth-playbook',
    'launch-your-practice',
] as const;

/** The sister board's six guides, sold here as the psych editions, in the order its own store lists them. */
export const PSYCH_GUIDE_SLUGS = [
    'psych-compensation-report',
    'psych-first-year-playbook',
    'psych-interview-prep-pack',
    'psych-negotiation-guide',
    'psych-telepsychiatry-playbook',
    'psych-launch-your-practice',
] as const;

/** Every guide in the store, in store order: this board's own, then the psych editions. */
export const GUIDE_SLUGS = [...OWN_GUIDE_SLUGS, ...PSYCH_GUIDE_SLUGS] as const;

export type OwnGuideSlug = (typeof OWN_GUIDE_SLUGS)[number];
export type PsychGuideSlug = (typeof PSYCH_GUIDE_SLUGS)[number];
export type GuideSlug = (typeof GUIDE_SLUGS)[number];

/**
 * Which shelf a product sits on: 'own' for this board's guides, 'psych' for
 * the sister board's editions. An edition has its own add-on, labels and
 * canonical (lib/guides/canonical.ts); the claim, checkout, library and
 * downloads are the same for both.
 */
export type GuideEdition = 'own' | 'psych';

export interface Guide {
    readonly kind: 'guide';
    readonly edition: GuideEdition;
    readonly slug: GuideSlug;
    readonly title: string;
    readonly subtitle: string;
    readonly priceCents: number;
    readonly pages: number;
    /**
     * The PDF's file name in the repo's ignored "NP Guides" folder, and the
     * name readers download it under. A psych edition's file keeps the sister
     * board's name and is copied into that folder before an upload.
     */
    readonly sourceFile: string;
    readonly audience: string;
    readonly summary: string;
    readonly contents: readonly string[];
    /** A psych edition's slug on the sister board's store, whose page is this one's canonical. */
    readonly sisterSlug?: string;
}

export interface Bundle {
    readonly kind: 'bundle';
    readonly edition: GuideEdition;
    readonly slug: BundleSlug;
    readonly title: string;
    readonly subtitle: string;
    readonly priceCents: number;
    readonly guides: readonly GuideSlug[];
    readonly audience: string;
    readonly summary: string;
    /** The bundle the store points people to. */
    readonly bestValue?: boolean;
    /** A psych bundle's slug on the sister board's store, whose page is this one's canonical. */
    readonly sisterSlug?: string;
}

export type BundleSlug = 'career-bundle' | 'practice-owner-bundle' | 'complete-library' | 'psych-library';
export type Product = Guide | Bundle;
export type ProductSlug = GuideSlug | BundleSlug;

export const GUIDES_BUCKET = 'guides';

/** A psych edition's price and page count (the PDF's pages, cover excluded): the figures this store owns. */
interface EditionFigures {
    readonly priceCents: number;
    readonly pages: number;
}

/** The owner's prices of 2026-11-26, the sister board's new ones, which match this board's guide on the same subject. */
const PSYCH_FIGURES: Readonly<Record<PsychGuideSlug, EditionFigures>> = {
    'psych-compensation-report': { priceCents: 900, pages: 29 },
    'psych-first-year-playbook': { priceCents: 2900, pages: 29 },
    'psych-interview-prep-pack': { priceCents: 2900, pages: 33 },
    'psych-negotiation-guide': { priceCents: 3900, pages: 37 },
    'psych-telepsychiatry-playbook': { priceCents: 3900, pages: 31 },
    'psych-launch-your-practice': { priceCents: 4900, pages: 44 },
};

const PSYCH_COPY: Readonly<Record<PsychGuideSlug, PsychEditionCopy>> = psychEditions.guides;

function psychGuide(slug: PsychGuideSlug): Guide {
    const copy = PSYCH_COPY[slug];
    return {
        kind: 'guide',
        edition: 'psych',
        slug,
        title: copy.title,
        subtitle: copy.subtitle,
        ...PSYCH_FIGURES[slug],
        sourceFile: copy.sourceFile,
        audience: copy.audience,
        summary: copy.summary,
        contents: copy.contents,
        sisterSlug: copy.sisterSlug,
    };
}

export const GUIDES: Readonly<Record<GuideSlug, Guide>> = {
    'compensation-report': {
        kind: 'guide',
        edition: 'own',
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
        edition: 'own',
        slug: 'first-year-playbook',
        title: 'First-Year NP Playbook',
        subtitle: 'From boards to your first contract in any specialty',
        priceCents: 2900,
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
        edition: 'own',
        slug: 'interview-prep-pack',
        title: 'NP Interview Prep Pack',
        subtitle: 'Primary care, urgent care, acute care and telehealth questions with model answers',
        priceCents: 2900,
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
        edition: 'own',
        slug: 'negotiate-like-an-np',
        title: 'Negotiate Like an NP',
        subtitle: 'Scripts, offer math and contract red flags for every NP specialty',
        priceCents: 3900,
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
        edition: 'own',
        slug: 'telehealth-playbook',
        title: 'The Telehealth NP Playbook',
        subtitle: 'Licensing across state lines, platform jobs and pricing your time (2026 to 2027)',
        priceCents: 3900,
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
        edition: 'own',
        slug: 'launch-your-practice',
        title: 'Launch Your NP Practice',
        subtitle: 'The 2026 toolkit for independent primary care, urgent care, women\'s health and specialty practices',
        priceCents: 4900,
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
    'psych-compensation-report': psychGuide('psych-compensation-report'),
    'psych-first-year-playbook': psychGuide('psych-first-year-playbook'),
    'psych-interview-prep-pack': psychGuide('psych-interview-prep-pack'),
    'psych-negotiation-guide': psychGuide('psych-negotiation-guide'),
    'psych-telepsychiatry-playbook': psychGuide('psych-telepsychiatry-playbook'),
    'psych-launch-your-practice': psychGuide('psych-launch-your-practice'),
};

export const BUNDLES: Readonly<Record<BundleSlug, Bundle>> = {
    'career-bundle': {
        kind: 'bundle',
        edition: 'own',
        slug: 'career-bundle',
        title: 'Career Bundle',
        subtitle: 'Land the job and negotiate the offer',
        priceCents: 4900,
        guides: ['first-year-playbook', 'interview-prep-pack', 'negotiate-like-an-np', 'compensation-report'],
        audience: 'Students, new grads and anyone changing jobs.',
        summary: 'Everything for a job search: the first-year roadmap, interview answers, negotiation scripts and the pay data behind your ask.',
    },
    'practice-owner-bundle': {
        kind: 'bundle',
        edition: 'own',
        slug: 'practice-owner-bundle',
        title: 'Practice Owner Bundle',
        subtitle: 'Open and grow your own NP practice',
        priceCents: 5900,
        guides: ['launch-your-practice', 'telehealth-playbook', 'compensation-report'],
        audience: 'NPs opening a practice or working independently by telehealth.',
        summary: 'The practice launch toolkit, the multistate telehealth rules and the pay data to set your rates.',
    },
    'complete-library': {
        kind: 'bundle',
        edition: 'own',
        slug: 'complete-library',
        title: 'Complete NP Library',
        subtitle: 'All six guides',
        priceCents: 9900,
        guides: [...OWN_GUIDE_SLUGS],
        audience: 'Every NP, from final semester to practice owner.',
        summary: 'Every NP guide in the store: the pay data, the first-year roadmap, interview answers, negotiation scripts, the telehealth rules and the practice launch toolkit.',
        bestValue: true,
    },
    'psych-library': {
        kind: 'bundle',
        edition: 'psych',
        slug: 'psych-library',
        title: psychEditions.library.title,
        subtitle: psychEditions.library.subtitle,
        priceCents: 9900,
        guides: [...PSYCH_GUIDE_SLUGS],
        audience: psychEditions.library.audience,
        summary: psychEditions.library.summary,
        bestValue: true,
        sisterSlug: psychEditions.library.sisterSlug,
    },
};

/** Bundle display order on the store's own shelves. */
export const BUNDLE_ORDER: readonly BundleSlug[] = ['career-bundle', 'practice-owner-bundle', 'complete-library'];

/** The psych editions' bundles: the library of all six. */
export const PSYCH_BUNDLE_ORDER: readonly BundleSlug[] = ['psych-library'];

/** A checkout add-on: one guide at a set price, offered with products that do not already include it. */
export interface AddOn {
    readonly guide: GuideSlug;
    readonly priceCents: number;
}

/** "Add the Compensation Report for $5" at checkout: this board's own guides and bundles. */
export const ADD_ON: AddOn = { guide: 'compensation-report', priceCents: 500 };

/** Each edition offers its own compensation report as the add-on, at the same price, as the sister board's store does. */
const ADD_ONS: Readonly<Record<GuideEdition, AddOn>> = {
    own: ADD_ON,
    psych: { guide: 'psych-compensation-report', priceCents: 500 },
};

/** The add-on checkout offers with `product`: the report of its own edition. */
export function addOnFor(product: Product): AddOn {
    return ADD_ONS[product.edition];
}

export function isGuideSlug(value: string): value is GuideSlug {
    return (GUIDE_SLUGS as readonly string[]).includes(value);
}

export function getProduct(slug: string): Product | null {
    if (isGuideSlug(slug)) return GUIDES[slug];
    // Own keys only: a slug like "__proto__" or "constructor" must not
    // resolve to something inherited from Object.prototype.
    return Object.hasOwn(BUNDLES, slug) ? (BUNDLES as Readonly<Record<string, Bundle>>)[slug] : null;
}

const SHELVES: Readonly<Record<GuideEdition, { readonly bundles: readonly BundleSlug[]; readonly guides: readonly GuideSlug[] }>> = {
    own: { bundles: BUNDLE_ORDER, guides: OWN_GUIDE_SLUGS },
    psych: { bundles: PSYCH_BUNDLE_ORDER, guides: PSYCH_GUIDE_SLUGS },
};

/** One edition's products: its bundles, then its guides. */
export function editionProducts(edition: GuideEdition): readonly Product[] {
    const shelf = SHELVES[edition];
    return [...shelf.bundles.map((slug) => BUNDLES[slug]), ...shelf.guides.map((slug) => GUIDES[slug])];
}

/** Every product in the store: this board's own, then the psych editions. */
export function allProducts(): readonly Product[] {
    return [...editionProducts('own'), ...editionProducts('psych')];
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
    return !productGuides(product).includes(addOnFor(product).guide);
}

/** Every guide a purchase unlocks: the product's guides, plus its edition's add-on when it was bought and eligible. */
export function resolvePurchaseGuides(product: Product, withAddOn: boolean): GuideSlug[] {
    const guides = [...productGuides(product)];
    if (withAddOn && addOnEligible(product)) guides.push(addOnFor(product).guide);
    return guides;
}

/** Bundles that contain this guide, cheapest first. */
export function bundlesContaining(guide: GuideSlug): Bundle[] {
    return [...BUNDLE_ORDER, ...PSYCH_BUNDLE_ORDER]
        .map((slug) => BUNDLES[slug])
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
