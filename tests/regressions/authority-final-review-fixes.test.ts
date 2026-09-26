/**
 * Pins the fixes from the final independent review of the 2026-09 practice
 * authority pass. Each case names the published surface it protects, because
 * every one of them is licensing guidance read by nurse practitioners and,
 * where noted, republished by search engines through structured data.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import { LICENSE_GUIDE_STATES, buildLicenseGuideFaq } from '@/lib/blog-license-guides';
import { PROMPT_VERSION } from '@/scripts/generate-city-snippets';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('license guide: the full practice FAQ answer never rests on the tier alone', () => {
    // The answer to "Does {S} have full practice authority?" is also FAQPage
    // JSON-LD, so its opening words are what a search snippet shows. A bare
    // "Yes." was false for a newly licensed NP in every full-tier state whose
    // details require collaboration, supervision or mentorship first.
    const fullStates = LICENSE_GUIDE_STATES.filter((s) => s.authority === 'full');

    it('covers every full-tier jurisdiction in the dataset', () => {
        const fullInData = Object.values(STATE_PRACTICE_AUTHORITY).filter((s) => s.authority === 'full').length;
        expect(fullStates.length).toBe(fullInData);
    });

    it.each(fullStates.map((s) => [s.name, s] as const))('%s answer opens with the classification, not a bare Yes', (_name, s) => {
        const faq = buildLicenseGuideFaq(s);
        const answer = faq.find((f) => /full practice authority/i.test(f.name));
        expect(answer, 'the full practice authority question exists').toBeDefined();
        expect(answer!.text).not.toMatch(/^Yes\./);
        expect(answer!.text.startsWith("By AANP's classification, yes.")).toBe(true);
    });

    it('calls the District of Columbia a jurisdiction, never a state', () => {
        const dc = LICENSE_GUIDE_STATES.find((s) => s.code === 'DC');
        expect(dc).toBeDefined();
        const text = buildLicenseGuideFaq(dc!).map((f) => f.text).join(' ');
        expect(text).toContain('District of Columbia as a full practice jurisdiction');
        expect(text).not.toMatch(/District of Columbia as a full practice state/);
    });
});

describe('snippet generator: a prompt change invalidates the cache', () => {
    it('bumped PROMPT_VERSION when the practice authority instruction changed', () => {
        // The cache key includes PROMPT_VERSION. Without the bump, a paragraph
        // written under the old tier-as-scope prompt could be replayed and
        // stored, and approved snippets render ahead of the corrected
        // deterministic narrative on the city pages.
        expect(PROMPT_VERSION).not.toBe('v2');
    });
});

describe('tier-as-rule copy outside the main templates', () => {
    it('the private practice tip does not call full practice states ideal for independent practice', () => {
        expect(read('lib/pseo/category-city-template.tsx')).not.toMatch(/ideal for independent practice/i);
    });

    it('the general FAQ hedges full practice for states with a transition period', () => {
        const src = read('app/faq/page.tsx');
        expect(src).not.toMatch(/full practice authority states, \$\{brand\.niche\.short\}s practice independently\./);
        expect(src).toContain('once any transition period their state requires is complete');
    });

    it('the private practice guide calls the full practice group jurisdictions, since it includes DC', () => {
        expect(read('app/resources/private-practice-guide/page.tsx')).toContain('as Full Practice Authority jurisdictions');
    });
});

describe('metro guides agree with the verified practice authority entries', () => {
    const metro = read('lib/metro-data.ts');

    it('never presents 3,000 supervised hours alone as enough for Florida autonomous practice', () => {
        // Florida's verified entry also requires graduate-level coursework in
        // differential diagnosis and pharmacology.
        expect(STATE_PRACTICE_AUTHORITY['Florida'].details).toMatch(/differential diagnosis and pharmacology/);
        const hourSentences = metro.split(/(?<=[.'])\s+/).filter((sentence) => /3,000/.test(sentence));
        expect(hourSentences.length).toBeGreaterThan(0);
        for (const sentence of hourSentences) {
            expect(sentence, sentence).toMatch(/pharmacology/);
        }
    });

    it('does not promise prescribing from day one', () => {
        // Arizona prescribing starts once the Board grants prescribing
        // authority; Washington's entry says nothing about timing.
        expect(metro).not.toMatch(/prescribing from day one/);
    });

    it('does not claim Ohio needs no on-site physician, which its entry does not support', () => {
        expect(metro).not.toMatch(/Ohio does not require the physician to be on-site/);
    });
});

describe('practice authority details use the article that matches "NP"', () => {
    it('writes "an NP", never "a NP"', () => {
        for (const [state, entry] of Object.entries(STATE_PRACTICE_AUTHORITY)) {
            expect(entry.details, state).not.toMatch(/\b[Aa] NP\b/);
        }
    });
});

describe('license guides: AANP tier meanings give the mechanism as an example, not the placement rule', () => {
    it('matches the shape the site-wide tier definition uses', async () => {
        const { AANP_TIER_MEANING } = await import('@/lib/blog-license-guides');
        // Read as a rule, "by requiring supervision" would make Maine,
        // Massachusetts and Nevada restricted, contradicting AANP's own map.
        expect(AANP_TIER_MEANING.reduced).toContain('for example through a regulated collaborative agreement');
        expect(AANP_TIER_MEANING.restricted).toContain('for example through supervision, delegation or team management');
        expect(AANP_TIER_MEANING.reduced).not.toMatch(/either by requiring/);
        expect(AANP_TIER_MEANING.restricted).not.toMatch(/practice by requiring/);
        for (const state of ['Maine', 'Massachusetts', 'Nevada']) {
            expect(STATE_PRACTICE_AUTHORITY[state].authority, state).toBe('full');
        }
    });
});
