/**
 * The employer dashboard and the job edit page, rendered.
 *
 * Both are client components whose launch-promo sentences sit behind
 * promoActive gates in JSX: the Post Again and legacy free-trial modals, the
 * "free through" line under the renewal offer, "Post it free" on an unpaid
 * row, the free repost on the edit page's expiry banner. Source pins held
 * those sentences in place, but nothing rendered either surface, so a gate
 * could be dropped with every test green. From 2027-01-01T10:00Z the pages
 * would then tell employers posting is free while the server charges for it
 * (backlog 2.1; both phases, explicit dates).
 *
 * Every promo case renders the real component at the last instant of the
 * promo and again at config.promoEndsAt:
 *   - one instant before, the promo sentences print as they always have;
 *   - from the boundary, nothing on the page offers a free post, names the
 *     promo or its end date, or says "January 1, 2027". What may still say
 *     "free" or "launch promo" is a label on one post about how that post
 *     was made (POST_HISTORY), which stays true.
 *
 * The same renders pin the archived-post rule: an archived post offers no
 * renewal (the renewal checkout answers 409 for it), so the dashboard row
 * and the edit page say to restore it first and never show a Renew that can
 * only fail.
 *
 * State reaches these components through effects, which do not run under
 * renderToStaticMarkup, so each case seeds the component's useState values
 * in order (see renderDashboard and renderEditPage), the technique of
 * tests/regressions/checkout-page-server-quote.test.ts. A useState added
 * ahead of those positions means updating the seed list.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { config } from '@/lib/config';
import { renewalSavingsLine } from '@/lib/renewal-offer';
import EmployerDashboardClient from '@/components/employer/EmployerDashboardClient';
import EditJobPage from '@/app/jobs/edit/[token]/page';

const seeded = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        useState: (initial: unknown) => {
            const i = seeded.index++;
            const value = i < seeded.values.length
                ? seeded.values[i]
                : typeof initial === 'function' ? (initial as () => unknown)() : initial;
            return [value, () => undefined];
        },
    };
});

vi.mock('next/link', async () => {
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return {
        default: ({ href, title, children }: { href: string; title?: string; children?: React.ReactNode }) =>
            createElement('a', { href, title }, children),
    };
});
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/analytics', () => ({ trackBeginCheckout: vi.fn() }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ toast: vi.fn() }) }));
// The dashboard's other panels. None carries the copy under test; the usage
// strip has its own cases in employer-app-promo-phase.test.ts.
vi.mock('@/components/employer/UsageWidget', () => ({ default: () => null }));
vi.mock('@/components/employer/ApplicantsTab', () => ({ default: () => null }));
vi.mock('@/components/employer/AnalyticsTab', () => ({ default: () => null }));
vi.mock('@/components/employer/SavedCandidatesTab', () => ({ default: () => null }));
vi.mock('@/components/employer/MessagesTab', () => ({ default: () => null }));
// The edit page's editor and question builder, which later steps render.
vi.mock('react-quill-new', () => ({ default: () => null }));
vi.mock('react-quill-new/dist/quill.snow.css', () => ({}));
vi.mock('@/components/ScreeningQuestionsBuilder', () => ({ default: () => null }));

const LAST_PROMO_INSTANT = new Date(Date.parse(config.promoEndsAt) - 1);
const LADDER_START = new Date(config.promoEndsAt);
/** Before both instants: an expired post. */
const EXPIRED_ON = '2026-12-20T12:00:00.000Z';
/** Well after both instants: a post with time left that is not ending soon. */
const RUNS_UNTIL = '2027-02-15T12:00:00.000Z';
const ARCHIVED_ON = '2026-12-10T12:00:00.000Z';

const LABEL = config.promoEndsLabel;
const POST_INCLUDES = `${config.durationDays} days with its own ${config.limits.candidateUnlocksPerPosting} unlocks and ${config.limits.inmailsPerPosting} InMails`;

/** Text as renderToStaticMarkup prints it, in an element or an attribute. */
const rendered = (text: string): string => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

/** Promo language that must never be a current offer once the promo has ended. */
const PROMO_OFFER = /\bfree\b|launch promo|launch period|\$0\b/i;

