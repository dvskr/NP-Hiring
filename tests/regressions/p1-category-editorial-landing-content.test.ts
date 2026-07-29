/**
 * Regression guards — P1 #5 (category-editorial package, 2026-07-29).
 *
 * The 19 template-driven category landings gained bespoke editorial from
 * lib/pseo/category-landing-content.ts, and the setting-state specialty
 * factory (lib/pseo/setting-state-config.ts) now requires bespoke
 * benefits/tips per specialty (the shared defaults that rendered
 * byte-identical copy across every specialty × state page set are gone).
 *
 * TRUTH RULES pinned here:
 *   - every dollar figure in the editorial derives from lib/stats-sources.ts
 *     (cited BLS median) or config/niche/salary.ts (validated bands);
 *   - certification bodies are correct per specialty (NBCRNA for CRNA,
 *     AMCB/ACME for CNM, NCC for NNP/WHNP, PNCB for PNP, AACN/ANCC for
 *     acute-care, ONCC/DNCB/ONCB for optional specialty credentials);
 *   - the new content file carries no reference-niche literals (the
 *     niche-copy debt ratchet fails on new files that do).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
    CATEGORY_LANDING_CONTENT,
    getCategoryLandingContent,
} from '@/lib/pseo/category-landing-content';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import { PSYCH_SPECIALTY_SLUG } from '@/lib/pseo/taxonomy-registry';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { salaryConfig } from '@/config/niche/salary';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The 19 template-shell landing slugs (wrappers over category-landing-template). */
const LANDING_SLUGS = [
    'acute-care', 'adult-gerontology', 'anesthesia', 'cardiology',
    'clinical-nurse-specialist', 'dermatology', 'emergency', 'family-practice',
    'home-health', 'hospitalist', 'midwifery', 'neonatal', 'oncology',
    'orthopedic', 'pediatric', 'primary-care', 'urgent-care', 'women-health',
    ...(PSYCH_SPECIALTY_SLUG ? [PSYCH_SPECIALTY_SLUG] : []),
];

