/**
 * Generic practice-authority copy may describe a TIER, never a STATE.
 *
 * The 2026-09 audit corrected every entry in lib/state-practice-authority.ts.
 * The generic explainers around those entries (the FPA guide, the private
 * practice guide, the category FAQ, the /jobs FAQ and the homepage FAQ) kept
 * turning the tier into a per-state rule: Full Practice meant "without
 * physician oversight", Reduced meant a physician agreement with no on-site
 * presence, Restricted meant physician supervision, and every non-full state
 * needed "a collaborating or supervising physician in place first". Each of
 * those contradicts corrected rows printed on the same pages.
 *
 * This file pins two things:
 *   1. the tier-as-rule phrases are gone from the owned sources, and the
 *      replacement copy carries the within-tier warning;
 *   2. every generic claim the new copy makes ("several Full Practice states
 *      require a transition period", "several Reduced and Restricted states
 *      offer a route out", "some states require your collaborator to be
 *      licensed there") is still backed by the verified details. If a
 *      details string changes so a claim loses its evidence, this fails and
 *      the copy has to be reviewed with it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { STATE_PRACTICE_AUTHORITY, type PracticeAuthority } from '@/lib/state-practice-authority';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { getCategoryFaqs } from '@/lib/pseo/category-faq-data';
import { buildHomepageFaqs } from '@/components/HomepageFAQ';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Drop block comments and whole-line `//` comments: the files' own history notes quote the removed phrases. */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FPA_GUIDE = 'app/resources/fpa-guide/page.tsx';
const PRIVATE_PRACTICE_GUIDE = 'app/resources/private-practice-guide/page.tsx';
const JOBS_PAGE = 'app/jobs/page.tsx';
const HOMEPAGE_FAQ = 'components/HomepageFAQ.tsx';
const CATEGORY_FAQ_DATA = 'lib/pseo/category-faq-data.ts';

const OWNED_SOURCES = [FPA_GUIDE, PRIVATE_PRACTICE_GUIDE, JOBS_PAGE, HOMEPAGE_FAQ, CATEGORY_FAQ_DATA] as const;

/** Tier-as-rule phrases the verified rows contradict. */
const TIER_AS_RULE: readonly RegExp[] = [
    /without physician oversight/i,
    /Schedule II-V/i,
    /does not need to be on-?site/i,
    /in place first/i,
    /requires physician supervision/i,
    /requiring physician supervision/i,
    /requiring a collaborative agreement with a physician/i,
    /prescribing is independent/i,
    /prescribe independently/i,
    /the remaining states require/i,
    /can practice independently there/i,
    /possible but not recommended/i,
    /no physician agreement is required/i,
    /elsewhere a collaborative or supervisory agreement with a physician is required/i,
    /you must maintain the required collaborative or supervisory arrangement/i,
];

const detailsOf = (state: string): string => {
    const entry = STATE_PRACTICE_AUTHORITY[state];
    expect(entry, `${state} missing from the dataset`).toBeDefined();
    return entry.details;
};

const authorityOf = (state: string): PracticeAuthority => STATE_PRACTICE_AUTHORITY[state].authority;

describe('generic tier copy: the tier-as-rule phrases are gone', () => {
    it.each(OWNED_SOURCES)('%s carries no tier-as-rule phrase outside comments', (rel) => {
        const src = stripComments(read(rel));
        for (const phrase of TIER_AS_RULE) {
            expect(src, `${rel}: ${phrase}`).not.toMatch(phrase);
        }
    });
});

