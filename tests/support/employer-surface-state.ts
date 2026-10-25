/**
 * The state the employer dashboard and the job edit page render from, shared
 * by the suites that render them:
 *   tests/regressions/employer-dashboard-edit-render.test.ts
 *   tests/regressions/employer-dashboard-edit-render-pro-renewal.test.ts
 *
 * State reaches these client components through effects, which do not run
 * under renderToStaticMarkup, so each suite seeds the components' useState
 * values in order through its own react mock (a vi.mock is per test file).
 * The seed lists live here, once: a useState added ahead of these positions
 * means updating dashboardSeeds or editPageSeeds, and both suites follow.
 *
 * Imports only lib/config, so loading it mocks nothing and renders nothing.
 */
import { config } from '@/lib/config';

export const LAST_PROMO_INSTANT = new Date(Date.parse(config.promoEndsAt) - 1);
export const LADDER_START = new Date(config.promoEndsAt);
/** Before both instants: an expired post. */
export const EXPIRED_ON = '2026-12-20T12:00:00.000Z';
/** Well after both instants: a post with time left that is not ending soon. */
export const RUNS_UNTIL = '2027-02-15T12:00:00.000Z';
export const ARCHIVED_ON = '2026-12-10T12:00:00.000Z';

export const LABEL = config.promoEndsLabel;
export const POST_INCLUDES = `${config.durationDays} days with its own ${config.limits.candidateUnlocksPerPosting} unlocks and ${config.limits.inmailsPerPosting} InMails`;

/** Text as renderToStaticMarkup prints it, in an element or an attribute. */
export const rendered = (text: string): string => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

/** A saving claimed beside a renewal price, in renewalSavingsLabel's words. */
export const SAVINGS_CLAIM = /Save \d+% vs\./;

// The sentences both surfaces share.
export const FRESH_LISTING_FREE = `You can post this role again as a fresh listing, free through ${LABEL}. It runs ${POST_INCLUDES}.`;
export const FRESH_LISTING_LADDER = `You can post this role again as a fresh listing: $${config.introPrice} for your company's first paid post, $${config.postingPrice} after that. It runs ${POST_INCLUDES}.`;
export const OR_POST_AGAIN_FREE = `Or post this role again as a fresh listing, free through ${LABEL}.`;

/* ════════════════════════════ The dashboard ════════════════════════════ */

export interface DashboardJob {
    id: string;
    title: string;
    isPublished: boolean;
    isFeatured: boolean;
    viewCount: number;
    applyClickCount: number;
    applicantCount?: number;
    createdAt: string;
    expiresAt: string | null;
    archivedAt: string | null;
    editToken: string;
    paymentStatus: string;
    pricingTier: string;
    /** What this post pays to renew, in dollars: the server's answer (lib/renewal-price.ts). */
    renewalPrice: number;
    slug: string | null;
}

/** An expired, published post renewable at the base price, unless overridden. */
export function jobRow(overrides: Partial<DashboardJob> = {}): DashboardJob {
    return {
        id: 'job-1',
        title: 'Family Nurse Practitioner, Primary Care',
        isPublished: true,
        isFeatured: false,
        viewCount: 12,
        applyClickCount: 3,
        applicantCount: 1,
        createdAt: '2026-10-21T12:00:00.000Z',
        expiresAt: EXPIRED_ON,
        archivedAt: null,
        editToken: 'edit-token-1',
        paymentStatus: 'paid',
        pricingTier: 'pro',
        renewalPrice: config.renewalPrice,
        slug: 'family-nurse-practitioner-primary-care',
        ...overrides,
    };
}

/** A post bought at the posting price: it renews for the pro price. */
export const BOUGHT_AT_POSTING_PRICE: Partial<DashboardJob> = { paymentStatus: 'paid', pricingTier: 'pro', renewalPrice: config.proRenewalPrice };

export interface DashboardState {
    jobs: DashboardJob[];
    /** GET /api/create-checkout/availability; null until it answers. */
    paidPostingAvailable: boolean | null;
    /** The employer's own next new-post price; null when unknown. */
    nextPostPrice?: number | null;
    /** The row whose Renew or Post Again modal is open. */
    renewModalFor?: DashboardJob;
    jobFilter?: 'active' | 'archived';
}

/** The dashboard client's props for a state. */
export function dashboardProps(state: DashboardState) {
    return { employerEmail: 'hiring@clinic.example', employerName: 'Clinic Co', jobs: state.jobs };
}

/**
 * The dashboard client's useState calls, in order: renewingJobId,
 * showRenewModal, selectedJob, togglingJobId, archivingJobId, jobFilter,
 * archiveTarget, unpublishTarget, unpublishReason, unpublishNote, localJobs,
 * showSignupBanner, activeTab, mounted, paidPostingAvailable, nextPostPrice,
 * resumingJobId. The two sidebar cards render after it and keep their own
 * initial state.
 */
export function dashboardSeeds(state: DashboardState): unknown[] {
    return [
        null,
        state.renewModalFor !== undefined,
        state.renewModalFor ?? null,
        null,
        null,
        state.jobFilter ?? 'active',
        null,
        null,
        '',
        '',
        state.jobs,
        false,
        'jobs',
        true,
        state.paidPostingAvailable,
        state.nextPostPrice ?? null,
        null,
    ];
}

/* ════════════════════════════ The edit page ════════════════════════════ */

export interface EditPageState {
    /** EmployerJob.paymentStatus of the post being edited. */
    paymentStatus?: string;
    /** What the post pays to renew, in dollars: the edit API's answer. The base price unless set; null leaves it out of the answer. */
    renewalPrice?: number | null;
    expiresAt?: string;
    archivedAt?: string | null;
    /** GET /api/create-checkout/availability; null until it answers. */
    paidPostingAvailable: boolean | null;
    showRenewModal?: boolean;
}

/** The edit page's props. */
export function editPageProps() {
    return { params: Promise.resolve({ token: 'edit-token-1' }) };
}

/**
 * The page's useState calls, in order: token, job, employerJob, loading,
 * error, updateSuccess, showUnpublishConfirm, unpublishing, showRenewModal,
 * renewingTier, paidPostingAvailable, isApplyOnPlatform, currentStep,
 * completedSteps.
 */
export function editPageSeeds(state: EditPageState): unknown[] {
    const job = {
        id: 'job-1',
        title: 'Family Nurse Practitioner, Primary Care',
        isPublished: !state.archivedAt,
        expiresAt: state.expiresAt ?? EXPIRED_ON,
        archivedAt: state.archivedAt ?? null,
    };
    const employerJob = {
        id: 'employer-job-1',
        employerName: 'Clinic Co',
        contactEmail: 'hiring@clinic.example',
        companyWebsite: null,
        paymentStatus: state.paymentStatus ?? 'paid',
        ...(state.renewalPrice === null ? {} : { renewalPrice: state.renewalPrice ?? config.renewalPrice }),
    };
    return [
        'edit-token-1',
        job,
        employerJob,
        false,
        null,
        false,
        false,
        false,
        state.showRenewModal ?? false,
        null,
        state.paidPostingAvailable,
        false,
        1,
        new Set<number>(),
    ];
}