describe('P1 #5 — category landing editorial content', () => {
    it('every template-shell landing slug wraps the shared template', () => {
        for (const slug of LANDING_SLUGS) {
            const src = read(`app/jobs/${slug}/page.tsx`);
            expect(src, `${slug} should wrap category-landing-template`).toContain(
                'category-landing-template',
            );
        }
    });

    it('every landing slug has bespoke editorial content', () => {
        for (const slug of LANDING_SLUGS) {
            const content = getCategoryLandingContent(slug);
            expect(content, `${slug} missing landing content`).not.toBeNull();
            expect(content!.intro.length).toBeGreaterThanOrEqual(2);
            expect(content!.highlights).toHaveLength(3);
            expect(content!.requirements.length).toBeGreaterThanOrEqual(4);
            expect(content!.salaryNarrative.trim().length).toBeGreaterThan(80);
            for (const para of content!.intro) {
                expect(para.trim().length, `${slug} intro paragraph too thin`).toBeGreaterThan(80);
            }
        }
    });

    it('editorial is differentiated — no two categories share intro, requirements, or highlights', () => {
        const entries = Object.entries(CATEGORY_LANDING_CONTENT);
        const intros = new Set(entries.map(([, c]) => JSON.stringify(c.intro)));
        const reqs = new Set(entries.map(([, c]) => JSON.stringify(c.requirements)));
        const highlights = new Set(entries.map(([, c]) => JSON.stringify(c.highlights)));
        const salaries = new Set(entries.map(([, c]) => c.salaryNarrative));
        expect(intros.size).toBe(entries.length);
        expect(reqs.size).toBe(entries.length);
        expect(highlights.size).toBe(entries.length);
        expect(salaries.size).toBe(entries.length);
    });

    describe('truth rule — dollar figures trace to stats-sources / salary config', () => {
        // The cited BLS OEWS median is now the ONLY dollar figure the
        // editorial may render. config/niche/salary.ts is deliberately NOT
        // a source here — see the "ingest constants are not market data"
        // block below.
        const allowed = new Set<string>([
            STAT_SOURCES.averageSalary.formatted, // $129,210
        ]);

        it('salary narratives contain only derived figures', () => {
            for (const [slug, content] of Object.entries(CATEGORY_LANDING_CONTENT)) {
                const dollars = content.salaryNarrative.match(/\$[\d,]+(?:K|k)?/g) ?? [];
                for (const d of dollars) {
                    expect(allowed.has(d), `${slug}: untraced dollar literal ${d}`).toBe(true);
                }
            }
        });

        it('intro/requirements/highlights carry no dollar figures at all', () => {
            for (const [slug, content] of Object.entries(CATEGORY_LANDING_CONTENT)) {
                const text = [
                    ...content.intro,
                    ...content.requirements,
                    ...content.highlights.map((h) => `${h.title} ${h.description}`),
                ].join('\n');
                expect(text, `${slug}: dollar literal outside salary narrative`).not.toMatch(/\$\d/);
            }
        });

        it('the cited BLS median appears in salary narratives (except CNS, which is not an NP role)', () => {
            for (const [slug, content] of Object.entries(CATEGORY_LANDING_CONTENT)) {
                if (slug === 'clinical-nurse-specialist') {
                    expect(content.salaryNarrative).not.toContain(STAT_SOURCES.averageSalary.formatted);
                } else {
                    expect(content.salaryNarrative, `${slug} missing cited median`).toContain(
                        STAT_SOURCES.averageSalary.formatted,
                    );
                }
            }
        });
    });

    /**
     * Ingest-time validation constants are NOT market data.
     *
     * config/niche/salary.ts documents `normalizer.typical` ($110k–$170k)
     * as the donor board's own reference-niche mid-band — the comparison
     * window the salary normalizer clamps against — and `annualMax`
     * ($400k) as the ceiling above which the parser REJECTS a value.
     * Rendering either as a market pay band produced positioning claims
     * that contradicted this package's own per-specialty salaryRange
     * values (primary care "anchors the center" ≈ $140k vs '$100K-140K';
     * emergency/acute-care "upper end" ≈ $170k vs '$115K-160K'; CRNA
     * "extends to $400K" vs '$180K-250K') and put primary care above the
     * cited $129,210 all-NP median.
     */
    describe('truth rule — ingest normalizer constants never reach the page', () => {
        const bannedFigures = [
            `$${Math.round(salaryConfig.normalizer.typical.min / 1000)}K`, // $110K
            `$${Math.round(salaryConfig.normalizer.typical.max / 1000)}K`, // $170K
            `$${Math.round(salaryConfig.normalizer.annualMax / 1000)}K`, // $400K
        ];

        const allEditorialText = () =>
            Object.entries(CATEGORY_LANDING_CONTENT).map(([slug, c]) => [
                slug,
                [
                    ...c.intro,
                    ...c.requirements,
                    ...c.highlights.map((h) => `${h.title} ${h.description}`),
                    c.salaryNarrative,
                ].join('\n'),
            ] as const);

        it('no rendered field carries a salary-normalizer figure', () => {
            for (const [slug, text] of allEditorialText()) {
                for (const figure of bannedFigures) {
                    expect(text, `${slug}: normalizer constant ${figure} rendered as market data`)
                        .not.toContain(figure);
                }
            }
        });

        it('the content module does not import config/niche/salary.ts', () => {
            const src = read('lib/pseo/category-landing-content.ts');
            expect(src).not.toMatch(/from\s+'@?\/?config\/niche\/salary'/);
            expect(src).not.toMatch(/salaryConfig\s*\./);
        });

        it('no salary narrative asserts a position inside an unsourced band', () => {
            // "upper end of the $X–$Y band", "anchors the center", etc.
            const bandPositioning =
                /\b(?:upper|lower)\s+(?:end|half)\b|\banchors?\s+the\s+(?:center|centre|middle)\b|\bthe\s+typical\s+\$/i;
            for (const [slug, content] of Object.entries(CATEGORY_LANDING_CONTENT)) {
                expect(content.salaryNarrative, `${slug}: band-position claim`)
                    .not.toMatch(bandPositioning);
            }
        });
    });

    /**
     * Unsourced superlative / universal market claims. The dollar-literal
     * rules above do not catch prose like "more than any other NP track"
     * or "nearly every metro" — nothing in the repo supports them.
     */
    describe('truth rule — no unsourced superlative or universal claims', () => {
        const BANNED = [
            /\bthan any other\b/i,
            /\bfastest[- ]\w+/i,
            /\bmost portable\b/i,
            /\bnearly every\b/i,
            /\bevery (?:state|metro|geography|market|community)\b/i,
            /\broutinely outstrips\b/i,
            /\b(?:most|best|largest|highest)[- ]\w+ (?:specialty|credential|track|setting|field|market)\b/i,
            /\bguarantee[sd]?\b/i,
        ];

        it('no editorial field trips the banned-claim list', () => {
            for (const [slug, content] of Object.entries(CATEGORY_LANDING_CONTENT)) {
                const text = [
                    ...content.intro,
                    ...content.requirements,
                    ...content.highlights.map((h) => `${h.title} ${h.description}`),
                    content.salaryNarrative,
                ].join('\n');
                for (const pattern of BANNED) {
                    expect(text, `${slug}: unsourced claim matching ${pattern}`).not.toMatch(pattern);
                }
            }
        });

        it('setting-state benefits/tips carry no unsourced superlatives either', () => {
            for (const [key, config] of Object.entries(SETTING_CONFIGS)) {
                const text = [
                    ...config.benefits.map((b) => `${b.title} ${b.description}`),
                    ...config.tips,
                ].join('\n');
                for (const pattern of BANNED) {
                    // "guaranteed minimum hours" is negotiation advice, not a
                    // market claim — the only sanctioned use of the word.
                    if (pattern.source.includes('guarantee')) continue;
                    expect(text, `${key}: unsourced claim matching ${pattern}`).not.toMatch(pattern);
                }
            }
        });

        it('the /jobs hub makes no all-states inventory claim', () => {
            // Inventory is whatever the ingest produced; the hub cannot
            // promise coverage in every state.
            const src = read('app/jobs/page.tsx');
            expect(src).not.toMatch(/across every state/i);
        });
    });

    describe('certification bodies are correct per specialty', () => {
        const reqText = (slug: string) =>
            (getCategoryLandingContent(slug)?.requirements ?? []).join('\n');

        it('CRNA cites NBCRNA + COA, never AANP/ANCC', () => {
            const text = reqText('anesthesia');
            expect(text).toContain('NBCRNA');
            expect(text).toContain('Council on Accreditation');
            expect(text).not.toMatch(/\bANCC\b/);
            expect(text).not.toMatch(/\bAANP\b/);
        });

        it('CNM cites AMCB + ACME, never NBCRNA', () => {
            const text = reqText('midwifery');
            expect(text).toContain('AMCB');
            expect(text).toContain('ACME');
            expect(text).not.toContain('NBCRNA');
        });

        it('NNP cites NCC; WHNP cites NCC; PNP cites PNCB', () => {
            expect(reqText('neonatal')).toContain('National Certification Corporation');
            expect(reqText('women-health')).toContain('National Certification Corporation');
            expect(reqText('pediatric')).toContain('PNCB');
        });

        it('pediatric never offers the retired ANCC PPCNP-BC as an entry route', () => {
            // ANCC retired the pediatric primary care NP exam; PNCB's
            // CPNP-PC/CPNP-AC are the routes open to new candidates. The
            // acronym may only appear alongside that retirement context.
            const text = reqText('pediatric');
            if (text.includes('PPCNP-BC')) {
                expect(text, 'PPCNP-BC listed without retirement context').toMatch(/retired/i);
            }
            expect(text).not.toMatch(/or\s+PPCNP-BC\s+through\s+ANCC/i);
        });

        it('acute-care and hospitalist cite ANCC + AACN acute credentials', () => {
            for (const slug of ['acute-care', 'hospitalist']) {
                const text = reqText(slug);
                expect(text, `${slug}`).toContain('AGACNP-BC');
                expect(text, `${slug}`).toContain('AACN');
            }
        });

        it('optional specialty credentials name the right certifiers', () => {
            expect(reqText('oncology')).toContain('ONCC');
            expect(reqText('dermatology')).toContain('Dermatology Nursing Certification Board');
            expect(reqText('orthopedic')).toContain('ONCB');
        });

        it('the P1 #15 verticals cite the right optional credentials', () => {
            expect(reqText('aesthetics')).toContain('Plastic Surgical Nursing Certification Board');
            expect(reqText('palliative-hospice')).toContain('Hospice and Palliative Credentialing Center');
            // Pain management has no repo-verified NP credential body — it must
            // point at the state board rather than assert licensure specifics.
            const pain = reqText('pain-management');
            expect(pain).toContain('state board');
            expect(pain).not.toMatch(/\b(?:AP-PMN|PMGT-BC)\b/);
        });
    });

    describe('P1 #15 verticals share the same editorial contract', () => {
        const VERTICALS = ['aesthetics', 'pain-management', 'palliative-hospice'];

        it('each new specialty vertical has bespoke editorial', () => {
            for (const slug of VERTICALS) {
                const content = getCategoryLandingContent(slug);
                expect(content, `${slug} missing landing content`).not.toBeNull();
                expect(content!.intro.length).toBeGreaterThanOrEqual(2);
                expect(content!.highlights).toHaveLength(3);
                expect(content!.requirements.length).toBeGreaterThanOrEqual(4);
            }
        });

        it('the template carries a real role label for each (no slug title-case fallback)', () => {
            const src = read('lib/pseo/category-landing-template.tsx');
            for (const slug of VERTICALS) {
                expect(src, `${slug} missing NEW_CATEGORY_COPY entry`).toMatch(
                    new RegExp(`['"]?${slug}['"]?:\\s*\\{`),
                );
            }
        });
    });

    it('the content module introduces no reference-niche literals (niche-copy ratchet)', () => {
        const src = read('lib/pseo/category-landing-content.ts');
        expect(src).not.toMatch(/pmhnp|psychiatric|mental health/i);
    });
});

