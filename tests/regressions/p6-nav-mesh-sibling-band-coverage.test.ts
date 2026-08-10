/**
 * P6 completeness hole #6 (nav-mesh) — six category hubs (oncology,
 * cardiology, orthopedic, aesthetics, pain-management, palliative-hospice)
 * had no deterministic inbound link: the "Related Categories" sibling band
 * in lib/pseo/category-landing-template.tsx sliced the FIRST 6 of the
 * 17-slug specialty axis, so the axis tail never appeared in any landing's
 * band, and Footer seeds / salary cross-links miss these slugs too.
 *
 * The fix rotates the band deterministically: each landing's band starts
 * just after its own axis position and wraps around, so every axis slug
 * appears in the bands of the `limit` slugs preceding it.
 *
 * These tests pin the invariant that prevents recurrence:
 *   1. band mechanics — deterministic, self-excluding, same-axis,
 *      min(limit, axisLen-1) sized;
 *   2. FULL COVERAGE — every slug of every multi-member axis appears in at
 *      least one other slug's band (function-level, all 45 slugs);
 *   3. end-to-end for the specialty axis (the stranded one): every
 *      specialty slug appears in the band of at least one OTHER specialty
 *      landing whose app/jobs/<host>/page.tsx actually renders the shared
 *      template — so the inbound link really exists in the shipped HTML;
 *   4. the six previously-stranded hubs are pinned by name.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { axisSiblings } from '@/lib/pseo/category-landing-template';
import { CATEGORY_AXES, ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';

const ROOT = process.cwd();
const BAND_LIMIT = 6; // axisSiblings' default `limit`

const PREVIOUSLY_STRANDED = [
    'oncology', 'cardiology', 'orthopedic',
    'aesthetics', 'pain-management', 'palliative-hospice',
] as const;

/** slug -> set of slugs whose sibling band links to it. */
const buildInboundMap = (): Map<string, Set<string>> => {
    const inbound = new Map<string, Set<string>>(
        ALL_CATEGORY_SLUGS.map((slug) => [slug, new Set<string>()]),
    );
    for (const host of ALL_CATEGORY_SLUGS) {
        for (const target of axisSiblings(host)) {
            inbound.get(target)?.add(host);
        }
    }
    return inbound;
};

describe('P6 #6 — sibling band mechanics', () => {
    it('is deterministic (stable band per slug)', () => {
        for (const slug of ALL_CATEGORY_SLUGS) {
            expect(axisSiblings(slug)).toEqual(axisSiblings(slug));
        }
    });

    it('never links a landing to itself and stays on its own axis', () => {
        for (const [axisName, axisSlugs] of Object.entries(CATEGORY_AXES)) {
            const axisSet = new Set<string>(axisSlugs);
            for (const slug of axisSlugs) {
                const band = axisSiblings(slug);
                expect(band, `${axisName}/${slug}: band contains itself`).not.toContain(slug);
                for (const sibling of band) {
                    expect(axisSet.has(sibling), `${axisName}/${slug}: off-axis sibling "${sibling}"`).toBe(true);
                }
                expect(new Set(band).size, `${axisName}/${slug}: duplicate band entries`).toBe(band.length);
            }
        }
    });

    it('fills the band to min(limit, axisLen - 1) on every axis', () => {
        for (const [axisName, axisSlugs] of Object.entries(CATEGORY_AXES)) {
            const expected = Math.min(BAND_LIMIT, axisSlugs.length - 1);
            for (const slug of axisSlugs) {
                expect(axisSiblings(slug).length, `${axisName}/${slug}`).toBe(expected);
            }
        }
    });

    it('returns [] for a slug outside the taxonomy', () => {
        expect(axisSiblings('not-a-category')).toEqual([]);
    });
});

describe('P6 #6 — full coverage: no hub is stranded from the band mesh', () => {
    it('every slug of every multi-member axis appears in at least one other slug\'s band', () => {
        const inbound = buildInboundMap();
        const stranded = ALL_CATEGORY_SLUGS.filter(
            (slug) => (inbound.get(slug)?.size ?? 0) === 0,
        );
        expect(
            stranded,
            `Slugs with ZERO sibling-band inbound (the head-slice regression): ${stranded.join(', ')}`,
        ).toEqual([]);
    });

    it('every specialty slug is banded by a landing that actually renders the template', () => {
        // The band only exists in shipped HTML when the host page renders
        // CategoryLandingPage — bespoke landings don't carry it. All 17
        // specialty pages are template wrappers; if one is rewritten bespoke,
        // this catches the coverage hole the rewrite would open.
        const inbound = buildInboundMap();
        const rendersTemplate = (slug: string): boolean => {
            const pagePath = path.join(ROOT, 'app', 'jobs', slug, 'page.tsx');
            if (!fs.existsSync(pagePath)) return false;
            return fs.readFileSync(pagePath, 'utf8').includes('category-landing-template');
        };
        for (const slug of CATEGORY_AXES.specialty) {
            const hosts = [...(inbound.get(slug) ?? [])].filter(rendersTemplate);
            expect(
                hosts.length,
                `specialty "${slug}" appears in no template-rendered landing's band`,
            ).toBeGreaterThan(0);
        }
    });

    it.each(PREVIOUSLY_STRANDED)(
        'previously-stranded hub "%s" now has deterministic sibling-band inbound',
        (slug) => {
            const inbound = buildInboundMap();
            const hosts = inbound.get(slug);
            expect(hosts && hosts.size, `no landing bands "${slug}"`).toBeGreaterThan(0);
        },
    );
});