/**
 * Labels on one post about how that post was made. They stay true after the
 * promo, so they are taken out before a page is searched for promo offers:
 * the status pills on a promo post and on a legacy free-trial post, and the
 * legacy modal's statement that such a post cannot be renewed.
 */
const POST_HISTORY: readonly string[] = [
    '>Launch promo</span>',
    '>Free trial</span>',
    rendered("This free post can't be renewed"),
    'This free post cannot be renewed',
    rendered("This legacy free-trial post isn't one of them."),
];

/** The first promo offer on a page, with the text around it, or null when there is none. */
function promoOfferIn(html: string): string | null {
    const page = POST_HISTORY.reduce((rest, label) => rest.split(label).join(''), html);
    const found = [page.search(PROMO_OFFER), page.indexOf(config.promoEndsLabel), page.indexOf(config.ladderStartsLabel)]
        .filter((index) => index >= 0);
    if (found.length === 0) return null;
    const first = Math.min(...found);
    return page.slice(Math.max(0, first - 80), first + 80);
}

/** A saving claimed beside a renewal price, in renewalSavingsLabel's words. */
const SAVINGS_CLAIM = /Save \d+% vs\./;

// The sentences both surfaces share.
const FRESH_LISTING_FREE = `You can post this role again as a fresh listing, free through ${LABEL}. It runs ${POST_INCLUDES}.`;
const FRESH_LISTING_LADDER = `You can post this role again as a fresh listing: $${config.introPrice} for your company's first paid post, $${config.postingPrice} after that. It runs ${POST_INCLUDES}.`;
const OR_POST_AGAIN_FREE = `Or post this role again as a fresh listing, free through ${LABEL}.`;

function renderWith<P extends object>(component: React.ComponentType<P>, props: P, state: unknown[]): string {
    seeded.values = state;
    seeded.index = 0;
    return renderToStaticMarkup(React.createElement(component, props));
}

// The first render of each surface pays for everything React and the
// component load on demand. On a busy machine that can outlast the default
// test timeout, so both are rendered once here with room to spare (the
// repo's cold-import pattern, as in tests/api/create-checkout-tier.test.ts).
beforeAll(() => {
    renderDashboard({ jobs: [jobRow()], paidPostingAvailable: true });
    renderEditPage({ paidPostingAvailable: true });
}, 60_000);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('the promo-offer detector', () => {
    it.each([
        ['a free offer', '<p>Post a New Job for Free</p>'],
        ['the promo by name', '<p>during the launch promo</p>'],
        ['the launch period', '<p>free during our launch period</p>'],
        ['a zero price', '<span>$0</span>'],
        ['the promo end date', `<p>through ${config.promoEndsLabel}</p>`],
        ['the ladder start date', `<p>From ${config.ladderStartsLabel}</p>`],
    ])('finds %s', (_label, html) => {
        expect(promoOfferIn(html)).not.toBeNull();
    });

    it('passes ladder copy, and the labels that describe how one post was made', () => {
        expect(promoOfferIn(`<p>$${config.introPrice} for your first post. Archiving frees the slot.</p>`)).toBeNull();
        expect(promoOfferIn('<span style="color:#BE185D">Launch promo</span><span>Free trial</span>')).toBeNull();
        // The same words anywhere else are an offer.
        expect(promoOfferIn('<p>Launch promo: every post is free</p>')).not.toBeNull();
    });
});

/* ════════════════════════════ The dashboard ════════════════════════════ */

interface DashboardJob {
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
    slug: string | null;
}

/** An expired, published post bought on the ladder, unless overridden. */
function jobRow(overrides: Partial<DashboardJob> = {}): DashboardJob {
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
        slug: 'family-nurse-practitioner-primary-care',
        ...overrides,
    };
}

interface DashboardState {
    jobs: DashboardJob[];
    /** GET /api/create-checkout/availability; null until it answers. */
    paidPostingAvailable: boolean | null;
    /** The employer's own next new-post price; null when unknown. */
    nextPostPrice?: number | null;
    /** The row whose Renew or Post Again modal is open. */
    renewModalFor?: DashboardJob;
    jobFilter?: 'active' | 'archived';
}

