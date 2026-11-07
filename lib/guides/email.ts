/**
 * The delivery email of the guides store: the reader's link back to their
 * library from any device. One email type for both ways a reader gets
 * guides, a Stripe purchase and a launch-promo claim (POST /api/guides/claim);
 * the claim wording names no amount and no receipt, because nothing was paid.
 *
 * Transactional ('guide_purchase', the transactional sender, no unsubscribe
 * link): the reader asked for it, and it is the only way back to the
 * downloads, so suppressing it would cost them what they bought.
 */
import type { GuidePurchase } from '@prisma/client';
import { brand } from '@/config/brand';
import { logger } from '@/lib/logger';
import { escapeHtml } from '@/lib/sanitize';
import { sendAndLog } from '@/lib/email-service';
import {
    bodyTextV2,
    closeContentV2,
    contactFooterV2,
    emailShellV2,
    headerBlockV2,
    mutedTextV2,
    primaryButtonV2,
    spacerV2,
    SANS,
    V2,
} from '@/lib/email-templates-v2';
import { GUIDES, getProduct, isGuideSlug } from './catalog';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl).replace(/\/$/, '');

/** The link in the delivery email: opens the reader's library on any device. */
export function libraryLink(accessToken: string): string {
    return `${BASE_URL}/guides/library/${accessToken}`;
}

/** What the email needs from a purchase row. */
export type GuideEmailPurchase = Pick<GuidePurchase, 'source' | 'productSlug' | 'guideSlugs' | 'accessToken'>;

/**
 * The opening line for the three shapes a delivery takes: one guide, a guide
 * plus the add-on (bought only), and a bundle. A bundle is named; anything
 * else lets the list of guides speak for itself. A claim thanks nobody for a
 * purchase.
 */
function introFor(isClaim: boolean, productTitle: string | null, isBundle: boolean, titles: readonly string[]): string {
    if (titles.length === 1) {
        const ready = `<strong>${escapeHtml(titles[0])}</strong> is ready to download.`;
        return isClaim ? ready : `Thank you for your purchase. ${ready}`;
    }
    if (isBundle && productTitle) {
        const all = `All ${titles.length} guides are ready to download.`;
        return isClaim
            ? `Here is the <strong>${escapeHtml(productTitle)}</strong>. ${all}`
            : `Thank you for buying the <strong>${escapeHtml(productTitle)}</strong>. ${all}`;
    }
    return isClaim ? 'These guides are ready to download:' : 'Thank you for your purchase. These guides are ready to download:';
}

export function guidePurchaseEmailContent(purchase: GuideEmailPurchase): { subject: string; html: string } {
    const isClaim = purchase.source === 'promo';
    const product = getProduct(purchase.productSlug);
    const titles = purchase.guideSlugs.filter(isGuideSlug).map((slug) => GUIDES[slug].title);
    const single = titles.length === 1;
    const subject = single ? `Your guide is ready: ${titles[0]}` : `Your ${titles.length} NP guides are ready`;
    const intro = introFor(isClaim, product?.title ?? null, product?.kind === 'bundle', titles);
    const list = titles
        .map((title) => `<li style="margin:0 0 6px;font-family:${SANS};font-size:15px;color:${V2.textBody};">${escapeHtml(title)}</li>`)
        .join('');
    const note = `This link opens your ${single ? 'guide' : 'guides'} on any device, so keep this email. Every download is the latest edition.`;

    const html = emailShellV2(
        `
      ${headerBlockV2(single ? 'Your guide is ready' : 'Your guides are ready', '')}
      ${spacerV2(12)}
      <tr><td class="content-pad" style="padding:0 40px;">${bodyTextV2(intro)}</td></tr>
      ${spacerV2(20)}
      <tr><td class="content-pad" style="padding:0 40px;"><ul style="margin:0;padding-left:20px;">${list}</ul></td></tr>
      ${spacerV2(24)}
      <tr><td class="content-pad" style="padding:0 40px;text-align:center;">${primaryButtonV2(single ? 'Open your guide' : 'Open your guides', libraryLink(purchase.accessToken))}</td></tr>
      ${spacerV2(24)}
      <tr><td class="content-pad" style="padding:0 40px;">${mutedTextV2(note)}</td></tr>
      ${spacerV2(40)}
      ${closeContentV2()}`,
        contactFooterV2(),
        single ? `${titles[0]} is ready to download.` : `${titles.length} guides are ready to download.`,
    );
    return { subject, html };
}

/**
 * What became of a delivery attempt. 'retry' is a provider or network failure
 * worth trying again; 'refused' will fail the same way every time (an
 * address the provider rejects as invalid, or no address at all).
 */
export type GuideEmailResult = 'sent' | 'retry' | 'refused';

/**
 * Resend error names that a retry of the same message cannot fix: a
 * recipient or field Resend rejects. Account and quota errors (an API key,
 * the sending domain, a rate or daily limit) stay 'retry', because they clear
 * once fixed or reset and Stripe's retries then deliver the email.
 */
const PERMANENT_EMAIL_ERRORS: ReadonlySet<string> = new Set(['validation_error', 'missing_required_field', 'invalid_parameter']);

/**
 * The Resend error name on a failed send. sendAndLog (lib/email-service.ts)
 * throws on a Resend API error and carries the name as `resendErrorName`; a
 * network failure carries none.
 */
function resendErrorName(error: unknown): string | null {
    const name = (error as { resendErrorName?: unknown } | null)?.resendErrorName;
    return typeof name === 'string' ? name : null;
}

/** Send the delivery email. Never throws. */
export async function sendGuidePurchaseEmail(purchase: GuidePurchase): Promise<GuideEmailResult> {
    if (!purchase.email) return 'refused';
    const { subject, html } = guidePurchaseEmailContent(purchase);
    try {
        await sendAndLog(
            { from: '', to: purchase.email, subject, html },
            'guide_purchase',
            { purchaseId: purchase.id, productSlug: purchase.productSlug, source: purchase.source },
        );
        return 'sent';
    } catch (error) {
        const errorName = resendErrorName(error);
        logger.error('Guide delivery email failed', error, { purchaseId: purchase.id, errorName: errorName ?? undefined });
        return errorName && PERMANENT_EMAIL_ERRORS.has(errorName) ? 'refused' : 'retry';
    }
}