describe('P1 #5 — setting-state benefits/tips are bespoke per config', () => {
    it('no two configs share identical benefits', () => {
        const entries = Object.entries(SETTING_CONFIGS);
        const seen = new Map<string, string>();
        for (const [key, config] of entries) {
            const fingerprint = JSON.stringify(config.benefits);
            const clash = seen.get(fingerprint);
            expect(clash, `${key} and ${clash} share byte-identical benefits`).toBeUndefined();
            seen.set(fingerprint, key);
        }
    });

    it('no two configs share identical tips', () => {
        const entries = Object.entries(SETTING_CONFIGS);
        const seen = new Map<string, string>();
        for (const [key, config] of entries) {
            const fingerprint = JSON.stringify(config.tips);
            const clash = seen.get(fingerprint);
            expect(clash, `${key} and ${clash} share byte-identical tips`).toBeUndefined();
            seen.set(fingerprint, key);
        }
    });

    it('every config carries 3 populated benefits and 4+ tips', () => {
        for (const [key, config] of Object.entries(SETTING_CONFIGS)) {
            expect(config.benefits, key).toHaveLength(3);
            expect(config.tips.length, key).toBeGreaterThanOrEqual(4);
            for (const b of config.benefits) {
                expect(b.title.trim().length, key).toBeGreaterThan(3);
                expect(b.description.trim().length, key).toBeGreaterThan(20);
                expect(b.iconName.trim().length, key).toBeGreaterThan(2);
            }
        }
    });

    it('specialty benefits/tips add no new reference-niche copy (ceiling stays)', () => {
        // The psych entry's bespoke copy must not name the reference niche —
        // the per-file ceiling in niche-copy-pseo-templates.test.ts counts
        // every occurrence and is already at its cap from the config header.
        const psychKey = Object.keys(SETTING_CONFIGS).find((k) => k.endsWith('-mental-health'));
        expect(psychKey).toBeDefined();
        const config = SETTING_CONFIGS[psychKey!];
        const copy = [
            ...config.benefits.map((b) => `${b.title} ${b.description}`),
            ...config.tips,
        ].join('\n');
        expect(copy).not.toMatch(/pmhnp|psychiatric|mental health/i);
    });
});