function renderDashboard(state: DashboardState): string {
    // The component's useState calls, in order: renewingJobId, showRenewModal,
    // selectedJob, togglingJobId, archivingJobId, jobFilter, archiveTarget,
    // unpublishTarget, unpublishReason, unpublishNote, localJobs,
    // showSignupBanner, activeTab, mounted, paidPostingAvailable,
    // nextPostPrice, resumingJobId. The two sidebar cards render after it and
    // keep their own initial state.
    const seeds: unknown[] = [
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
    return renderWith(
        EmployerDashboardClient,
        { employerEmail: 'hiring@clinic.example', employerName: 'Clinic Co', jobs: state.jobs },
        seeds,
    );
}

/** The tooltip on each row's disabled Pause or Unpause button, in row order. */
const blockTitles = (html: string): string[] =>
    [...html.matchAll(/<button disabled="" title="([^"]*)" class="emp-action-btn"/g)].map((match) => match[1]);

const RENEW_BUTTON = />Renew<\/button>/;
const POST_AGAIN_BUTTON = />Post Again<\/button>/;
const COMPLETE_PAYMENT_BUTTON = />Complete payment<\/button>/;
const POST_IT_FREE_TITLE = `Every post is free through ${LABEL}. Post this role again as a new listing to publish it.`;
const UNPAID_PROMO_TITLE = `This posting was never paid for. Every post is free through ${LABEL}, so post the role again as a new listing.`;
const UNPAID_LADDER_TITLE = 'Payment required to publish this posting. Complete checkout to make it live.';
const EXPIRED_RENEW_TITLE = 'This posting has expired. Renew or post a new listing to make changes.';
const EXPIRED_FINAL_TITLE = 'This posting has expired and cannot be republished.';

describe('employer dashboard: what the job rows offer', () => {
    // A post made during the promo that has since ended, and a checkout that
    // was never completed.
    const EXPIRED = jobRow({ id: 'job-expired', paymentStatus: 'promo' });
    const UNPAID = jobRow({
        id: 'job-unpaid',
        title: 'Psychiatric Nurse Practitioner, Outpatient',
        paymentStatus: 'pending',
        isPublished: false,
        expiresAt: RUNS_UNTIL,
    });
    const rows = (paidPostingAvailable: boolean | null): string =>
        renderDashboard({ jobs: [EXPIRED, UNPAID], paidPostingAvailable });

    it('paid posting off, during the promo: a free repost for the expired post and a free new post for the unpaid one', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        const html = rows(false);

        expect(html).toMatch(POST_AGAIN_BUTTON);
        expect(html).toContain(`<a href="/post-job" title="${rendered(POST_IT_FREE_TITLE)}">`);
        expect(html).toContain(' Post it free</a>');
        expect(blockTitles(html)).toEqual([EXPIRED_FINAL_TITLE, rendered(UNPAID_PROMO_TITLE)]);
        expect(html).not.toMatch(RENEW_BUTTON);
        expect(html).not.toMatch(COMPLETE_PAYMENT_BUTTON);
    });

    it('paid posting off, once the promo has ended: neither row offers anything free', () => {
        vi.setSystemTime(LADDER_START);
        const html = rows(false);

        expect(promoOfferIn(html)).toBeNull();
        expect(html).not.toMatch(POST_AGAIN_BUTTON);
        expect(html).not.toContain('Post it free');
        expect(blockTitles(html)).toEqual([EXPIRED_FINAL_TITLE, UNPAID_LADDER_TITLE]);
        // No checkout can open while paid posting is off.
        expect(html).not.toMatch(RENEW_BUTTON);
        expect(html).not.toMatch(COMPLETE_PAYMENT_BUTTON);
    });

    it('paid posting on, during the promo: Renew, and still a free new post instead of a checkout the promo refuses', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        const html = rows(true);

        expect(html).toMatch(RENEW_BUTTON);
        expect(html).not.toMatch(POST_AGAIN_BUTTON);
        expect(html).toContain(' Post it free</a>');
        expect(html).not.toMatch(COMPLETE_PAYMENT_BUTTON);
        expect(blockTitles(html)).toEqual([EXPIRED_RENEW_TITLE, rendered(UNPAID_PROMO_TITLE)]);
    });

    it('paid posting on, once the promo has ended: Renew and Complete payment, and nothing free', () => {
        vi.setSystemTime(LADDER_START);
        const html = rows(true);

        expect(promoOfferIn(html)).toBeNull();
        expect(html).toMatch(RENEW_BUTTON);
        expect(html).toMatch(COMPLETE_PAYMENT_BUTTON);
        expect(html).not.toContain('Post it free');
        expect(blockTitles(html)).toEqual([EXPIRED_RENEW_TITLE, UNPAID_LADDER_TITLE]);
    });

    it('until availability is known the expired post offers no action, in either phase', () => {
        for (const now of [LAST_PROMO_INSTANT, LADDER_START]) {
            vi.setSystemTime(now);
            const html = rows(null);

            expect(html, now.toISOString()).not.toMatch(RENEW_BUTTON);
            expect(html, now.toISOString()).not.toMatch(POST_AGAIN_BUTTON);
        }
    });
});

