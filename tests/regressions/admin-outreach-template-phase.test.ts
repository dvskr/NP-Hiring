/**
 * /admin/outreach lists the freeOffer template only while the launch promo
 * runs (backlog 2.1, package R1).
 *
 * Before: the page was one client component that always listed
 * ['initial', 'followUp', 'freeOffer'], with a "Launch promo: free featured
 * posts through December 31, 2026" blurb, so in 2027 it would keep offering
 * a free-posting pitch until a deploy.
 *
 * After: app/admin/outreach/page.tsx is a force-dynamic server page that
 * asks lib/outreach-service#availableOutreachTemplates for the list at
 * request time and hands it to the client UI, which renders exactly that
 * list and decides no phase itself.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { config } from '@/lib/config';
import OutreachPage, { dynamic } from '@/app/admin/outreach/page';
import OutreachClient, { OutreachTemplateList } from '@/app/admin/outreach/OutreachClient';

const LAST_PROMO_SECOND = new Date('2027-01-01T09:59:59.000Z');
const LADDER_START = new Date(config.promoEndsAt);
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** What the server page hands the client UI. */
function pageProps(): { templates: string[] } {
    const element = OutreachPage() as { type: unknown; props: { templates: string[] } };
    expect(element.type).toBe(OutreachClient);
    return element.props;
}

function renderList(templates: ('initial' | 'followUp' | 'freeOffer')[]): string {
    return renderToStaticMarkup(createElement(OutreachTemplateList, { templates, copiedTemplate: null, onCopy: () => {} }));
}

afterEach(() => {
    vi.useRealTimers();
});

describe('the server page decides the template list per request', () => {
    it('is never statically cached with a promo decision', () => {
        expect(dynamic).toBe('force-dynamic');
    });

    it('lists freeOffer up to the last promo second and drops it at config.promoEndsAt', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(LAST_PROMO_SECOND);
        expect(pageProps().templates).toEqual(['initial', 'followUp', 'freeOffer']);

        // Same imported module, next request: nothing was frozen at load.
        vi.setSystemTime(LADDER_START);
        expect(pageProps().templates).toEqual(['initial', 'followUp']);
    });
});

describe('the client UI renders exactly the list it is given', () => {
    it('during the promo: three cards, with the dated free-offer blurb', () => {
        const html = renderList(['initial', 'followUp', 'freeOffer']);
        expect(html).toContain('Initial Outreach');
        expect(html).toContain('Follow Up');
        expect(html).toContain('Free Offer');
        expect(html).toContain(`Launch promo: free featured posts through ${config.promoEndsLabel}`);
    });

    it('after the promo: no free offer anywhere on the card list', () => {
        const html = renderList(['initial', 'followUp']);
        expect(html).toContain('Initial Outreach');
        expect(html).toContain('Follow Up');
        expect(html).not.toContain('Free Offer');
        expect(html).not.toMatch(/\bfree\b|launch promo/i);
    });

    it('never decides the promo phase itself', () => {
        const src = read('app/admin/outreach/OutreachClient.tsx');
        expect(src.startsWith("'use client'")).toBe(true);
        expect(src).not.toContain('isPromoActive');
        expect(src).not.toMatch(/\[\s*'initial',\s*'followUp',\s*'freeOffer'\s*\]/);
    });

    it('surfaces a refused template instead of failing silently', () => {
        // e.g. freeOffer clicked on a page loaded just before the promo ended:
        // POST /api/outreach answers success:false with the service's reason.
        const src = read('app/admin/outreach/OutreachClient.tsx');
        expect(src).toMatch(/if \(!data\.success\) \{[\s\S]{0,200}toast\(data\.details \|\| data\.error/);
    });
});
