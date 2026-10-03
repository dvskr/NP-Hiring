/**
 * POST /api/outreach { action: 'render-template' } answers a refused template
 * with 409 and the service's reason (backlog 2.1, package F1).
 *
 * lib/outreach-service#renderTemplate refuses the freeOffer template once the
 * launch promo has ended (OutreachTemplateUnavailableError): it pitches free
 * posting, which nobody can buy any more. The admin page lists only the
 * templates on offer, but a page loaded before config.promoEndsAt still shows
 * freeOffer. Before this change the route let the refusal fall through to
 * its catch-all: a 500 "Failed to process outreach request", logged as a
 * server failure. Now:
 *   - freeOffer after the promo  → 409 { success: false, error: <the reason> },
 *     with nothing logged as an error;
 *   - every other failure        → still the logged 500;
 *   - template names are validated against the service's own list
 *     (OUTREACH_TEMPLATE_NAMES), and the admin gate runs first, unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const adminMocks = vi.hoisted(() => ({ requireApiAdmin: vi.fn() }));
vi.mock('@/lib/auth/require-api-admin', () => adminMocks);

const loggerMock = vi.hoisted(() => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/logger', () => loggerMock);

// The real service, with renderTemplate wrapped so one test can make it fail
// for a reason other than the promo.
const serviceMocks = vi.hoisted(() => ({ renderTemplate: vi.fn() }));
vi.mock('@/lib/outreach-service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/outreach-service')>();
    serviceMocks.renderTemplate.mockImplementation(actual.renderTemplate);
    return { ...actual, renderTemplate: serviceMocks.renderTemplate };
});

import { config } from '@/lib/config';
import { brand } from '@/config/brand';
import { LADDER_PRICES } from '@/lib/pricing-copy';
import { OutreachTemplateUnavailableError } from '@/lib/outreach-service';
import { POST } from '@/app/api/outreach/route';

const DURING_PROMO = new Date('2026-12-31T12:00:00.000Z');
const LAST_PROMO_SECOND = new Date('2027-01-01T09:59:59.000Z');
const LADDER_START = new Date(config.promoEndsAt);
const LATER = new Date('2027-03-15T12:00:00.000Z');
const VARIABLES = { companyName: 'Riverside Clinic', contactName: 'Dana' };

function request(body: object): NextRequest {
    return new NextRequest('https://test.local/api/outreach', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

/** POST the render-template action with the clock at `now`. */
async function renderAt(now: Date, templateName: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    vi.setSystemTime(now);
    const res = await POST(request({ action: 'render-template', templateName, variables: VARIABLES }));
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    adminMocks.requireApiAdmin.mockResolvedValue(null);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('freeOffer after the launch promo', () => {
    it('answers 409 with the service reason, never the generic 500', async () => {
        for (const now of [LADDER_START, LATER]) {
            const { status, json } = await renderAt(now, 'freeOffer');
            expect(status, now.toISOString()).toBe(409);
            expect(json).toEqual({ success: false, error: new OutreachTemplateUnavailableError('freeOffer').message });
        }
    });

    it('says why and what to use instead, which the admin page shows as the toast', async () => {
        const { json } = await renderAt(LADDER_START, 'freeOffer');
        expect(json.error).toBe(
            `The freeOffer template is no longer available: free posting ran through ${config.promoEndsLabel}. Use the initial or followUp template, which state the current prices.`,
        );
    });

    it('is not logged as a server failure', async () => {
        await renderAt(LADDER_START, 'freeOffer');
        expect(loggerMock.logger.error).not.toHaveBeenCalled();
    });
});

describe('what still renders', () => {
    it('freeOffer while the promo runs, up to its last second', async () => {
        for (const now of [DURING_PROMO, LAST_PROMO_SECOND]) {
            const { status, json } = await renderAt(now, 'freeOffer');
            expect(status, now.toISOString()).toBe(200);
            const data = json.data as { subject: string; body: string };
            expect(data.subject).toBe(`Free ${brand.niche.short} job posting for Riverside Clinic`);
            expect(data.body).toContain(`free during our launch period through ${config.promoEndsLabel}`);
        }
    });

    it('initial and followUp after the promo, at the ladder price', async () => {
        for (const templateName of ['initial', 'followUp']) {
            const { status, json } = await renderAt(LADDER_START, templateName);
            expect(status, templateName).toBe(200);
            const data = json.data as { subject: string; body: string };
            expect(data.body, templateName).toContain(LADDER_PRICES);
            expect(data.body, templateName).toContain('Hi Dana,');
        }
    });
});

describe('every other outcome is unchanged', () => {
    it('any other render failure is still the logged 500', async () => {
        serviceMocks.renderTemplate.mockImplementationOnce(() => {
            throw new Error('template store unreadable');
        });
        const { status, json } = await renderAt(DURING_PROMO, 'initial');
        expect(status).toBe(500);
        expect(json).toMatchObject({ success: false, error: 'Failed to process outreach request', details: 'template store unreadable' });
        expect(loggerMock.logger.error).toHaveBeenCalledWith('Error processing outreach request:', expect.any(Error));
    });

    it('an unknown template name is a 400 listing the service template names, and nothing renders', async () => {
        for (const templateName of ['partnerOffer', 42]) {
            const { status, json } = await renderAt(LADDER_START, templateName);
            expect(status, String(templateName)).toBe(400);
            expect(json).toEqual({ success: false, error: 'Invalid template name. Valid options: initial, followUp, freeOffer' });
        }
        expect(serviceMocks.renderTemplate).not.toHaveBeenCalled();
    });

    it('missing fields are still a 400', async () => {
        vi.setSystemTime(LADDER_START);
        const res = await POST(request({ action: 'render-template', templateName: 'freeOffer', variables: {} }));
        expect(res.status).toBe(400);
        expect(serviceMocks.renderTemplate).not.toHaveBeenCalled();
    });

    it('the admin gate runs first: a non-admin gets its answer and nothing renders', async () => {
        adminMocks.requireApiAdmin.mockResolvedValue(NextResponse.json({ error: 'Admin access required' }, { status: 403 }));
        const { status, json } = await renderAt(LADDER_START, 'freeOffer');
        expect(status).toBe(403);
        expect(json).toEqual({ error: 'Admin access required' });
        expect(adminMocks.requireApiAdmin).toHaveBeenCalledTimes(1);
        expect(serviceMocks.renderTemplate).not.toHaveBeenCalled();
    });
});
