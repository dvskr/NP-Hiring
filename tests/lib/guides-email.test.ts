/**
 * The delivery email is the reader's only way back to their library from
 * another device, so it must carry the library link, go out as a
 * transactional message (no unsubscribe), and follow the copy rules (no
 * dashes). A launch-promo claim (source 'promo') names no amount and no
 * purchase; a Stripe purchase thanks the buyer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/email-service', () => ({ sendAndLog: vi.fn() }));

import { sendAndLog } from '@/lib/email-service';
import { guidePurchaseEmailContent, libraryLink, sendGuidePurchaseEmail } from '@/lib/guides/email';
import { GUIDE_SLUGS } from '@/lib/guides/catalog';
import type { GuidePurchase } from '@prisma/client';

const TOKEN = 'e'.repeat(48);
const purchase = {
    id: 'gp_1',
    source: 'stripe',
    email: 'buyer@example.com',
    accessToken: TOKEN,
    productSlug: 'complete-library',
    guideSlugs: [...GUIDE_SLUGS],
} as unknown as GuidePurchase;

/** Visible text only: the shared shell's CSS comments are not copy. */
const visible = (html: string): string => html.replace(/<style[\s\S]*?<\/style>/g, '');

beforeEach(() => {
    vi.clearAllMocks();
});

describe('guide delivery email', () => {
    it('links to the library route that moves the token into a cookie', () => {
        expect(libraryLink(TOKEN)).toMatch(new RegExp(`/guides/library/${TOKEN}$`));
        const { html } = guidePurchaseEmailContent(purchase);
        expect(html).toContain(`/guides/library/${TOKEN}`);
    });

    it('names every guide and the product, without dashes', () => {
        const { subject, html } = guidePurchaseEmailContent(purchase);
        expect(subject).toBe('Your 6 NP guides are ready');
        expect(html).toContain('Complete NP Library');
        expect(html).toContain('Launch Your NP Practice');
        expect(`${subject}${visible(html)}`).not.toMatch(/[–—]/);
    });

    it('names a single guide in the subject and speaks in the singular', () => {
        const { subject, html } = guidePurchaseEmailContent({ ...purchase, productSlug: 'interview-prep-pack', guideSlugs: ['interview-prep-pack'] });
        expect(subject).toBe('Your guide is ready: NP Interview Prep Pack');
        expect(html).toContain('Your guide is ready');
        expect(html).toContain('Open your guide<');
        expect(html).not.toContain('Your guides are ready');
    });

    it('reads naturally for a guide bought with the add-on', () => {
        const { subject, html } = guidePurchaseEmailContent({
            ...purchase,
            productSlug: 'telehealth-playbook',
            guideSlugs: ['telehealth-playbook', 'compensation-report'],
        });
        expect(subject).toBe('Your 2 NP guides are ready');
        expect(html).toContain('These guides are ready to download:');
        expect(html).not.toMatch(/the The|Both guides/);
        expect(html).toContain('The Telehealth NP Playbook');
        expect(html).toContain('2026 NP Compensation Report');
    });

    it('thanks a buyer for the purchase', () => {
        const { html } = guidePurchaseEmailContent(purchase);
        expect(html).toContain('Thank you for buying the <strong>Complete NP Library</strong>');
        expect(html).toContain('Every download is the latest edition.');
        expect(html).not.toContain('free updates');
    });

    it('words a promo claim without a purchase, an amount or a receipt', () => {
        const claim = { ...purchase, source: 'promo' };
        const bundle = visible(guidePurchaseEmailContent(claim).html);
        expect(bundle).toContain('Here is the <strong>Complete NP Library</strong>. All 6 guides are ready to download.');
        const single = visible(guidePurchaseEmailContent({ ...claim, productSlug: 'interview-prep-pack', guideSlugs: ['interview-prep-pack'] }).html);
        expect(single).toContain('<strong>NP Interview Prep Pack</strong> is ready to download.');
        for (const html of [bundle, single]) {
            expect(html).not.toMatch(/purchase|buying|receipt|\$\d|free/i);
            expect(html).not.toMatch(/[–—]/);
            expect(html).toContain(`/guides/library/${TOKEN}`);
        }
    });

    it('is sent as a transactional guide_purchase message with no unsubscribe link', async () => {
        vi.mocked(sendAndLog).mockResolvedValueOnce({ data: { id: 'm1' }, error: null } as never);
        expect(await sendGuidePurchaseEmail(purchase)).toBe('sent');
        const [params, type, metadata, unsubscribe] = vi.mocked(sendAndLog).mock.calls[0];
        expect(type).toBe('guide_purchase');
        expect(params.to).toBe('buyer@example.com');
        expect(metadata).toEqual({ purchaseId: 'gp_1', productSlug: 'complete-library', source: 'stripe' });
        expect(unsubscribe).toBeUndefined();
    });

    it('asks for a retry on a provider or network failure, and not on a permanent refusal', async () => {
        // sendAndLog throws on a Resend API error, carrying its name.
        vi.mocked(sendAndLog).mockRejectedValueOnce(Object.assign(new Error('Email send failed'), { resendErrorName: 'rate_limit_exceeded' }));
        expect(await sendGuidePurchaseEmail(purchase)).toBe('retry');
        vi.mocked(sendAndLog).mockRejectedValueOnce(new Error('network'));
        expect(await sendGuidePurchaseEmail(purchase)).toBe('retry');
        vi.mocked(sendAndLog).mockRejectedValueOnce(Object.assign(new Error('Email send failed'), { resendErrorName: 'validation_error' }));
        expect(await sendGuidePurchaseEmail(purchase)).toBe('refused');
    });

    it('refuses a row with no address without calling the provider', async () => {
        expect(await sendGuidePurchaseEmail({ ...purchase, email: null })).toBe('refused');
        expect(sendAndLog).not.toHaveBeenCalled();
    });
});