describe('employer dashboard: the Post Again modal, open while no renewal is on sale', () => {
    const post = jobRow({ paymentStatus: 'promo' });
    const open = (): string => renderDashboard({ jobs: [post], paidPostingAvailable: false, renewModalFor: post });

    it('during the promo: post the role again for free', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        const html = open();

        expect(html).toContain('>Post this role again for free</h3>');
        expect(html).toContain(`>Renewal is not available yet. Every job post is free through ${LABEL}, so you can post this role again as a fresh listing at no charge.</p>`);
        expect(html).toContain(`>A new post runs ${POST_INCLUDES}. This listing keeps its applicants and stats in your dashboard.</p>`);
        expect(html).toContain('<a href="/post-job">Post a New Job for Free</a>');
        expect(html).toContain('>Cancel</button>');
    });

    it('once the promo has ended: renewal is not available, and no free post is offered in its place', () => {
        // The row no longer opens this modal then; one opened before the
        // boundary is still on screen after it.
        vi.setSystemTime(LADDER_START);
        const html = open();

        expect(promoOfferIn(html)).toBeNull();
        expect(html).toContain('>Renewal is not available yet</h3>');
        expect(html).toContain('>Renewal is not available yet.</p>');
        expect(html).toContain('>This listing keeps its applicants and stats in your dashboard.</p>');
        expect(html).not.toContain('<a href="/post-job">Post a New Job');
        expect(html).toContain('>Close</button>');
    });
});

describe('employer dashboard: the renewal modal', () => {
    const post = jobRow({ paymentStatus: 'promo' });
    const open = (nextPostPrice: number | null): string =>
        renderDashboard({ jobs: [post], paidPostingAvailable: true, nextPostPrice, renewModalFor: post });

    it('during the promo: no saving is claimed, and the free repost is offered beside the renewal', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        // What the quota endpoint quotes while the promo runs, and a ladder
        // price the page might hold from elsewhere: neither earns a claim.
        for (const nextPostPrice of [0, config.postingPrice, null]) {
            const html = open(nextPostPrice);

            expect(html).toContain('>Renew Job Posting</h3>');
            expect(html).toContain(`>$${config.renewalPrice}</span>`);
            expect(html).not.toMatch(SAVINGS_CLAIM);
            expect(html).toContain(`${OR_POST_AGAIN_FREE} <a href="/post-job">Post a new job</a>`);
        }
    });

    it.each<[string, number | null]>([
        ['an unknown next-post price, against the standard post price', null],
        ["the employer's own intro price", config.introPrice],
        ["the employer's own post price", config.postingPrice],
    ])('once the promo has ended: the saving for %s, and no free repost', (_label, nextPostPrice) => {
        vi.setSystemTime(LADDER_START);
        const html = open(nextPostPrice);
        const saving = renewalSavingsLine({ purchasable: true, nextPostPrice, now: LADDER_START });

        expect(saving).toMatch(SAVINGS_CLAIM);
        expect(html).toContain(`>${saving}</p>`);
        expect(html).toContain(`>$${config.renewalPrice}</span>`);
        expect(html).not.toContain('Or post this role again');
        expect(html).not.toContain('<a href="/post-job">Post a new job</a>');
        expect(promoOfferIn(html)).toBeNull();
    });
});

