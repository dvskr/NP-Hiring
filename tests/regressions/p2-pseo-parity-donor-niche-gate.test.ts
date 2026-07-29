/**
 * P2 pSEO-parity — #7 follow-up: the behavioral-health HPSA claim is
 * CATEGORY-GATED, not merely discipline-LABELLED.
 *
 * The parity pass established that `CityData.mentalHealthShortage` is the
 * donor board's behavioral-health-discipline HRSA HPSA column and that no
 * surface may present it as an all-NP shortage figure. It then acted on that
 * in two ways which are easy to confuse:
 *
 *   1. LABELLING  — name the discipline wherever the designation is stated.
 *   2. GATING     — state the designation only on the page whose specialty it
 *                   actually describes (the behavioral-health category).
 *
 * The OG `shortage` param and the "is this a good place for NP careers" FAQ
 * answer got both. Three surfaces got only the label:
 *
 *   • buildCategoryCityMetadata's meta description  — the SERP snippet
 *   • the city "Community Profile" tile
 *   • the setting×state "State Insights" stat card
 *
 * 2,650 of the 4,135 cities carry the flag, so a labelled-but-ungated surface
 * still publishes a behavioral-health designation on
 * /jobs/dermatology/city/houston-tx and on all 42 categories × ~4.1K cities.
 * Labelling makes the sentence TRUE; gating is what keeps the donor niche off
 * the all-NP URLs the niche-copy ratchets exist to protect. Both are needed.
 *
 * The metadata assertions here are BEHAVIOURAL — they drive the real exported
 * builder and read the string Google would index. The two JSX surfaces cannot
 * be rendered without a live DB, so those are proven structurally: the gate
 * predicate is exported and unit-tested, and each render surface is asserted
 * to sit inside it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Own module mock: the shared tests/setup.ts prisma stub has no `pseoStats`
// model, and buildCategoryCityMetadata is entirely pseoStats-driven.
vi.mock('@/lib/prisma', () => ({
    prisma: {
        pseoStats: {
            findUnique: vi.fn(),
            findMany: vi.fn(),
        },
        job: {
            count: vi.fn(),
            aggregate: vi.fn(),
            groupBy: vi.fn(),
            findMany: vi.fn(),
        },
    },
}));

import { prisma } from '@/lib/prisma';
import {
    buildCategoryCityMetadata,
    shortageIsOnTopic,
    categoryOwnsShortageData,
} from '@/lib/pseo/category-city-template';
import { getCityBySlug } from '@/lib/pseo/city-data/cities';
import { CITIES } from '@/lib/pseo/city-data/cities';
import { PSYCH_SPECIALTY_SLUG } from '@/lib/pseo/taxonomy-registry';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Source with comments stripped — the fixes are documented by comments that
 * deliberately quote the removed code, so structural assertions must look at
 * code only.
 */
const readCode = (rel: string): string =>
    read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

const CITY_TEMPLATE = 'lib/pseo/category-city-template.tsx';
const STATE_TEMPLATE = 'lib/pseo/setting-state-template.tsx';

/** A city that carries the donor flag, and one that does not. */
const SHORTAGE_CITY = 'houston-tx';
const CLEAR_CITY = 'new-york-ny';

/** A category the designation does NOT describe. */
const OFF_TOPIC_CATEGORY = 'dermatology';

const HPSA_SENTENCE = 'Federally designated behavioral-health HPSA.';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

/** Fresh + positive, so getCityStats returns on the cached-row fast path. */
const freshRow = () => ({
    totalJobs: 31,
    rawAvgSalary: 129,
    colAdjustedSalary: 133,
    updatedAt: new Date(),
});

beforeEach(() => {
    vi.clearAllMocks();
    db.pseoStats.findUnique.mockResolvedValue(freshRow());
    vi.spyOn(console, 'error').mockImplementation(() => { });
});

// ─── the data that makes this matter ────────────────────────────────────────

