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
 *
 * Also here: the 'update' action reads the lead id as a plain string. The id is
 * the lookup key of the findUnique and the update in updateLeadStatus, and a
 * JSON body can carry an object or a number there, which Prisma rejects (500).
 * The route answers 400 before any query (lib/request-body.ts). Admin only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

/** Lead ids a JSON body can carry that are not a plain non-empty string. */
const BAD_LEAD_IDS: Array<[string, unknown]> = [
    ['a not filter', { not: '' }],
    ['a startsWith filter', { startsWith: 'lead' }],
    ['an array', ['lead-1']],
    ['a number', 12345],
    ['a boolean', true],
    ['null', null],
    ['no value', undefined],
    ['an empty string', ''],
    ['an overlong string', 'a'.repeat(201)],
];

describe("the 'update' action reads the lead id as a plain string", () => {
    it.each(BAD_LEAD_IDS)('refuses %s as the lead id with 400 and no query', async (_label, id) => {
        const res = await POST(request({ action: 'update', id, status: 'contacted', notes: 'Called the clinic' }));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ success: false, error: 'Missing required fields: id and status' });
        expect(prisma.employerLead.findUnique).not.toHaveBeenCalled();
        expect(prisma.employerLead.update).not.toHaveBeenCalled();
    });

    it('still updates the lead by equality on a string id', async () => {
        const res = await POST(request({ action: 'update', id: 'lead-1', status: 'contacted' }));
        expect(res.status).toBe(200);
        expect(prisma.employerLead.update).toHaveBeenCalledWith({
            where: { id: 'lead-1' },
            data: { status: 'contacted', contactedAt: expect.any(Date) },
        });
    });

    it('still reads the stored notes by equality before it appends one', async () => {
        vi.mocked(prisma.employerLead.findUnique).mockResolvedValue({ notes: 'First call' } as never);
        const res = await POST(request({ action: 'update', id: 'lead-1', status: 'replied', notes: 'Asked for pricing' }));
        expect(res.status).toBe(200);
        expect(prisma.employerLead.findUnique).toHaveBeenCalledWith({ where: { id: 'lead-1' }, select: { notes: true } });
        expect(prisma.employerLead.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'lead-1' } }));
    });

    it('still requires a status', async () => {
        const res = await POST(request({ action: 'update', id: 'lead-1' }));
        expect(res.status).toBe(400);
        expect(prisma.employerLead.update).not.toHaveBeenCalled();
    });

    it('the admin gate runs first: a non-admin gets its answer and nothing is queried', async () => {
        adminMocks.requireApiAdmin.mockResolvedValue(NextResponse.json({ error: 'Admin access required' }, { status: 403 }));
        const res = await POST(request({ action: 'update', id: { not: '' }, status: 'contacted' }));
        expect(res.status).toBe(403);
        expect(prisma.employerLead.findUnique).not.toHaveBeenCalled();
        expect(prisma.employerLead.update).not.toHaveBeenCalled();
    });
});