describe('employer dashboard: the legacy free-trial modal', () => {
    const post = jobRow({ paymentStatus: 'free' });
    const open = (): string => renderDashboard({ jobs: [post], paidPostingAvailable: true, renewModalFor: post });

    it('during the promo: a fresh listing is free', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        const html = open();

        expect(html).toContain(`>${rendered("This free post can't be renewed")}</h3>`);
        expect(html).toContain(`>${FRESH_LISTING_FREE}</p>`);
        expect(html).toContain('<a href="/post-job">Post a New Job for Free</a>');
    });

    it('once the promo has ended: a fresh listing costs the ladder prices', () => {
        vi.setSystemTime(LADDER_START);
        const html = open();

        expect(html).toContain(`>${rendered("This free post can't be renewed")}</h3>`);
        expect(html).toContain(`>${rendered(FRESH_LISTING_LADDER)}</p>`);
        expect(html).toContain('<a href="/post-job">Post a New Job</a>');
        expect(promoOfferIn(html)).toBeNull();
    });
});

describe('employer dashboard: an archived post is restored before it is renewed', () => {
    const RESTORE_TO_RENEW_TITLE = 'This post is archived and has expired. Restore it before you renew it, or post a new listing.';
    const archived = (overrides: Partial<DashboardJob> = {}): DashboardJob =>
        jobRow({ archivedAt: ARCHIVED_ON, isPublished: false, ...overrides });
    const archivedTab = (job: DashboardJob, paidPostingAvailable: boolean): string =>
        renderDashboard({ jobs: [job], paidPostingAvailable, jobFilter: 'archived' });

    beforeEach(() => {
        vi.setSystemTime(LADDER_START);
    });

    it('archived and expired, with renewals on sale: the tooltip says to restore it, and the row has no Renew to point at', () => {
        const html = archivedTab(archived(), true);

        expect(blockTitles(html)).toEqual([RESTORE_TO_RENEW_TITLE]);
        expect(html).not.toMatch(RENEW_BUTTON);
        expect(html).toMatch(/>Restore<\/button>/);
    });

    it('the same post once restored offers Renew, which its tooltip then names', () => {
        const html = renderDashboard({ jobs: [jobRow({ isPublished: false })], paidPostingAvailable: true });

        expect(blockTitles(html)).toEqual([EXPIRED_RENEW_TITLE]);
        expect(html).toMatch(RENEW_BUTTON);
    });

    it('archived with time left: restore it before republishing', () => {
        const html = archivedTab(archived({ expiresAt: RUNS_UNTIL }), true);

        expect(blockTitles(html)).toEqual(['This post is archived. Restore it before you republish it.']);
    });

    it('archived and expired with no renewal on sale: restoring would not help, so it reads as any expired post', () => {
        const html = archivedTab(archived(), false);

        expect(blockTitles(html)).toEqual([EXPIRED_FINAL_TITLE]);
    });

    it.each(['plan', 'pending', 'refunded'])("an archived, expired '%s' post is not told a restore brings a renewal", (paymentStatus) => {
        const html = archivedTab(archived({ paymentStatus }), true);

        expect(blockTitles(html)).toHaveLength(1);
        expect(blockTitles(html)[0]).not.toContain('Restore it before you renew it');
        expect(html).not.toMatch(RENEW_BUTTON);
    });
});

/* ════════════════════════════ The edit page ════════════════════════════ */

interface EditPageState {
    /** EmployerJob.paymentStatus of the post being edited. */
    paymentStatus?: string;
    expiresAt?: string;
    archivedAt?: string | null;
    /** GET /api/create-checkout/availability; null until it answers. */
    paidPostingAvailable: boolean | null;
    showRenewModal?: boolean;
}