describe('the donor shortage column is on the majority of cities', () => {
    it('a labelled-but-ungated surface would reach most of the corpus', () => {
        const flagged = CITIES.filter((c) => c.mentalHealthShortage).length;
        // Not a golden number — the point is that this is not a rare edge
        // case, so "it is labelled correctly" is not an adequate defence.
        expect(flagged).toBeGreaterThan(CITIES.length / 2);
        expect(getCityBySlug(SHORTAGE_CITY)!.mentalHealthShortage).toBe(true);
        expect(getCityBySlug(CLEAR_CITY)!.mentalHealthShortage).toBe(false);
    });

    it('the behavioral-health category slug resolves from the registry', () => {
        expect(PSYCH_SPECIALTY_SLUG).toBeDefined();
        expect(OFF_TOPIC_CATEGORY).not.toBe(PSYCH_SPECIALTY_SLUG);
    });
});

// ─── the gate predicate ─────────────────────────────────────────────────────

describe('the two gate predicates', () => {
    const OTHER_CATEGORIES = [OFF_TOPIC_CATEGORY, 'cardiology', 'aesthetics', 'remote', 'family-practice'];

    it('shortageIsOnTopic is true only for a flagged city on the behavioral-health category', () => {
        expect(shortageIsOnTopic(getCityBySlug(SHORTAGE_CITY)!, PSYCH_SPECIALTY_SLUG!)).toBe(true);
    });

    it('shortageIsOnTopic is false for a flagged city on any other category', () => {
        const city = getCityBySlug(SHORTAGE_CITY)!;
        for (const slug of OTHER_CATEGORIES) {
            expect(shortageIsOnTopic(city, slug), slug).toBe(false);
        }
    });

    it('shortageIsOnTopic is false for an unflagged city even on the behavioral-health category', () => {
        expect(shortageIsOnTopic(getCityBySlug(CLEAR_CITY)!, PSYCH_SPECIALTY_SLUG!)).toBe(false);
    });

    it('categoryOwnsShortageData is category-only, so both polarities stay available on topic', () => {
        // The Community Profile tile and the state stat card report "Not
        // designated" / a low count, which is a real NHSC-eligibility signal
        // for a behavioral-health seeker. Gating THOSE on the flag would
        // delete on-topic information, so they gate on the category alone.
        expect(categoryOwnsShortageData(PSYCH_SPECIALTY_SLUG!)).toBe(true);
        for (const slug of OTHER_CATEGORIES) {
            expect(categoryOwnsShortageData(slug), slug).toBe(false);
        }
    });

    it('the affirmative predicate is strictly narrower than the category predicate', () => {
        for (const city of [getCityBySlug(SHORTAGE_CITY)!, getCityBySlug(CLEAR_CITY)!]) {
            for (const slug of [PSYCH_SPECIALTY_SLUG!, ...OTHER_CATEGORIES]) {
                if (shortageIsOnTopic(city, slug)) {
                    expect(categoryOwnsShortageData(slug), slug).toBe(true);
                }
            }
        }
    });
});

// ─── surface 1: the SERP snippet (behavioural) ──────────────────────────────

describe('meta description — the donor claim never ships on an off-topic category', () => {
    it('omits the HPSA sentence on a flagged city under an unrelated specialty', async () => {
        const meta = await buildCategoryCityMetadata(OFF_TOPIC_CATEGORY, SHORTAGE_CITY, 1);

        expect(meta.description).toBeDefined();
        expect(meta.description).not.toContain(HPSA_SENTENCE);
        expect(meta.description).not.toMatch(/HPSA|shortage/i);
        // Still a real description — the gate withholds the claim, it does
        // not blank the snippet.
        expect(meta.description).toContain('Houston, TX');
        expect(meta.description).toContain('COL index');
    });

    it('keeps the HPSA sentence on the behavioral-health category', async () => {
        const meta = await buildCategoryCityMetadata(PSYCH_SPECIALTY_SLUG!, SHORTAGE_CITY, 1);
        expect(meta.description).toContain(HPSA_SENTENCE);
    });

    it('omits it for an unflagged city even on the behavioral-health category', async () => {
        const meta = await buildCategoryCityMetadata(PSYCH_SPECIALTY_SLUG!, CLEAR_CITY, 1);
        expect(meta.description).not.toContain(HPSA_SENTENCE);
        expect(meta.description).not.toMatch(/HPSA/i);
    });

    it('leaves no dangling separator when the claim is withheld', async () => {
        const meta = await buildCategoryCityMetadata(OFF_TOPIC_CATEGORY, SHORTAGE_CITY, 1);
        expect(meta.description).toBe(meta.description!.trim());
        expect(meta.description).not.toMatch(/\s{2,}/);
    });

    it('the OG shortage param stays gated in lockstep with the description', async () => {
        const off = await buildCategoryCityMetadata(OFF_TOPIC_CATEGORY, SHORTAGE_CITY, 1);
        const on = await buildCategoryCityMetadata(PSYCH_SPECIALTY_SLUG!, SHORTAGE_CITY, 1);

        const ogUrl = (m: typeof off) =>
            String((m.openGraph?.images as { url: string }[] | undefined)?.[0]?.url ?? '');

        expect(ogUrl(off)).not.toContain('shortage=true');
        expect(ogUrl(on)).toContain('shortage=true');
    });
});

