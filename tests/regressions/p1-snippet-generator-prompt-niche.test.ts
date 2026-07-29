/**
 * P1 #10 — Layer-2 snippet generator rebuilt off the donor niche.
 *
 * The donor board's specialty was baked into scripts/generate-city-snippets.ts:
 * the system prompt named the donor role outright, and two local maps
 * (28 donor category slugs with hand-written hints/labels) had drifted from
 * the live 42-slug taxonomy in lib/pseo/taxonomy-registry.ts.
 *
 * Guards:
 *   1. Script source carries zero reference-niche terms and derives all copy
 *      from brand.niche tokens + the live registry (no local slug maps).
 *   2. Rendered prompts (system + base city + every city-eligible taxonomy)
 *      carry zero reference-niche terms — except the one specialty category
 *      whose subject matter IS that niche, resolved via PSYCH_SPECIALTY_SLUG.
 *   3. Output validation rejects generated snippets that leak reference-niche
 *      terms (and short/empty drafts) before they reach the DB.
 *
 * NOTE: term checks reference the ratchet scanner's regexes indirectly — this
 * test intentionally avoids embedding the literal terms.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATE_REFERENCE_NICHE_TERMS } from './brand-leak-scan';
import {
    SYSTEM_PROMPT,
    buildCityPrompt,
    buildTaxonomyPrompt,
    toCityFactBlock,
    taxonomyLabel,
    taxonomyPageTitle,
    validateSnippetBody,
    findDonorNicheTerms,
} from '@/scripts/generate-city-snippets';
import {
    CATEGORY_AXES,
    CITY_ELIGIBLE_CATEGORY_SLUGS,
    PSYCH_SPECIALTY_SLUG,
} from '@/lib/pseo/taxonomy-registry';
import { buildCityFacts, getTaxonomyLead } from '@/lib/pseo/city-narrative';
import { ALL_CATEGORY_CONFIGS } from '@/lib/pseo/category-city-template';
import { TASK_REGISTRY } from '@/lib/ai/tasks';
import { MODEL_PRICING } from '@/lib/ai/pricing';
import { brand } from '@/config/brand';
import type { CityData } from '@/lib/pseo/city-data/types';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function countNicheTerms(text: string): number {
    let hits = 0;
    for (const re of TEMPLATE_REFERENCE_NICHE_TERMS) {
        const matches = text.match(new RegExp(re.source, re.flags));
        if (matches) hits += matches.length;
    }
    return hits;
}

// Generic fixture — names are obviously placeholder, never rendered publicly.
const FIXTURE_CITY: CityData = {
    name: 'Springfield',
    state: 'Illinois',
    stateCode: 'IL',
    slug: 'springfield-il',
    population: 195_000,
    costOfLivingIndex: 92,
    lat: 39.78,
    lng: -89.65,
    metroArea: 'Springfield Metro',
    mentalHealthShortage: true,
    healthcareSystems: ['Example Health System', 'Sample Medical Center'],
    nearbyCities: [],
    providerRatio: 'moderate',
    medianIncome: 62_000,
    stateRank: 7,
};

const narrativeFacts = buildCityFacts(FIXTURE_CITY);
const factBlock = toCityFactBlock(narrativeFacts);
const TOTAL_JOBS = 17;

describe('P1 #10 — script source is niche-neutral and registry-driven', () => {
    const src = read('scripts/generate-city-snippets.ts');

    it('carries zero reference-niche terms in source', () => {
        expect(countNicheTerms(src)).toBe(0);
    });

    it('derives copy from brand.niche tokens instead of hardcoded role names', () => {
        expect(src).toContain('${brand.niche.short}');
        expect(src).toContain('${brand.niche.descriptor}');
    });

    it('iterates the live registry, not a local donor slug map', () => {
        expect(src).toContain('CITY_ELIGIBLE_CATEGORY_SLUGS');
        expect(src).not.toMatch(/TAXONOMY_HINTS/);
        expect(src).not.toMatch(/TAXONOMY_LABELS/);
    });

    it('never renders the practice-authority details prose (donor-contaminated source text)', () => {
        // Prompts carry the authority LEVEL enum only; the free-text details
        // in lib/state-practice-authority.ts still read as donor-board copy.
        expect(src).not.toContain('practiceDetails');
    });

    it('documents --dry-run and keeps the spend cap + direct-run guard', () => {
        expect(src).toContain('--dry-run');
        expect(src).toContain('MAX_SPEND_USD');
        expect(src).toContain('require.main === module');
    });

    it('the documented cost basis tracks the live registry and pricing table', () => {
        // Header states a category count the taxonomy run is priced off. If a
        // package adds categories, the documented cost must move with them.
        const stated = src.match(/currently (\d+) categories/);
        expect(stated, 'header no longer states its category count').toBeTruthy();
        expect(
            Number(stated![1]),
            'documented category count drifted from CITY_ELIGIBLE_CATEGORY_SLUGS',
        ).toBe(CITY_ELIGIBLE_CATEGORY_SLUGS.length);
        // Per-call price basis must match the seo_content primary's real rates.
        const primary = TASK_REGISTRY.seo_content.primary.model;
        const pricing = MODEL_PRICING[primary];
        expect(pricing, `no pricing row for seo_content primary "${primary}"`).toBeTruthy();
        expect(src, 'documented input price drifted from lib/ai/pricing.ts')
            .toContain(`$${pricing.input.toFixed(2)}/M input`);
        expect(src, 'documented output price drifted from lib/ai/pricing.ts')
            .toContain(`$${pricing.output.toFixed(2)}/M output`);
        expect(src, 'documented primary model drifted from lib/ai/tasks.ts').toContain(primary);
    });
});

describe('P1 #10 — rendered prompts carry zero reference-niche terms', () => {
    it('system prompt is niche-neutral with an all-specialty + APRN persona', () => {
        expect(countNicheTerms(SYSTEM_PROMPT)).toBe(0);
        expect(SYSTEM_PROMPT).toContain(brand.niche.descriptor);
        expect(SYSTEM_PROMPT).toContain('APRN');
        expect(SYSTEM_PROMPT).toContain('never invent numbers');
    });

    it('base city prompt is clean and uses the niche-neutral shortage phrasing', () => {
        const prompt = buildCityPrompt(factBlock, TOTAL_JOBS);
        expect(countNicheTerms(prompt)).toBe(0);
        expect(prompt).toContain('Health Professional Shortage Area');
        expect(prompt).toContain(`${brand.niche.short} Jobs in Springfield, IL`);
        expect(prompt).not.toContain('undefined');
    });

    it('every city-eligible taxonomy slug renders a complete prompt (lead or explicit fallback)', () => {
        for (const slug of CITY_ELIGIBLE_CATEGORY_SLUGS) {
            const prompt = buildTaxonomyPrompt(factBlock, narrativeFacts, slug, TOTAL_JOBS);
            expect(prompt.length, `empty prompt for "${slug}"`).toBeGreaterThan(100);
            expect(prompt, `unresolved label for "${slug}"`).not.toContain('undefined');
            expect(prompt, `missing category-context section for "${slug}"`).toContain('Category context');
            // Registry slugs without a Layer-1 lead yet (concurrent taxonomy
            // additions) must fall back to the explicit neutral line, never
            // an empty section.
            if (!getTaxonomyLead(slug, narrativeFacts)) {
                expect(prompt, `"${slug}" has no Layer-1 lead and no fallback context`).toContain('no category-specific compensation structure');
            }
        }
    });

    it('every non-sanctioned taxonomy prompt carries zero reference-niche terms', () => {
        for (const slug of CITY_ELIGIBLE_CATEGORY_SLUGS) {
            if (slug === PSYCH_SPECIALTY_SLUG) continue; // the specialty whose subject matter IS the reference niche
            const prompt = buildTaxonomyPrompt(factBlock, narrativeFacts, slug, TOTAL_JOBS);
            expect(countNicheTerms(prompt), `reference-niche term leaked into the "${slug}" prompt`).toBe(0);
        }
    });

    it('every taxonomy label matches the label the live page renders', () => {
        // The script deliberately does NOT import category-city-template
        // (module-scope Prisma client → import throws with no DATABASE_URL,
        // which would break --dry-run). This assertion is what keeps its
        // mechanical derivation + override map in lockstep with the page.
        for (const slug of CITY_ELIGIBLE_CATEGORY_SLUGS) {
            const config = ALL_CATEGORY_CONFIGS[slug];
            expect(config, `no live page config for registry slug "${slug}"`).toBeTruthy();
            expect(
                taxonomyLabel(slug),
                `prompt label for "${slug}" drifted from the page label — add it to LABEL_OVERRIDES`,
            ).toBe(config.label);
        }
    });

    it('APRN cohort roles are their own credential — page titles never append the NP token', () => {
        for (const slug of CATEGORY_AXES.aprn) {
            const title = taxonomyPageTitle(slug, 'Springfield', 'IL');
            expect(title.startsWith(taxonomyLabel(slug)), `"${slug}" title should open with its own role label`).toBe(true);
            expect(title, `"${slug}" title should not read as an ${brand.niche.short} role`).not.toContain(`${brand.niche.short} Jobs`);
        }
        // Non-APRN categories DO carry the board's role token.
        expect(taxonomyPageTitle('remote', 'Springfield', 'IL')).toContain(`${brand.niche.short} Jobs`);
    });

    it('APRN cohort prompts omit the board-niche practice-authority fact (regulated separately)', () => {
        for (const slug of CATEGORY_AXES.aprn) {
            const prompt = buildTaxonomyPrompt(factBlock, narrativeFacts, slug, TOTAL_JOBS);
            expect(prompt, `"${slug}" prompt should not misapply ${brand.niche.short} practice authority`).not.toContain('practice authority:');
        }
        // Non-APRN categories keep the fact (fixture state has a known level).
        expect(buildTaxonomyPrompt(factBlock, narrativeFacts, 'remote', TOTAL_JOBS)).toContain('practice authority:');
    });
});

describe('P1 #10 — output validation rejects reference-niche leakage', () => {
    const PADDING = 'Compensation in this market reflects cost of living and local employer mix across settings.';

    it('accepts a clean draft of sufficient length', () => {
        expect(validateSnippetBody(PADDING).ok).toBe(true);
        expect(validateSnippetBody(PADDING, 'remote').ok).toBe(true);
    });

    it('rejects empty and too-short drafts', () => {
        expect(validateSnippetBody(undefined).ok).toBe(false);
        expect(validateSnippetBody(null).ok).toBe(false);
        expect(validateSnippetBody('   ').ok).toBe(false);
        expect(validateSnippetBody('Too short.').ok).toBe(false);
    });

    for (const re of TEMPLATE_REFERENCE_NICHE_TERMS) {
        const term = re.source; // simple literal patterns — source IS the term
        it(`rejects drafts containing the reference-niche term pattern /${term}/`, () => {
            const leaky = `${PADDING} Demand for ${term} roles is strong here.`;
            const base = validateSnippetBody(leaky);
            expect(base.ok).toBe(false);
            expect(base.reason).toContain('leakage');
            // Case-insensitive: uppercase variant is caught too.
            expect(validateSnippetBody(`${PADDING} ${term.toUpperCase()} demand.`).ok).toBe(false);
            // Category pages other than the sanctioned specialty also reject.
            expect(validateSnippetBody(leaky, 'remote').ok).toBe(false);
        });
    }

    it('exempts only the sanctioned specialty category (registry-derived, never a literal)', () => {
        expect(PSYCH_SPECIALTY_SLUG, 'registry no longer exposes the specialty slug — update the validator exemption').toBeTruthy();
        const specialtyTerm = TEMPLATE_REFERENCE_NICHE_TERMS[0].source;
        const leaky = `${PADDING} Demand for ${specialtyTerm} roles is strong here.`;
        expect(validateSnippetBody(leaky, PSYCH_SPECIALTY_SLUG).ok).toBe(true);
    });

    it('findDonorNicheTerms reports every distinct hit', () => {
        const clean = findDonorNicheTerms(PADDING);
        expect(clean).toHaveLength(0);
        const oneOfEach = TEMPLATE_REFERENCE_NICHE_TERMS.map((re) => re.source).join(' and ');
        expect(findDonorNicheTerms(oneOfEach).length).toBe(TEMPLATE_REFERENCE_NICHE_TERMS.length);
    });
});