function renderEditPage(state: EditPageState): string {
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
    };
    // The page's useState calls, in order: token, job, employerJob, loading,
    // error, updateSuccess, showUnpublishConfirm, unpublishing,
    // showRenewModal, renewingTier, paidPostingAvailable, isApplyOnPlatform,
    // currentStep, completedSteps.
    const seeds: unknown[] = [
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
    return renderWith(EditJobPage, { params: Promise.resolve({ token: 'edit-token-1' }) }, seeds);
}

const FREE_REPOST_BANNER = ` Every job post is free through ${LABEL}, so you can post this role again as a fresh listing at no charge.</p>`;
const FREE_REPOST_LINK = '<a href="/post-job">Post a New Job for Free</a>';
const NOT_VISIBLE = 'It is no longer visible to candidates.';

describe('job edit page: the expiry banner', () => {
    it('paid posting off, during the promo: a free repost', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        const html = renderEditPage({ paidPostingAvailable: false });

        expect(html).toContain('>This job has expired</h3>');
        expect(html).toContain(`${NOT_VISIBLE}${FREE_REPOST_BANNER}`);
        expect(html).toContain(FREE_REPOST_LINK);
        expect(html).not.toContain('Renew This Job');
    });

    it('paid posting off, once the promo has ended: the expiry notice alone, and nothing free', () => {
        vi.setSystemTime(LADDER_START);
        const html = renderEditPage({ paidPostingAvailable: false });

        expect(promoOfferIn(html)).toBeNull();
        expect(html).toContain(`${NOT_VISIBLE}</p>`);
        expect(html).not.toContain('<a href="/post-job">');
        expect(html).not.toContain('Renew This Job');
    });

    it('paid posting on: Renew in both phases, never the free repost', () => {
        for (const now of [LAST_PROMO_INSTANT, LADDER_START]) {
            vi.setSystemTime(now);
            const html = renderEditPage({ paidPostingAvailable: true });

            expect(html, now.toISOString()).toContain(`${NOT_VISIBLE} Renew to relist it.</p>`);
            expect(html, now.toISOString()).toContain('Renew This Job</button>');
            expect(html, now.toISOString()).not.toContain(FREE_REPOST_LINK);
            expect(promoOfferIn(html), now.toISOString()).toBeNull();
        }
    });

    it('until availability is known the banner offers nothing, in either phase', () => {
        for (const now of [LAST_PROMO_INSTANT, LADDER_START]) {
            vi.setSystemTime(now);
            const html = renderEditPage({ paidPostingAvailable: null });

            expect(html, now.toISOString()).toContain(`${NOT_VISIBLE}</p>`);
            expect(html, now.toISOString()).not.toContain(FREE_REPOST_LINK);
            expect(html, now.toISOString()).not.toContain('Renew This Job');
        }
    });
});

describe('job edit page: the renewal modal', () => {
    const open = (): string => renderEditPage({ paidPostingAvailable: true, showRenewModal: true });

    it('during the promo: no saving is claimed, and the free repost is offered beside the renewal', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        const html = open();

        expect(html).toContain('>Renew Job Posting</h3>');
        expect(html).toContain(`>$${config.renewalPrice}</span>`);
        expect(html).not.toMatch(SAVINGS_CLAIM);
        expect(html).toContain(`${OR_POST_AGAIN_FREE} <a href="/post-job">Post a new job</a>`);
    });

    it('once the promo has ended: the saving against the standard post price, and no free repost', () => {
        vi.setSystemTime(LADDER_START);
        const html = open();
        // This page does not know the employer's quota domain, so the claim
        // names the standard post price.
        const saving = renewalSavingsLine({ purchasable: true, now: LADDER_START });

        expect(saving).toBe(`Save 40% vs. the $${config.postingPrice} post price`);
        expect(html).toContain(`>${saving}</p>`);
        expect(html).toContain('>Renew Job Posting</h3>');
        expect(html).not.toContain('Or post this role again');
        expect(html).not.toContain('<a href="/post-job">');
        expect(promoOfferIn(html)).toBeNull();
    });
});

