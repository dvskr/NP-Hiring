/**
 * Regression guards — audit V0 + B3 (prompt niche debt).
 *
 * The donor board's psych specialty was baked into the AI prompts that score
 * and rank candidates on this all-NP board:
 *   - candidate_scoring v1 told the model it is a psych-specialty recruiter
 *     and to look for that specialty's board cert — skewing reasons /
 *     missing-items for candidates in every other specialty.
 *   - talent_search_rerank v1 framed the employer as a psych practice.
 *   - enrich-thin-jds hardcoded the donor specialty in its rewrite prompt.
 *
 * v2 prompts are niche-neutral (persona derives from brand.niche framing),
 * the registry auto-resolves latest, and the eval fixtures pin v2 so the CI
 * gate tests the prompt production actually runs.
 *
 * NOTE: term checks reference the scanner's regexes indirectly — this test
 * intentionally avoids embedding the literal terms so it never shows up in
 * the niche-copy ratchet itself.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadPrompt, __testing } from '@/lib/ai/prompts/registry';
import { TEMPLATE_REFERENCE_NICHE_TERMS } from './brand-leak-scan';

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

describe('V0 — candidate_scoring resolves to the niche-neutral v2', () => {
    it('registry latest is v2 and supersedes v1', async () => {
        __testing.clearCache();
        const p = await loadPrompt('candidate_scoring');
        expect(p.version).toBe('v2');
        expect(p.supersedes).toBe('v1');
    });

    it('v2 system prompt carries zero reference-niche terms and an all-specialty persona', async () => {
        const p = await loadPrompt('candidate_scoring', 'v2');
        expect(countNicheTerms(p.rawSystem)).toBe(0);
        expect(p.rawSystem).toContain('Nurse Practitioner');
        expect(p.rawSystem).toContain('APRN');
        // Credentials must be judged against the job's specialty, not a preset one.
        expect(p.rawSystem.toLowerCase()).toContain('specialty the job asks for');
    });

    it('v2 keeps the v1 JSON contract (score/matchReasons/missingItems + bands)', async () => {
        const p = await loadPrompt('candidate_scoring', 'v2');
        expect(p.rawSystem).toContain('"score": number (0-100)');
        expect(p.rawSystem).toContain('"matchReasons"');
        expect(p.rawSystem).toContain('"missingItems"');
        expect(p.rawSystem).toContain('90-100: Perfect match');
        expect(p.rawUserTemplate).toContain('{{jobSummary}}');
        expect(p.rawUserTemplate).toContain('{{candidateSummary}}');
    });
});

describe('V0 — talent_search_rerank resolves to the niche-neutral v2', () => {
    it('registry latest is v2 with zero reference-niche terms', async () => {
        const p = await loadPrompt('talent_search_rerank');
        expect(p.version).toBe('v2');
        expect(countNicheTerms(p.rawSystem)).toBe(0);
        expect(p.rawSystem).toContain('Nurse Practitioners');
    });

    it('v2 keeps the v1 ranking contract ({{topK}}, ranked JSON, knockout rule)', async () => {
        const p = await loadPrompt('talent_search_rerank', 'v2');
        expect(p.rawSystem).toContain('{{topK}}');
        expect(p.rawSystem).toContain('"ranked"');
        expect(p.rawSystem).toContain('candidateIndex');
        expect(p.rawSystem).toContain('knockout');
        expect(p.rawUserTemplate).toContain('{{candidateList}}');
    });
});

describe('V0 — eval fixtures pin the shipped prompt version', () => {
    const fixtures = [
        'tests/ai/golden/candidate-scoring.json',
        'tests/ai/bias/candidate-scoring-pairs.json',
        'tests/ai/golden/talent-search-rerank.json',
        'tests/ai/bias/talent-search-rerank-pairs.json',
    ];
    for (const rel of fixtures) {
        it(`${path.basename(rel)} pins v2`, () => {
            const json = JSON.parse(read(rel)) as { promptVersion?: string };
            expect(json.promptVersion).toBe('v2');
        });
    }
});

describe('B3 — inline enrichment prompts derive the niche from brand config', () => {
    it('enrich-thin-jds system prompt interpolates brand.niche instead of a hardcoded role', () => {
        const src = read('app/api/cron/enrich-thin-jds/route.ts');
        expect(src).toContain('${brand.niche.long}');
        expect(src).toContain('${brand.niche.short}');
        expect(countNicheTerms(src)).toBe(0);
    });

    it('llm-enrichment salary rule interpolates brand.niche.short', () => {
        const src = read('lib/llm-enrichment.ts');
        expect(src).toContain('${brand.niche.short} roles');
        expect(countNicheTerms(src)).toBe(0);
    });
});