// ─── surfaces 2 and 3: the rendered tiles (structural) ──────────────────────

describe('rendered stat tiles sit inside the same gate', () => {
    it('the city Community Profile tile renders only on the owning category', () => {
        const code = readCode(CITY_TEMPLATE);
        expect(code).toMatch(
            /categoryOwnsShortage && \([\s\S]{0,500}Behavioral-Health HPSA/,
        );
    });

    it('the state Insights stat card renders only on the owning category', () => {
        const code = readCode(STATE_TEMPLATE);
        expect(code).toMatch(
            /shortageMatchesCategory && topCities\.length > 0 && \([\s\S]{0,500}Behavioral-Health HPSA/,
        );
    });

    it('the careers FAQ answer branches on the gate, not on the raw flag', () => {
        const code = readCode(CITY_TEMPLATE);
        // The former leak read `city!.mentalHealthShortage && … === PSYCH_…`
        // inline; the answer also feeds the FAQPage schema, so one drifting
        // copy would desync the visible text from the structured data.
        expect(code).toMatch(
            /shortageMatchesCategory\s*\n?\s*\?\s*'carries a federal HRSA behavioral-health/,
        );
    });

    it('the meta description branches on the gate, not on the raw flag', () => {
        const descLine = readCode(CITY_TEMPLATE)
            .split('\n')
            .find((l) => l.includes('description: `Find'));

        expect(descLine).toBeDefined();
        expect(descLine!).not.toContain('mentalHealthShortage');
        expect(descLine!).toContain('shortageMatchesCategory');
    });

    it('the raw flag is read only by the predicates and by publish-nothing scorers', () => {
        // The two scoring functions consume the flag as an internal demand
        // input and publish nothing, so they legitimately read it directly.
        // The tile reads it for its VALUE, but only inside the category gate
        // asserted above. Everything else must go through a predicate.
        const code = readCode(CITY_TEMPLATE);
        const rawReads = code.split('\n').filter((l) => l.includes('.mentalHealthShortage'));
        expect(rawReads.length).toBeGreaterThan(0);
        for (const line of rawReads) {
            expect(
                /score \+=|return city\.mentalHealthShortage|'Designated' : 'Not designated'/.test(line),
                `unexpected raw shortage read → ${line.trim()}`,
            ).toBe(true);
        }
    });

    it('both templates route their gate through the shared predicates', () => {
        expect(readCode(CITY_TEMPLATE)).toMatch(/shortageIsOnTopic\(city/);
        // The state template has no per-city claim to make — its card is a
        // COUNT over top cities — so it imports the category predicate rather
        // than re-deriving the slug comparison locally.
        const state = readCode(STATE_TEMPLATE);
        expect(state).toMatch(
            /import \{[^}]*categoryOwnsShortageData[^}]*\} from '\.\/category-city-template'/,
        );
        expect(state).toContain('categoryOwnsShortageData(config.slug)');
        // And it must not hand-roll a second copy of the comparison.
        expect(state).not.toMatch(/config\.slug === PSYCH_SPECIALTY_SLUG/);
    });
});

// ─── the invariant, restated where the data lives ───────────────────────────

describe('city-data/types.ts documents gating, not just labelling', () => {
    it('tells renderers the claim is category-gated', () => {
        const src = read('lib/pseo/city-data/types.ts');
        expect(src).toMatch(/NOT an all-NP or primary-care shortage signal/);
        // The rule the three leaks violated: labelling alone is insufficient.
        expect(src).toMatch(/GATE IT/);
        expect(src).toMatch(/Labelling alone is NOT sufficient/i);
        expect(src).toContain('shortageIsOnTopic');
        expect(src).toContain('categoryOwnsShortageData');
    });
});