describe('job edit page: the legacy free-trial modal', () => {
    const open = (): string => renderEditPage({ paymentStatus: 'free', paidPostingAvailable: true, showRenewModal: true });

    it('during the promo: a fresh listing is free', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        const html = open();

        expect(html).toContain('>This free post cannot be renewed</h3>');
        expect(html).toContain(`>${FRESH_LISTING_FREE}</p>`);
        expect(html).toContain(FREE_REPOST_LINK);
    });

    it('once the promo has ended: a fresh listing costs the ladder prices', () => {
        vi.setSystemTime(LADDER_START);
        const html = open();

        expect(html).toContain('>This free post cannot be renewed</h3>');
        expect(html).toContain(`>${rendered(FRESH_LISTING_LADDER)}</p>`);
        expect(html).toContain('<a href="/post-job">Post a New Job</a>');
        expect(promoOfferIn(html)).toBeNull();
    });
});

describe('job edit page: an archived post is restored before it is renewed', () => {
    const RESTORE_HINT = ' This post is archived. Restore it from the Archived tab of your dashboard before you renew it.</p>';
    const DASHBOARD_LINK = '<a href="/employer/dashboard">Go to your dashboard</a>';

    it('renewals on sale: the restore hint and the way to the dashboard, with no Renew and no renewal modal', () => {
        for (const now of [LAST_PROMO_INSTANT, LADDER_START]) {
            vi.setSystemTime(now);
            const html = renderEditPage({ archivedAt: ARCHIVED_ON, paidPostingAvailable: true, showRenewModal: true });

            expect(html, now.toISOString()).toContain(`${NOT_VISIBLE}${RESTORE_HINT}`);
            expect(html, now.toISOString()).toContain(DASHBOARD_LINK);
            expect(html, now.toISOString()).not.toContain('Renew This Job');
            expect(html, now.toISOString()).not.toContain('Renew to relist it.');
            expect(html, now.toISOString()).not.toContain('Renew Job Posting');
            expect(html, now.toISOString()).not.toContain(FREE_REPOST_LINK);
        }
    });

    it('the hint replaces Renew on a post that ends soon as well', () => {
        vi.setSystemTime(LADDER_START);
        const endsInThreeDays = new Date(LADDER_START.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
        const html = renderEditPage({ archivedAt: ARCHIVED_ON, expiresAt: endsInThreeDays, paidPostingAvailable: true });

        expect(html).toContain('>This job expires soon</h3>');
        expect(html).toContain(RESTORE_HINT);
        expect(html).not.toContain('Renew now to keep it visible.');
        expect(html).not.toContain('Renew This Job');
    });

    it('the same post unarchived offers Renew and no hint', () => {
        vi.setSystemTime(LADDER_START);
        const html = renderEditPage({ archivedAt: null, paidPostingAvailable: true });

        expect(html).toContain('Renew This Job</button>');
        expect(html).not.toContain(RESTORE_HINT);
        expect(html).not.toContain(DASHBOARD_LINK);
    });

    it('with no renewal on sale there is nothing to restore it for: the free repost during the promo, nothing after', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        const duringPromo = renderEditPage({ archivedAt: ARCHIVED_ON, paidPostingAvailable: false });
        vi.setSystemTime(LADDER_START);
        const afterPromo = renderEditPage({ archivedAt: ARCHIVED_ON, paidPostingAvailable: false });

        expect(duringPromo).toContain(`${NOT_VISIBLE}${FREE_REPOST_BANNER}`);
        expect(duringPromo).toContain(FREE_REPOST_LINK);
        expect(afterPromo).toContain(`${NOT_VISIBLE}</p>`);
        for (const html of [duringPromo, afterPromo]) {
            expect(html).not.toContain(RESTORE_HINT);
            expect(html).not.toContain(DASHBOARD_LINK);
        }
    });

    it.each(['plan', 'pending', 'refunded'])("an archived '%s' post, which never renews, gets no restore hint", (paymentStatus) => {
        vi.setSystemTime(LADDER_START);
        const html = renderEditPage({ archivedAt: ARCHIVED_ON, paymentStatus, paidPostingAvailable: true });

        expect(html).not.toContain(RESTORE_HINT);
        expect(html).not.toContain(DASHBOARD_LINK);
        expect(html).not.toContain('Renew This Job');
    });
});