describe('generic tier copy: the replacement says what AANP means and that states differ', () => {
    it('the FPA guide attributes each tier to AANP and pairs it with how states inside it differ', () => {
        const src = read(FPA_GUIDE);
        for (const tier of ['full', 'reduced', 'restricted']) {
            expect(src).toContain(`AANP places a state here when {AANP_TIER_MEANING.${tier}}.`);
            expect(src).toContain(`{TIER_VARIATION.${tier}}`);
        }
        // The two tier FAQs render AANP's meaning and the within-tier warning.
        expect(src).toContain('AANP classifies a state as Full Practice when ${AANP_TIER_MEANING.full}.');
        expect(src).toContain('${WITHIN_TIER_NOTE} Classifications change');
        // The source URL the paraphrases were read from is recorded.
        expect(src).toContain(STAT_SOURCES.fullPracticeStates.sourceUrl);
    });

    it('the FPA guide shows each state entry at phone width, since the copy sends readers there', () => {
        const src = read(FPA_GUIDE);
        expect(src).toContain('<p className="md:hidden mt-2 text-xs"');
        expect(src.match(/\{info\.details\}/g)).toHaveLength(2);
    });

    it('the category practice-authority answer cites AANP and warns that states differ', () => {
        const faq = getCategoryFaqs({ category: 'family-practice', totalJobs: 7 })
            .find((f) => f.question.includes('practice independently'));
        expect(faq).toBeDefined();
        expect(faq!.answer).toContain(STAT_SOURCES.fullPracticeStates.formatted);
        expect(faq!.answer).toContain(STAT_SOURCES.fullPracticeStates.source);
        expect(faq!.answer).toContain('transition period of collaborative or supervised practice');
        expect(faq!.answer).toContain('route out of it after a set amount of experience');
    });

    it.each([
        ['outpatient', 'private practice'],
        ['1099', 'practice authority matter'],
    ] as const)('the %s practice-authority answer reuses the attributed tier passage', (category, cue) => {
        const faq = getCategoryFaqs({ category, totalJobs: 7 }).find((f) => f.question.includes(cue));
        expect(faq, `${category}: ${cue}`).toBeDefined();
        expect(faq!.answer).toContain(STAT_SOURCES.fullPracticeStates.source);
        expect(faq!.answer).toContain('transition period of collaborative or supervised practice');
        expect(faq!.answer).toContain('route out of it after a set amount of experience');
    });

    it('the unused StateFAQ component, which read the tier as a per-state rule, stays deleted', () => {
        expect(fs.existsSync(path.join(ROOT, 'components/StateFAQ.tsx'))).toBe(false);
    });

    it('the homepage prescribing and private practice answers carry the transition warning', () => {
        const faqs = buildHomepageFaqs([]);
        const prescribe = faqs.find((f) => f.question.includes('prescribe'));
        const practice = faqs.find((f) => f.question.includes('private practice'));
        expect(prescribe?.answer).toContain('transition period');
        expect(practice?.answer).toContain('transition period of collaborative or supervised practice');
        expect(practice?.answer).toContain('Full Practice Authority guide');
    });

    /**
     * AANP's Full Practice definition ends "under the exclusive licensure
     * authority of the state board of nursing". "Exclusive" is the word that
     * sets the Full tier apart: Reduced and Restricted NPs also hold a board
     * of nursing license. Every owned Full-tier definition keeps it, and the
     * rendered FAQ answers (which feed FAQPage JSON-LD) carry it.
     */
    it.each(OWNED_SOURCES)('%s never cites the board of nursing licensure authority without "exclusive"', (rel) => {
        const src = stripComments(read(rel));
        const uses = src.match(/\S+ licensure authority of the state board of nursing/g) ?? [];
        for (const use of uses) {
            expect(use, rel).toBe('exclusive licensure authority of the state board of nursing');
        }
    });

    it('every rendered Full-tier definition keeps "exclusive licensure authority"', () => {
        const EXCLUSIVE = 'under the exclusive licensure authority of the state board of nursing';
        const category = getCategoryFaqs({ category: 'family-practice', totalJobs: 7 })
            .find((f) => f.question.includes('practice independently'));
        const homepage = buildHomepageFaqs([]);
        const prescribe = homepage.find((f) => f.question.includes('prescribe'));
        const practice = homepage.find((f) => f.question.includes('private practice'));
        expect(category?.answer).toContain(EXCLUSIVE);
        expect(prescribe?.answer).toContain(EXCLUSIVE);
        expect(practice?.answer).toContain(EXCLUSIVE);
        expect(read(JOBS_PAGE)).toContain(EXCLUSIVE);
        expect(read(FPA_GUIDE)).toContain(EXCLUSIVE);
    });

    it('the /jobs FAQ answer and the private practice step carry the transition warning', () => {
        expect(read(JOBS_PAGE)).toContain('Several of those states first require a transition period of collaborative or supervised practice');
        expect(read(PRIVATE_PRACTICE_GUIDE)).toContain('Several Full Practice states first require a transition period of collaborative or supervised practice.');
    });
});

