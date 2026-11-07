/**
 * The guides store's copy that changes with the phase (lib/guides/phase.ts):
 * the hero pills, the FAQ, the product page's fine print and the metadata
 * sentence. Every builder takes `now` and is called per render, so on
 * config.promoEndsAt the store stops offering free claims and states the
 * price, all sales final, without a deploy. The price blocks themselves come
 * from guidePriceCopy, never from here.
 */
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { guidePhase } from '@/lib/guides/phase';

/** One question and its answer, as StickerAccordion renders them. */
export interface GuidesFaq {
    readonly question: string;
    readonly answer: string;
}

/** The facts shown as pills under the store hero and on each product page. */
export interface GuidesPill {
    readonly key: 'pdf' | 'download' | 'account' | 'purchase' | 'stripe';
    readonly label: string;
}

const SUPPORT = brand.email.support;

/** Pills true in both phases. */
const BOTH_PHASE_PILLS: readonly GuidesPill[] = [
    { key: 'download', label: 'Instant download' },
    { key: 'account', label: 'No account needed' },
];

export function guidesStorePills(now: Date): GuidesPill[] {
    const paid = guidePhase(now) === 'paid';
    return [
        { key: 'pdf', label: 'PDF guides' },
        ...BOTH_PHASE_PILLS,
        ...(paid ? [{ key: 'purchase', label: 'One-time purchase' } as const, { key: 'stripe', label: 'Secure checkout by Stripe' } as const] : []),
    ];
}

/** The line under a product page's action. Null while the guides are free: the form says what happens. */
export function guidesFinePrint(now: Date): string | null {
    if (guidePhase(now) === 'promo') return null;
    return 'Secure checkout by Stripe. Your guides open right away and we email you a link for any device. All sales are final.';
}

/** The sentence a product's metadata description ends with. */
export function guidesMetaSentence(now: Date): string {
    if (guidePhase(now) === 'promo') return `Free to claim through ${config.promoEndsLabel}.`;
    return 'One-time purchase. All sales are final.';
}

/** The store FAQ for `now`: the same questions in both phases where the answer allows it. */
export function guidesFaqs(now: Date): GuidesFaq[] {
    const promo = guidePhase(now) === 'promo';
    return [
        {
            question: 'What format are the guides?',
            answer: 'Each guide is a PDF you can read on a phone, tablet or computer, or print. Every guide page lists its chapters and its page count.',
        },
        promo
            ? {
                question: 'How do I get my guides?',
                answer: 'Enter your email address on any guide or bundle and we email you a private link to your library. It opens your guides on any device. Keep that email: the link is how you get back to your library.',
            }
            : {
                question: 'How do I get my guides after I pay?',
                answer: 'Your guides open in this browser as soon as checkout finishes, and we email you a private link that opens them on any other device. Keep that email: the link is how you get back to your library.',
            },
        promo
            ? { question: 'Do I need an account?', answer: 'No. We ask only for an email address, to send you your library link.' }
            : { question: 'Do I need an account?', answer: 'No. Checkout asks only for an email address, for your receipt and your library link.' },
        ...(promo
            ? [{
                question: 'How long can I claim the guides?',
                answer: `Every guide and bundle can be claimed at no cost through ${config.promoEndsLabel}. Guides you claim stay in your library. After that date, each guide and bundle is a one-time purchase at the price shown on its page.`,
            }]
            : []),
        {
            question: 'Do the guides get updated?',
            answer: 'Yes. When we revise a guide, for example after a rule change or a new pay data release, your library serves the new edition.',
        },
        promo
            ? { question: 'What if a file will not open?', answer: `Email ${SUPPORT} and we will put it right.` }
            : {
                question: 'Can I get a refund?',
                answer: `All sales are final because the guides are instant digital downloads. Each guide page lists every chapter so you can check the contents before you buy. If a file will not open or a download fails, email ${SUPPORT} and we will put it right.`,
            },
        {
            question: 'Can I get the guides for a class, a residency program or a practice?',
            answer: `Yes. Email ${SUPPORT} with the number of people and we will set up group access.`,
        },
        {
            question: 'Is the job board still free for job seekers?',
            answer: 'Yes. Searching jobs, job alerts, saving jobs and applying are free. The guides are optional.',
        },
    ];
}
