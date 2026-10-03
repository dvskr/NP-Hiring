/**
 * Backlog 2.1 loose ends (package F1): two surfaces the first wave left
 * reading the launch promo from somewhere other than the shared source.
 *
 *   1. The homepage (app/page.tsx, revalidate 60) rendered <EmployerHowItWorks />
 *      with no promoActive prop, so the client component fell back to the
 *      browser's clock. Around config.promoEndsAt the browser and the HTML
 *      the ISR page served can disagree, which is a hydration mismatch on the
 *      CTA ("Post a Job (Free Through ...)" against "Post a Job"). The page
 *      now decides the phase on its own render clock and passes it down, as
 *      app/for-employers/page.tsx does.
 *   2. lib/email-service.ts printed its own 'Simple per-post pricing' literal
 *      as the ladder-phase email headline instead of LADDER_HEADLINE, the
 *      words /pricing and /for-employers print, so the two could drift.
 *
 * The homepage is never rendered here: Home() returns its element tree, and
 * the test reads the props it hands EmployerHowItWorks. The data reads and
 * the other sections are stubbed, so nothing reaches a database.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

vi.mock('@/lib/site-stats', () => ({
    getSiteStats: vi.fn().mockResolvedValue({ totalJobs: 638, totalCompanies: 131 }),
}));
vi.mock('@/lib/homepage-links', () => ({ getIndexableLandingSlugs: vi.fn().mockResolvedValue([]) }));
// The other sections read the database, the blog or the browser; Home() only
// places them in its tree, so stubs keep the import free of all of that.
vi.mock('@/components/HomepageHero', () => ({ default: () => null }));
vi.mock('@/components/EmployerTrustSection', () => ({ default: () => null }));
vi.mock('@/components/FeaturedJobsSection', () => ({ default: () => null }));
vi.mock('@/components/TopStatesSection', () => ({ default: () => null }));
vi.mock('@/components/VideoJsonLd', () => ({ default: () => null }));
vi.mock('@/components/HomepageBlogSection', () => ({ default: () => null }));
vi.mock('@/components/HomepageFAQ', () => ({ default: () => null }));
vi.mock('@/components/ExitIntentPopup', () => ({ default: () => null }));

import { config } from '@/lib/config';
import { LADDER_HEADLINE } from '@/lib/pricing-copy';
import EmployerHowItWorks from '@/components/EmployerHowItWorks';
import Home, { revalidate } from '@/app/page';

const DURING_PROMO = new Date('2026-12-31T12:00:00.000Z');
const LAST_PROMO_SECOND = new Date('2027-01-01T09:59:59.000Z');
const LADDER_START = new Date(config.promoEndsAt);
const LATER = new Date('2027-03-15T12:00:00.000Z');

/** The page module pulls in a large dependency tree on its first import. */
const COLD_IMPORT_TIMEOUT_MS = 120_000;

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Source without block, line and JSX comments, so prose about a literal does not count as one. */
const code = (src: string) =>
    src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

/** Every element in a tree, depth first. Components are not called, so nothing renders. */
function elementsOf(node: ReactNode): ReactElement[] {
    if (Array.isArray(node)) return node.flatMap(elementsOf);
    if (!isValidElement<{ children?: ReactNode }>(node)) return [];
    return [node, ...elementsOf(node.props.children)];
}

/** The props Home() hands EmployerHowItWorks when it renders with the clock at `now`. */
async function howItWorksPropsAt(now: Date): Promise<{ promoActive?: boolean }> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
        const tree = await Home();
        const bands = elementsOf(tree).filter((element) => element.type === EmployerHowItWorks);
        expect(bands, 'the homepage renders the employer band exactly once').toHaveLength(1);
        return bands[0].props as { promoActive?: boolean };
    } finally {
        vi.useRealTimers();
    }
}

afterEach(() => {
    vi.useRealTimers();
});

describe('the homepage decides the employer band phase on its own render clock', () => {
    it('passes promoActive true while the promo runs, up to its last second', async () => {
        for (const now of [DURING_PROMO, LAST_PROMO_SECOND]) {
            const props = await howItWorksPropsAt(now);
            expect(props.promoActive, now.toISOString()).toBe(true);
        }
    }, COLD_IMPORT_TIMEOUT_MS);

    it('passes promoActive false from config.promoEndsAt, from the same imported module', async () => {
        for (const now of [LADDER_START, LATER]) {
            const props = await howItWorksPropsAt(now);
            expect(props.promoActive, now.toISOString()).toBe(false);
        }
    }, COLD_IMPORT_TIMEOUT_MS);

    it('re-renders at least hourly, like every page whose copy follows the promo clock, so the flag switches without a deploy', () => {
        expect(revalidate).toBeGreaterThan(0);
        expect(revalidate).toBeLessThanOrEqual(3600);
    });
});

describe('the ladder-phase email headline comes from lib/pricing-copy', () => {
    it('lib/email-service.ts imports LADDER_HEADLINE and carries no headline literal of its own', () => {
        const src = read('lib/email-service.ts');
        expect(src).toMatch(/import \{[^}]*\bLADDER_HEADLINE\b[^}]*\} from '@\/lib\/pricing-copy'/);
        expect(code(src)).toMatch(/headline: LADDER_HEADLINE\b/);
        expect(code(src)).not.toContain(LADDER_HEADLINE);
    });
});