describe('generic tier copy: every generic claim is backed by the verified details', () => {
    /** "Several Full Practice states require a transition period ... or limit prescribing." */
    const FULL_TRANSITION_EVIDENCE: Record<string, RegExp> = {
        Colorado: /provisional prescriptive authority/,
        Connecticut: /in collaboration with a physician for at least three years/,
        Maine: /under the supervision of a licensed physician/,
        Massachusetts: /supervises their prescribing/,
        Minnesota: /under a collaborative agreement/,
        Nevada: /only under a protocol approved by a collaborating physician/,
        'New York': /in collaboration with a physician/,
        'South Dakota': /written collaborative agreement/,
        Vermont: /collaborative provider agreement/,
    };

    /** "Several Reduced and Restricted states offer a route out of the agreement or supervision, or out of part of it." */
    const ROUTE_OUT_EVIDENCE: Record<string, RegExp> = {
        Arkansas: /certificate of full independent practice authority/,
        Illinois: /until they obtain full practice authority/,
        Kentucky: /may prescribe without these agreements/,
        'New Jersey': /without a joint protocol/,
        'West Virginia': /removal of that requirement/,
        Wisconsin: /qualify for independent practice/,
        California: /without standardized procedures/,
        Florida: /register for autonomous practice/,
        Oklahoma: /independent prescriptive authority/,
        Virginia: /practice without a practice agreement/,
    };

    it('several Full Practice states still require a transition period or limit prescribing', () => {
        for (const [state, evidence] of Object.entries(FULL_TRANSITION_EVIDENCE)) {
            expect(authorityOf(state), state).toBe('full');
            expect(detailsOf(state), state).toMatch(evidence);
        }
        expect(Object.keys(FULL_TRANSITION_EVIDENCE).length).toBeGreaterThanOrEqual(3);
    });

    it('several Reduced and several Restricted states offer a route out', () => {
        const byTier: Record<PracticeAuthority, number> = { full: 0, reduced: 0, restricted: 0 };
        for (const [state, evidence] of Object.entries(ROUTE_OUT_EVIDENCE)) {
            expect(detailsOf(state), state).toMatch(evidence);
            byTier[authorityOf(state)] += 1;
        }
        expect(byTier.full).toBe(0);
        expect(byTier.reduced).toBeGreaterThanOrEqual(3);
        expect(byTier.restricted).toBeGreaterThanOrEqual(3);
    });

    it('most Reduced and Restricted states require an agreement, supervision or delegation', () => {
        const nonFull = Object.values(STATE_PRACTICE_AUTHORITY).filter((s) => s.authority !== 'full');
        const withArrangement = nonFull.filter((s) =>
            /collaborat|supervis|delegat|practice agreement|joint protocol/i.test(s.details),
        );
        expect(withArrangement.length * 2).toBeGreaterThan(nonFull.length);
    });

    it('some Reduced and Restricted states treat controlled substances more strictly than other drugs', () => {
        expect(authorityOf('Kentucky')).toBe('reduced');
        expect(detailsOf('Kentucky')).toMatch(/separate agreements for nonscheduled legend drugs and for controlled substances/);
        expect(authorityOf('Michigan')).toBe('restricted');
        expect(detailsOf('Michigan')).toMatch(/nonscheduled prescription drugs on their own authority/);
    });

    it('some states require the collaborator to hold a license in that state', () => {
        expect(detailsOf('South Dakota')).toMatch(/licensed in South Dakota/);
        expect(detailsOf('Vermont')).toMatch(/Vermont licensed/);
    });
});

describe('fpa-guide: tier meanings and the within-tier warning cannot mislead', () => {
    const src = read(FPA_GUIDE);

    it("keeps AANP's opening clause and gives the mechanism only as an example", () => {
        // An earlier wording made the mechanism the placement rule ("restricts
        // at least one element ... by requiring supervision"). Read that way,
        // the page's own table contradicted itself: Maine, Massachusetts and
        // Nevada would be Restricted and CT, MN, NY, SD and VT Reduced, while
        // AANP lists all eight as Full Practice.
        expect(src).toContain('reduces the ability of ${NP}s to engage in at least one element of ${NP} practice, for example through');
        expect(src).toContain('restricts the ability of ${NP}s to engage in at least one element of ${NP} practice, for example through');
        expect(src).not.toMatch(/restricts at least one element of \$\{NP\} practice by requiring/);
        expect(src).not.toMatch(/reduces at least one element of \$\{NP\} practice, either by requiring/);
        for (const state of ['Maine', 'Massachusetts', 'Nevada', 'Connecticut', 'Minnesota', 'New York', 'South Dakota', 'Vermont']) {
            expect(authorityOf(state), state).toBe('full');
        }
    });

    it('names Full Practice states in the within-tier warning, so it cannot be read as the Restricted tier', () => {
        // The note follows the Restricted clause in FAQ 2, which is also the
        // FAQPage JSON-LD answer. "Several of these states" there read as the
        // Restricted states and hid the Full Practice transition warning.
        const note = src.match(/const WITHIN_TIER_NOTE = `([^`]*)`/)?.[1] ?? '';
        expect(note).toContain('Several Full Practice states require a transition period');
        expect(note).not.toMatch(/Several of these states/);
    });

    it('never makes a prescribing limit a condition of independent practice', () => {
        // Colorado's verified row says its NPs practice independently while
        // prescribing is still provisional, so "limit prescribing, before an
        // NP practices independently" was false for it.
        expect(src).not.toMatch(/or limit prescribing, before/);
        expect(src).toContain('some limit prescribing for newer ${NP}s');
        expect(detailsOf('Colorado')).toMatch(/practice independently/);
    });
});
