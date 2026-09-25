/**
 * P1 #2 — 51-post state licensure series (content-library package).
 *
 * The series is generated deterministically by lib/blog-license-guides.ts
 * and served through lib/blog.ts (DB rows take precedence; the generator
 * is the fallback), gated by LICENSE_GUIDE_SERIES_PUBLISHED. These tests
 * enforce:
 *
 *   1. ALL-OR-NOTHING: exactly one guide per STATE_PRACTICE_AUTHORITY
 *      jurisdiction (51), and the published flag may only be true while
 *      every one of them generates a complete post — partial publication
 *      is structurally impossible.
 *   2. TRUTH RULES: every dollar figure traces to lib/stats-sources.ts;
 *      no invented fees / CE hours / processing times; certification
 *      bodies are specialty-correct; schema (faq_json, HowTo steps)
 *      derives from the same arrays as the visible markdown.
 *   3. VARIATION: FPA vs reduced vs restricted states (and member vs
 *      enacted-pending vs non-compact) read genuinely differently.
 *   4. DRIFT: the NLC mirrors (non-member AND enacted-pending sets) stay
 *      in sync with the canonical sets in lib/pseo/state-narrative.ts,
 *      and both reflect the NCSBN roster verified on
 *      NLC_ROSTER_VERIFIED_AT (2026-08-11): CT/RI/WA are members, Alaska
 *      is a non-member, Massachusetts is enacted-pending.
 *   5. THIN-CONTENT SECTIONS (PLAN C.4 item 4, thin-spec-4 3C): LIC-L1
 *      quotes each state's own rule text, LIC-L2 tables the nearby
 *      states, LIC-L3 renders a live market snapshot that links a state
 *      page only when it renders or indexes, LIC-L4 emits the HowTo from
 *      the visible steps, and no two guides share their L1 plus L2 text.
 *      The static markdown links no live page (spec4 B2). The new blocks
 *      are clay, matching the host blog pages, never the sticker kit
 *      (owner decision 2026-09-20).
 *   6. ACCURACY PASS (T0-9, spec4 B1(d)): the seven posts that printed
 *      hand-typed salary bands serve again with every figure cited from
 *      lib/stats-sources.ts inline or removed, "median" never "average",
 *      ranges reading "to", and every homepage "From the blog" card
 *      resolving. No draft mechanism exists in the .mdx loader or the sync
 *      script, so the parity test has nothing to mirror.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    LICENSE_GUIDE_STATES,
    LICENSE_GUIDE_NLC_NON_MEMBERS,
    LICENSE_GUIDE_NLC_ENACTED_PENDING,
    LICENSE_GUIDE_REVIEWED_AT,
    NLC_ROSTER_VERIFIED_AT,
    getAllLicenseGuideSlugs,
    getLicenseGuidePost,
    getLicenseGuideNearbyStates,
    buildLicenseGuideRuleText,
    buildLicenseGuideSteps,
    buildLicenseGuideFaq,
    buildLicenseGuideHowTo,
    nlcTableLabel,
} from '@/lib/blog-license-guides';
import {
    HOMEPAGE_FEATURED_POSTS,
    LICENSE_GUIDE_SERIES_PUBLISHED,
    licenseGuideSlug,
    LICENSE_GUIDE_SLUG_REGEX,
} from '@/config/niche/content-map';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { BENCHMARK_MIN_EMPLOYERS, BENCHMARK_MIN_POSTINGS } from '@/components/tools/benchmark-model';
import { emptyListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts';
import { summarizeGatedSalary, type GatedSalary } from '@/lib/salary-analytics';
import { getAllMdxPosts, getMdxPost, parseMdxFrontmatter } from '@/lib/blog-mdx-posts';
import LicenseGuideMarketSnapshot, {
    LicenseGuideNearbyStates,
    SNAPSHOT_LIST_LIMIT,
    buildSnapshotPaySentence,
    type LicenseGuideMarketSnapshotProps,
} from '@/components/blog/LicenseGuideMarketSnapshot';
import { NLC_VERIFIED_LABEL, getNearbyStates, getPracticeEnvironment } from '@/lib/pseo/practice-environment';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** U+2013, U+2014 or a spaced hyphen: banned in every rendered string (PLAN C.5). */
const DASH_RULE = /[–—]| - /;

/** The sticker kit: new blocks on the clay blog pages must not use it (owner decision 2026-09-20). */
const STICKER_RULE = /stk-|@\/components\/sticker/;

/** Visible text of rendered markup, for copy assertions that must ignore inline CSS. */
const textOf = (html: string): string => html.replace(/<[^>]+>/g, ' ');

const allPosts = LICENSE_GUIDE_STATES.map((s) => ({
    state: s,
    post: getLicenseGuidePost(s.stateSlug)!,
}));

/** NCSBN member-detail slugs that are NOT the state name minus spaces. */
const NCSBN_URL_SLUG_EXCEPTIONS: Record<string, string> = {
    'New Mexico': 'New-Mexico',
};

describe('all-or-nothing gate', () => {
    it('generates exactly one guide per practice-authority jurisdiction (51)', () => {
        const authorityStates = Object.keys(STATE_PRACTICE_AUTHORITY);
        expect(authorityStates).toHaveLength(51);
        expect(LICENSE_GUIDE_STATES).toHaveLength(51);
        const guideNames = new Set(LICENSE_GUIDE_STATES.map((s) => s.name));
        for (const name of authorityStates) {
            expect(guideNames.has(name), `no license guide for ${name}`).toBe(true);
        }
        // Every jurisdiction resolves a postal code (a key mismatch between
        // the code table and the authority dataset would interpolate
        // 'undefined' into prose).
        for (const s of LICENSE_GUIDE_STATES) {
            expect(s.code, `${s.name}: no postal code`).toMatch(/^[A-Z]{2}$/);
        }
        for (const { post } of allPosts) {
            expect(post.content).not.toContain('undefined');
        }
    });

    it('every slug follows the licenseGuideSlug() convention and matches the regex', () => {
        for (const s of LICENSE_GUIDE_STATES) {
            expect(s.slug).toBe(licenseGuideSlug(s.stateSlug));
            const m = s.slug.match(LICENSE_GUIDE_SLUG_REGEX);
            expect(m?.[1]).toBe(s.stateSlug);
        }
        expect(new Set(getAllLicenseGuideSlugs()).size).toBe(51);
    });

    it('LICENSE_GUIDE_SERIES_PUBLISHED may only be true while all 51 render completely', () => {
        if (!LICENSE_GUIDE_SERIES_PUBLISHED) return; // gate off — nothing to enforce
        for (const { state, post } of allPosts) {
            expect(post, `guide missing for ${state.name}`).toBeTruthy();
            expect(post.status).toBe('published');
            expect(post.category).toBe('state_spotlight');
            expect(post.title).toContain(state.name);
            // A complete guide, not a stub: all required sections present.
            expect(post.content).toContain(`## Practice authority in ${state.name}`);
            expect(post.content).toContain('Nurse Licensure Compact');
            expect(post.content).toContain(`## How to apply for ${state.name} APRN licensure`);
            expect(post.content).toContain(`## Renewing your ${state.name} license`);
            expect(post.content).toContain(`## What NPs earn in ${state.name}`);
            expect(post.content).toContain('## Frequently asked questions');
            expect(post.content.length).toBeGreaterThan(3000);
        }
    });

    it('lib/blog.ts serves the generator as fallback and lists the slugs', () => {
        const src = read('lib/blog.ts');
        expect(src).toContain('getLicenseGuidePost(licenseMatch[1])');
        expect(src).toContain('getAllLicenseGuideSlugs()');
        expect(src).toContain('LICENSE_GUIDE_SERIES_PUBLISHED');
    });
});

describe('truth rules', () => {
    it('the only dollar figure in any guide is the cited BLS median', () => {
        for (const { state, post } of allPosts) {
            const dollars = post.content.match(/\$[\d,.]+[KkMm+]*/g) ?? [];
            for (const d of dollars) {
                expect(d, `${state.name}: uncited dollar figure ${d}`)
                    .toBe(STAT_SOURCES.averageSalary.formatted);
            }
        }
    });

    it('no invented fees, CE hours, renewal cycles, or processing times', () => {
        for (const { state, post } of allPosts) {
            const c = post.content;
            expect(c, `${state.name}: quotes a fee amount`).not.toMatch(/fee of \$|\$\d+\s*(application|renewal|licensing)/i);
            expect(c, `${state.name}: quotes CE hours`).not.toMatch(/\b\d+\s*(contact hours|CE hours|CEUs|continuing.education hours)/i);
            expect(c, `${state.name}: quotes a processing time`).not.toMatch(/\b\d+\s*[–-]\s*\d+\s*(weeks|business days)\b/i);
            expect(c, `${state.name}: quotes a renewal cycle`).not.toMatch(/renew(al)? every \d/i);
        }
    });

    it('certification bodies are specialty-correct (AANP/ANCC NPs, NBCRNA CRNA, AMCB CNM)', () => {
        for (const { post } of allPosts) {
            expect(post.content).toContain('AANP or ANCC');
            expect(post.content).toContain('NBCRNA');
            expect(post.content).toContain('AMCB');
        }
    });

    it('every guide links its state board via the verified NCSBN directory pattern', () => {
        for (const { state, post } of allPosts) {
            const expectedSlug =
                NCSBN_URL_SLUG_EXCEPTIONS[state.name] ?? state.name.replace(/\s+/g, '');
            expect(state.boardUrl).toBe(
                `https://www.ncsbn.org/bon-member-details/${expectedSlug}`,
            );
            // Board-linked in both the application and renewal paths.
            const occurrences = post.content.split(state.boardUrl).length - 1;
            expect(occurrences, `${state.name}: board link missing`).toBeGreaterThanOrEqual(2);
            expect(post.content).toContain(state.boardName);
        }
    });

    /**
     * All 51 board URLs were requested live on 2026-07-29. New Mexico was
     * the only 404: …/NewMexico is dead, …/New-Mexico is 200 — and it is
     * an exception, not a rule (…/New-Jersey 404s), so hyphenating every
     * multi-word state would break 9 more guides.
     */
    it('New Mexico uses the hyphenated board slug (…/NewMexico is a dead link)', () => {
        const nm = LICENSE_GUIDE_STATES.find((s) => s.name === 'New Mexico')!;
        expect(nm.boardUrl).toBe('https://www.ncsbn.org/bon-member-details/New-Mexico');
        const nj = LICENSE_GUIDE_STATES.find((s) => s.name === 'New Jersey')!;
        expect(nj.boardUrl).toBe('https://www.ncsbn.org/bon-member-details/NewJersey');
    });

    /**
     * Board display names, pinned against the heading of the NCSBN page
     * each guide links to (checked live 2026-07-29). These are the names
     * the prose puts in front of the reader right before the link.
     */
    it('board display names match the linked NCSBN directory heading', () => {
        const VERIFIED: Record<string, string> = {
            'Connecticut': 'Connecticut Board of Nurse Licensure',
            'Pennsylvania': 'Pennsylvania State Board of Nursing',
            'Utah': 'Utah Board of Nursing and Certified Nurse Midwives',
            'Washington': 'Washington State Board of Nursing',
            'West Virginia': 'West Virginia Board of Registered Nurses',
            'California': 'California Board of Registered Nursing',
            'Massachusetts': 'Massachusetts Board of Registration in Nursing',
            'New York': 'New York State Board of Nursing',
            'Rhode Island': 'Rhode Island Board of Nurse Registration and Nursing Education',
            'Arizona': 'Arizona State Board of Nursing',
            'Texas': 'Texas Board of Nursing',
            'Florida': 'Florida Board of Nursing',
        };
        for (const [name, expected] of Object.entries(VERIFIED)) {
            const s = LICENSE_GUIDE_STATES.find((g) => g.name === name)!;
            expect(s.boardName, `${name}: board name drifted from the NCSBN heading`).toBe(expected);
        }
    });

    it('no guide names a superseded agency', () => {
        // Renamed agencies that shipped in the first cut. A reader who
        // searches the old name lands on a redirect at best, a defunct
        // agency at worst.
        const RETIRED = [
            'Nursing Care Quality Assurance Commission',
            'Board of Examiners for Registered Professional Nurses',
        ];
        for (const { state, post } of allPosts) {
            for (const retired of RETIRED) {
                expect(post.content, `${state.name}: names retired agency "${retired}"`)
                    .not.toContain(retired);
            }
        }
    });

    /**
     * spec4 B2: eight states have no active jobs, so /jobs/state/<s> and
     * /salary-guide/<s> 404 there. The static markdown (synced into the DB,
     * so it cannot carry a live condition) therefore links neither; the
     * live pointers render in the market snapshot, gated on the target.
     */
    it('the static markdown links no /salary-guide or /jobs/state page (live pointers moved to the snapshot)', () => {
        for (const { state, post } of allPosts) {
            expect(post.content, `${state.name}: static salary-guide link`).not.toContain('/salary-guide/');
            expect(post.content, `${state.name}: static state-hub link`).not.toContain('/jobs/state/');
            expect(post.content).toContain(`The ${state.name} job market snapshot further down this page`);
        }
    });

    it('the pay FAQ is data free: the cited BLS median plus the publishing gate, never averages or ranges', () => {
        for (const { state, post } of allPosts) {
            const payFaq = post.faq_json!.find((f) => f.name.startsWith('How much'))!;
            expect(payFaq, `${state.name}: pay FAQ missing`).toBeTruthy();
            expect(payFaq.text).toContain(STAT_SOURCES.averageSalary.formatted);
            expect(payFaq.text).toContain(`at least ${BENCHMARK_MIN_POSTINGS} postings with disclosed pay from at least ${BENCHMARK_MIN_EMPLOYERS} employers`);
            expect(payFaq.text).not.toMatch(/averages?|ranges/i);
            expect(post.content, `${state.name}: calls a median an average`).not.toMatch(/\baverages?\b/i);
        }
    });

    it('guides carry fixed editorial dates — never render-time freshness', () => {
        const src = read('lib/blog-license-guides.ts');
        expect(src).not.toMatch(/new Date\(\)/);
        for (const { post } of allPosts) {
            expect(post.reviewed_at).toBeTruthy();
            expect(post.publish_date).toBeTruthy();
        }
    });

    it('indefinite articles agree with the interpolated postal code', () => {
        // 'an AZ license' / 'a CA license' — a naive `a ${code}` template
        // reads wrong on the 30 codes that start with a vowel-sound letter.
        for (const { state, post } of allPosts) {
            const needsAn = 'AEFHILMNORSX'.includes(state.code[0]);
            const wrong = needsAn ? `a ${state.code} ` : `an ${state.code} `;
            expect(post.content, `${state.name}: "${wrong.trim()}" reads wrong`)
                .not.toContain(` ${wrong}`);
        }
    });

    it('generated content is niche-token clean (no donor reference-niche terms)', () => {
        // The Minnesota guide quotes its dataset entry verbatim, and that
        // statute's setting rule names "primary care or mental health
        // services". Strip that one exact sentence; everything else stays
        // under the scan.
        const MN_RULE = STATE_PRACTICE_AUTHORITY['Minnesota'].details;
        for (const { post } of allPosts) {
            expect(post.content.split(MN_RULE).join('')).not.toMatch(/pmhnp|psychiatric|mental health/i);
        }
    });
});

describe('schema derives from visible content', () => {
    it('faq_json (4-5 Q&As) mirrors the visible FAQ section verbatim', () => {
        for (const { state, post } of allPosts) {
            const faqs = post.faq_json!;
            expect(faqs.length).toBeGreaterThanOrEqual(4);
            expect(faqs.length).toBeLessThanOrEqual(5);
            for (const f of faqs) {
                expect(post.content, `${state.name}: FAQ question not visible`).toContain(f.name);
                expect(post.content, `${state.name}: FAQ answer not visible`).toContain(f.text);
            }
            // Same builder feeds both — deep-equal by construction.
            expect(faqs).toEqual(buildLicenseGuideFaq(state));
        }
    });

    it('HowTo steps derive from the same array as the visible apply section', () => {
        for (const { state, post } of allPosts) {
            const steps = buildLicenseGuideSteps(state);
            expect(steps).toHaveLength(6);
            const howTo = buildLicenseGuideHowTo(state.stateSlug) as {
                step: Array<{ name: string; text: string; position: number }>;
            };
            expect(howTo.step).toHaveLength(6);
            steps.forEach((step, i) => {
                expect(post.content, `${state.name}: step "${step.name}" not visible`).toContain(step.name);
                expect(howTo.step[i].name).toBe(step.name);
                expect(howTo.step[i].text).toBe(step.text);
                expect(howTo.step[i].position).toBe(i + 1);
            });
        }
    });

    it('meta descriptions stay within SERP length', () => {
        for (const { state, post } of allPosts) {
            expect(post.meta_description!.length, state.name).toBeLessThanOrEqual(165);
            expect(post.meta_description).toContain(state.name);
        }
    });
});

describe('substantial per-state variation', () => {
    const byAuthority = (a: string) =>
        allPosts.find(({ state }) => state.authority === a)!;

    it('FPA, reduced, and restricted states read genuinely differently', () => {
        const full = byAuthority('full').post.content;
        const reduced = byAuthority('reduced').post.content;
        const restricted = byAuthority('restricted').post.content;
        expect(full).toContain('full practice authority (FPA)');
        expect(full).not.toContain('restricted practice');
        expect(reduced).toContain('reduced practice');
        expect(reduced).toContain('collaborative agreement');
        expect(restricted).toContain('restricted practice');
        expect(restricted).toContain('supervision');
    });

    it('member, enacted-pending, and non-member states get three distinct NLC narratives', () => {
        const member = allPosts.find(({ state }) => state.nlcStatus === 'member')!.post.content;
        const pending = allPosts.find(({ state }) => state.nlcStatus === 'pending')!.post.content;
        const nonMember = allPosts.find(({ state }) => state.nlcStatus === 'non-member')!.post.content;
        expect(member).toContain('participates in the **Nurse Licensure Compact');
        expect(nonMember).toContain('does **not** participate');
        // The pending narrative must claim NEITHER membership NOR plain
        // non-membership — only enactment with implementation pending.
        expect(pending).toContain('enacted the Nurse Licensure Compact but not yet implemented it');
        expect(pending).toContain('to-be-determined');
        expect(pending).not.toContain('participates in the **Nurse Licensure Compact');
        expect(pending).not.toContain('does **not** participate');
    });

    it('pending states are honest in every compact-claim surface of the guide', () => {
        for (const { state, post } of allPosts) {
            if (state.nlcStatus !== 'pending') continue;
            // nlcMember must be false — pending confers nothing in practice —
            // and no surface may call the state a compact member.
            expect(state.nlcMember).toBe(false);
            expect(post.content).not.toContain(`${state.name} is a Nurse Licensure Compact member`);
            expect(post.content).not.toContain(`${state.name} is not a Nurse Licensure Compact member`);
            // Quick answer, steps, and FAQ all carry the pending branch.
            expect(post.content).toContain('implementation is pending');
            expect(post.content).toContain('implementation is still pending');
            const nlcFaq = post.faq_json!.find((f) => f.name.includes('Nurse Licensure Compact'))!;
            expect(nlcFaq.text).toMatch(/^Not yet\./);
            expect(nlcFaq.text).toContain('to-be-determined');
            // No implementation date may be asserted — NCSBN lists TBD.
            expect(post.content).not.toMatch(/implement(ation|ed|s)?[^.]*\bon (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4})/);
        }
    });

    it('every guide cites the NLC roster verification date beside its compact claim', () => {
        expect(NLC_ROSTER_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const label = new Date(`${NLC_ROSTER_VERIFIED_AT}T00:00:00Z`).toLocaleDateString(
            'en-US',
            { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' },
        );
        for (const { state, post } of allPosts) {
            expect(post.content, `${state.name}: missing roster as-of date`).toContain(label);
            expect(post.content, `${state.name}: missing live roster link`).toContain('https://www.nursecompact.com/');
        }
    });

    it('two same-authority states still differ (state + board interpolation)', () => {
        const [a, b] = allPosts.filter(({ state }) => state.authority === 'reduced');
        expect(a.post.content).not.toBe(b.post.content);
        expect(a.post.title).not.toBe(b.post.title);
    });
});

/**
 * The guard that was missing when Massachusetts and New York shipped as
 * 'reduced'.
 *
 * Every FPA guide renders STAT_SOURCES.fullPracticeStates verbatim ("one
 * of 27 states + DC"), and /jobs, /faq, /salary-guide, /editorial-policy
 * and the employer how-to-hire guide render the same figure. The
 * classification set is what decides which of the 51 guides asserts
 * "you must maintain a collaborative agreement with a physician" — in
 * body copy AND in the FAQPage JSON-LD built from faq_json. If the two
 * disagree, the series publishes a number that its own pages contradict,
 * and two states' readers get told they need a collaborating physician
 * they do not need. Tie them together so the count cannot drift again.
 */
describe('practice-authority dataset ↔ published FPA count', () => {
    const entries = Object.entries(STATE_PRACTICE_AUTHORITY);
    const fullNames = entries
        .filter(([, info]) => info.authority === 'full')
        .map(([name]) => name);

    it('the number of full-practice jurisdictions equals STAT_SOURCES.fullPracticeStates', () => {
        const includesDC = fullNames.includes('District of Columbia');
        const stateCount = fullNames.length - (includesDC ? 1 : 0);

        // e.g. '27 states + DC'
        const m = STAT_SOURCES.fullPracticeStates.formatted.match(
            /^(\d+)\s+states(\s*\+\s*DC)?$/i,
        );
        expect(m, 'unparseable fullPracticeStates format — update this guard').toBeTruthy();
        expect(
            stateCount,
            `dataset classifies ${stateCount} full-practice states but the series ` +
            `publishes "${STAT_SOURCES.fullPracticeStates.formatted}" on every FPA guide`,
        ).toBe(Number(m![1]));
        expect(Boolean(m![2]), 'DC inclusion disagrees with the published figure').toBe(includesDC);
    });

    it('the three authority buckets partition all 51 jurisdictions', () => {
        const counts = { full: 0, reduced: 0, restricted: 0 };
        for (const [, info] of entries) counts[info.authority]++;
        expect(counts.full + counts.reduced + counts.restricted).toBe(51);
        expect(counts.full).toBeGreaterThan(0);
    });

    it('New York and Massachusetts are classified full practice (AANP)', () => {
        // Both were carried as 'reduced', which is what put the dataset two
        // jurisdictions below the number the same pages publish.
        for (const name of ['New York', 'Massachusetts']) {
            expect(STATE_PRACTICE_AUTHORITY[name].authority, `${name} misclassified`).toBe('full');
        }
    });

    it('no full-practice guide asserts a physician-agreement requirement', () => {
        // The YMYL failure mode: an FPA state whose guide (and FAQPage
        // JSON-LD) tells readers they must hold a collaborative agreement.
        const FORBIDDEN = [
            /must maintain a collaborative agreement/i,
            /requires a documented collaborative agreement/i,
            /state law requires a collaborative agreement/i,
            /requires physician supervision/i,
            /\breduced practice\b/i,
            /\brestricted practice\b/i,
        ];
        for (const { state, post } of allPosts) {
            if (state.authority !== 'full') continue;
            for (const pattern of FORBIDDEN) {
                expect(post.content, `${state.name} (full): body matches ${pattern}`)
                    .not.toMatch(pattern);
                for (const faq of post.faq_json!) {
                    expect(faq.text, `${state.name} (full): faq_json matches ${pattern}`)
                        .not.toMatch(pattern);
                }
            }
        }
    });

    it('every full-practice guide states FPA in both body copy and faq_json', () => {
        for (const { state, post } of allPosts) {
            if (state.authority !== 'full') continue;
            expect(post.content).toContain('full practice authority (FPA)');
            const authorityFaq = post.faq_json![0];
            expect(authorityFaq.name).toContain(state.name);
            expect(authorityFaq.text).toMatch(/^Yes\./);
            expect(authorityFaq.text).toContain(STAT_SOURCES.fullPracticeStates.formatted);
        }
    });
});

describe('NLC status drift guard', () => {
    const src = read('lib/pseo/state-narrative.ts');
    const extractSet = (name: string): Set<string> => {
        const literal = src.match(
            new RegExp(`${name}[\\s\\S]*?new Set\\(\\[([\\s\\S]*?)\\]\\)`),
        );
        expect(literal, `canonical ${name} set not found in state-narrative.ts`).toBeTruthy();
        return new Set([...literal![1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
    };

    it('mirror non-member set matches the canonical set in lib/pseo/state-narrative.ts', () => {
        const canonical = extractSet('NLC_NON_MEMBER_STATES');
        expect(canonical.size).toBeGreaterThan(0);
        expect(new Set(LICENSE_GUIDE_NLC_NON_MEMBERS)).toEqual(canonical);
    });

    it('mirror enacted-pending set matches the canonical set in lib/pseo/state-narrative.ts', () => {
        const canonical = extractSet('NLC_ENACTED_PENDING_STATES');
        expect(canonical.size).toBeGreaterThan(0);
        expect(new Set(LICENSE_GUIDE_NLC_ENACTED_PENDING)).toEqual(canonical);
    });

    it('the two sets are disjoint and name only real jurisdictions', () => {
        const names = new Set(Object.keys(STATE_PRACTICE_AUTHORITY));
        for (const s of LICENSE_GUIDE_NLC_NON_MEMBERS) {
            expect(names.has(s), `${s}: not a known jurisdiction`).toBe(true);
            expect(LICENSE_GUIDE_NLC_ENACTED_PENDING.has(s), `${s}: in both NLC sets`).toBe(false);
        }
        for (const s of LICENSE_GUIDE_NLC_ENACTED_PENDING) {
            expect(names.has(s), `${s}: not a known jurisdiction`).toBe(true);
        }
    });

    /**
     * Accuracy pin — the defect this guard exists for. Verified against
     * the live NCSBN roster (nursecompact.com implementation table) on
     * 2026-08-11: Connecticut implemented 2025-10-01, Rhode Island
     * 2024-01-08, Washington 2024-01-31 (all three were wrongly carried
     * as non-members); Alaska has no enacted compact legislation (it was
     * missing from the set entirely); Massachusetts has enacted the
     * compact with its implementation date listed as to-be-determined.
     * If NCSBN's roster moves, re-verify live, update the sets AND
     * NLC_ROSTER_VERIFIED_AT, then update this pin.
     */
    it('reflects the NCSBN roster verified on NLC_ROSTER_VERIFIED_AT', () => {
        expect(NLC_ROSTER_VERIFIED_AT).toBe('2026-08-11');
        for (const member of ['Connecticut', 'Rhode Island', 'Washington']) {
            expect(LICENSE_GUIDE_NLC_NON_MEMBERS.has(member), `${member} is an implemented member`).toBe(false);
            expect(LICENSE_GUIDE_NLC_ENACTED_PENDING.has(member), `${member} is past pending`).toBe(false);
        }
        expect(LICENSE_GUIDE_NLC_NON_MEMBERS.has('Alaska'), 'Alaska is a non-member').toBe(true);
        expect(LICENSE_GUIDE_NLC_ENACTED_PENDING.has('Massachusetts'), 'Massachusetts is enacted-pending').toBe(true);
        expect(LICENSE_GUIDE_NLC_NON_MEMBERS.has('Massachusetts')).toBe(false);
    });
});

// ─── Thin-content sections (PLAN C.4 item 4) ────────────────────────────────

describe('LIC-L1: state rule text in the static markdown', () => {
    it('every guide quotes its own dataset entry inside the practice-authority section, with the board pointer', () => {
        for (const { state, post } of allPosts) {
            const details = STATE_PRACTICE_AUTHORITY[state.name].details;
            const rule = buildLicenseGuideRuleText(state);
            expect(rule).toContain(details);
            expect(rule).toContain(state.boardUrl);
            const start = post.content.indexOf(`## Practice authority in ${state.name}`);
            const end = post.content.indexOf('## The Nurse Licensure Compact');
            expect(start, `${state.name}: practice-authority heading`).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            expect(post.content.slice(start, end), `${state.name}: rule text outside its section`).toContain(rule);
        }
    });

    it('the 51 dataset entries are distinct, so same-tier guides no longer read identically', () => {
        const details = LICENSE_GUIDE_STATES.map((s) => STATE_PRACTICE_AUTHORITY[s.name].details);
        expect(new Set(details).size).toBe(LICENSE_GUIDE_STATES.length);
    });

    it('adding the section did not bump the review date (bump only on a real editorial review)', () => {
        expect(LICENSE_GUIDE_REVIEWED_AT).toBe('2026-07-29T00:00:00.000Z');
    });
});

describe('LIC-L2: nearby states', () => {
    it('every jurisdiction has at least two nearby guides, none of them itself', () => {
        for (const s of LICENSE_GUIDE_STATES) {
            const nearby = getLicenseGuideNearbyStates(s.name);
            expect(nearby.length, `${s.name}: nearby states`).toBeGreaterThanOrEqual(2);
            for (const near of nearby) {
                expect(near.name).not.toBe(s.name);
                expect(LICENSE_GUIDE_STATES).toContain(near);
            }
        }
        expect(getLicenseGuideNearbyStates('Atlantis')).toEqual([]);
    });

    it('the compact status has one table label per branch, none of them claiming membership for a pending state', () => {
        expect(nlcTableLabel('member')).toBe('Member');
        expect(nlcTableLabel('pending')).toBe('Enacted, implementation pending');
        expect(nlcTableLabel('non-member')).toBe('Not a member');
    });

    it('the rendered table links a sibling guide only when it is published, and cites the roster date', () => {
        const env = getPracticeEnvironment('Texas')!;
        const nearby = getNearbyStates('Texas').map((near) => ({ env: near, guideLive: near.stateName !== 'Oklahoma' }));
        expect(nearby.length).toBeGreaterThanOrEqual(2);
        const html = renderToStaticMarkup(React.createElement(LicenseGuideNearbyStates, { env, nearby }));
        const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        expect(hrefs).toContain('/blog/np-license-new-mexico');
        expect(hrefs).not.toContain('/blog/np-license-oklahoma');
        expect(html).toContain('Oklahoma');
        expect(html).toContain(NLC_VERIFIED_LABEL);
        expect(html).toMatch(/<caption[\s>]/);
        // Proximity list, so the copy says "nearby", never "bordering".
        expect(textOf(html)).not.toMatch(/border/i);
        expect(html).not.toMatch(DASH_RULE);
        expect(html).not.toMatch(STICKER_RULE);
    });

    it('no two guides share both their rule text (L1) and their nearby-states table (L2)', () => {
        const keyOf = (name: string) => {
            const s = LICENSE_GUIDE_STATES.find((g) => g.name === name)!;
            const rows = getLicenseGuideNearbyStates(name).map((n) => `${n.name}:${n.authority}:${n.nlcStatus}`);
            return `${buildLicenseGuideRuleText(s)}|${rows.join(',')}`;
        };
        const keys = LICENSE_GUIDE_STATES.map((s) => keyOf(s.name));
        expect(new Set(keys).size).toBe(LICENSE_GUIDE_STATES.length);
        // The group the crawl found identical apart from the state name.
        const formerlyIdentical = ['Colorado', 'Delaware', 'Idaho', 'Iowa', 'Maryland', 'Montana', 'Nebraska'];
        expect(new Set(formerlyIdentical.map(keyOf)).size).toBe(formerlyIdentical.length);
    });
});

describe('LIC-L3: market snapshot (components/blog/LicenseGuideMarketSnapshot.tsx)', () => {
    const NOW = new Date('2026-09-17T00:00:00.000Z');
    const facts = (overrides: Partial<ListingFacts> = {}): ListingFacts => ({ ...emptyListingFacts(NOW), ...overrides });
    const BELOW_GATE: GatedSalary = summarizeGatedSalary([]);
    const GATED: GatedSalary = {
        postings: 6, employers: 3, gatePassed: true,
        median: 130000, p25: 120000, p75: 140000, medianK: 130, p25K: 120, p75K: 140,
    };
    const render = (props: Partial<LicenseGuideMarketSnapshotProps> = {}): string =>
        renderToStaticMarkup(React.createElement(LicenseGuideMarketSnapshot, {
            stateName: 'Texas', stateCode: 'TX', stateSlug: 'texas',
            facts: facts(), salary: BELOW_GATE, salaryGuideIndexable: false,
            ...props,
        }));
    const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

    it('a zero-job state links no /jobs/state or /salary-guide page and offers the alert with an absolute date', () => {
        const html = render();
        expect(hrefs(html)).toEqual(['/job-alerts']);
        expect(html).toContain('September 17, 2026');
        expect(html).not.toContain('$');
    });

    it('below the pay gate it links the hub, prints no dollar figure and names the gate', () => {
        const html = render({ facts: facts({ total: 4, distinctEmployers: 2 }) });
        expect(hrefs(html)).toContain('/jobs/state/texas');
        expect(hrefs(html)).not.toContain('/salary-guide/texas');
        expect(html).not.toContain('$');
        expect(html).toContain(`fewer than ${BENCHMARK_MIN_POSTINGS} postings from ${BENCHMARK_MIN_EMPLOYERS} employers`);
        // Clay stat pills split the figure and the label into two spans.
        expect(html).toMatch(/>4<\/span><span[^>]*>open roles</);
        expect(html).toMatch(/>2<\/span><span[^>]*>employers</);
    });

    it('is clay, not the sticker kit, in every branch', () => {
        expect(render()).not.toMatch(STICKER_RULE);
        expect(render({ facts: facts({ total: 6, distinctEmployers: 3 }), salary: GATED, salaryGuideIndexable: true })).not.toMatch(STICKER_RULE);
    });

    it('the median prints only from a gate-passed salary, and the salary guide link only when that page indexes', () => {
        const live = facts({ total: 8, distinctEmployers: 3 });
        const indexed = render({ facts: live, salary: GATED, salaryGuideIndexable: true });
        expect(indexed).toContain('$130,000');
        expect(indexed).toContain('across 6 postings with disclosed pay from 3 employers');
        expect(hrefs(indexed)).toContain('/salary-guide/texas');
        const unindexed = render({ facts: live, salary: GATED, salaryGuideIndexable: false });
        expect(hrefs(unindexed)).not.toContain('/salary-guide/texas');
        expect(buildSnapshotPaySentence('Texas', BELOW_GATE)).not.toContain('$');
    });

    it('cities link only when the city page renders (3 or more jobs) and the slug round-trips', () => {
        const html = render({ facts: facts({
            total: 10, distinctEmployers: 4,
            cities: [
                { name: 'Austin', stateCode: 'TX', count: 4 },
                { name: 'St. Louis', stateCode: 'MO', count: 4 },
                { name: 'Waco', stateCode: 'TX', count: 2 },
            ],
        }) });
        const cityHrefs = hrefs(html).filter((h) => h.startsWith('/jobs/city/'));
        expect(cityHrefs).toEqual(['/jobs/city/austin-tx']);
        expect(html).toContain('St. Louis (4)');
        expect(html).toContain('Waco (2)');
    });

    it('employers link only when the company profile indexes (5 or more in-state jobs and a live company path)', () => {
        const html = render({ facts: facts({
            total: 15, distinctEmployers: 3,
            topEmployers: [
                { name: 'Alpha Health', count: 5, companyPath: '/companies/alpha-health' },
                { name: 'Beta Clinic', count: 4, companyPath: '/companies/beta-clinic' },
                { name: 'Gamma Group', count: 6, companyPath: null },
            ],
        }) });
        const companyHrefs = hrefs(html).filter((h) => h.startsWith('/companies/'));
        expect(companyHrefs).toEqual(['/companies/alpha-health']);
        expect(html).toContain('Beta Clinic (4)');
        expect(html).toContain('Gamma Group (6)');
    });

    it('omits every clause whose facts are missing instead of padding with zeros', () => {
        const html = render({ facts: facts({ total: 2, distinctEmployers: 0 }) });
        expect(html).not.toMatch(/\b0 employers?\b/);
        expect(html).not.toContain('The cities named');
        expect(html).not.toContain('Employers with the most');
        expect(html).not.toContain('open roles are');
    });

    it('caps the named cities and employers at SNAPSHOT_LIST_LIMIT', () => {
        const cities = Array.from({ length: 8 }, (_, i) => ({ name: `City${i}`, stateCode: 'TX', count: 8 - i }));
        const html = render({ facts: facts({ total: 30, distinctEmployers: 5, cities }) });
        expect(SNAPSHOT_LIST_LIMIT).toBe(5);
        expect(html.match(/City\d \(\d\)/g)).toHaveLength(SNAPSHOT_LIST_LIMIT);
    });

    it('renders no en dash, em dash or spaced hyphen in either branch', () => {
        expect(render()).not.toMatch(DASH_RULE);
        expect(render({ facts: facts({ total: 6, distinctEmployers: 3 }), salary: GATED, salaryGuideIndexable: true })).not.toMatch(DASH_RULE);
    });
});

describe('page wiring (app/blog/[slug]/page.tsx)', () => {
    const page = read('app/blog/[slug]/page.tsx');

    it('LIC-L4: emits the HowTo from the shared builder inside the license branch only', () => {
        expect(page).toMatch(/licenseSlugMatch \? buildLicenseGuideHowTo\(licenseSlugMatch\[1\]\) : null/);
        expect(page).toContain('toJsonLd(howTo)');
    });

    it('renders the nearby table and the market snapshot from the shared data layer', () => {
        const bands = read('components/blog/LicenseGuideMarketSnapshot.tsx');
        expect(page).toContain('<LicenseGuideBands');
        expect(bands).toContain('<LicenseGuideNearbyStates');
        expect(bands).toContain('<LicenseGuideMarketSnapshot');
        expect(bands).toContain('<table');
        expect(bands).toContain('<caption');
        expect(page).toContain('getListingFacts(');
        expect(page).toContain('getGatedLocationSalary(');
        expect(page).toContain('getNearbyStates(');
        expect(page).toContain('isLicenseGuideLive(');
    });

    it('the new blocks are clay: no sticker import, no stk- class, no <style jsx>', () => {
        const bands = read('components/blog/LicenseGuideMarketSnapshot.tsx');
        for (const [name, src] of [['page', page], ['bands', bands]] as const) {
            expect(src, `${name}: sticker kit`).not.toMatch(STICKER_RULE);
            expect(src, `${name}: style jsx`).not.toContain('<style jsx');
        }
        // The one static style string carries no interpolation (styled-jsx deadlock rule).
        const css = bands.match(/const LICENSE_BANDS_CSS = `([\s\S]*?)`;/);
        expect(css, 'static css string').not.toBeNull();
        expect(css![1]).not.toContain('${');
    });

    it('gates every state link on a render or index predicate (no unconditional salary or hub link)', () => {
        expect(page).toContain('shouldIndexSalaryGuideState(');
        expect(page).toContain('MIN_JOBS_FOR_LINK_LIST_ROW');
        expect(page).not.toMatch(/totalJobs: \{ gte: 1 \}/);
        expect(page).toMatch(/if \(salaryGuideIndexable\)/);
        expect(page).toMatch(/if \(stateHubRenders\(facts\.total\)\)/);
    });

    it('LIC-meta: title and description come from the practice environment, live clause computed in generateMetadata', () => {
        expect(page).toContain('buildLicenseGuideTitle(');
        expect(page).toContain('buildLicenseGuideDescription(');
        expect(page).toContain('COUNT_DISPLAY_FLOOR');
        expect(page).not.toContain('<style jsx');
    });
});

describe('/blog index (app/blog/page.tsx)', () => {
    const index = read('app/blog/page.tsx');

    it('lists the licensure series gated on publication and hides categories with no posts', () => {
        expect(index).toContain('LICENSE_GUIDE_SERIES_PUBLISHED');
        expect(index).toContain('isLicenseGuideLive(');
        expect(index).toContain('blog-state-pill');
        expect(index).toContain('categoriesWithPosts');
    });

    it('the licensure band is clay like the rest of the page', () => {
        expect(index).not.toMatch(STICKER_RULE);
        expect(index).not.toContain('<style jsx');
        expect(index).toMatch(/\.\.\.clayCard, padding: '24px 24px 20px'/);
    });

    it('makes no ranking, expertise or cadence claim', () => {
        // "#1" as a ranking claim, not the leading digit of a hex color.
        expect(index).not.toMatch(/#1(?![0-9A-Fa-f])/);
        expect(index).not.toMatch(/expert/i);
        expect(index).not.toMatch(/\bdaily\b/i);
        expect(index).not.toContain('No blog posts have been published yet');
    });
});

describe('accuracy pass on the posts that printed hand-typed salary bands (T0-9, spec4 B1(d))', () => {
    const REVIEWED = [
        'np-salary-guide',
        'highest-paying-np-specialties',
        'fnp-vs-pmhnp-vs-agacnp',
        'new-grad-np-first-job',
        'np-1099-vs-w2',
        'remote-telehealth-np-jobs-guide',
        'np-salary-negotiation-guide',
    ];
    const ACCURACY_PASS_DATE = '2026-09-20';
    const MDX_FILES = fs.readdirSync(path.join(ROOT, 'content', 'blog')).filter((f) => f.endsWith('.mdx'));
    const posts = REVIEWED.map((slug) => {
        const { data, content } = parseMdxFrontmatter(read(`content/blog/${slug}.mdx`));
        return { slug, data, body: content, text: `${String(data.title)} ${String(data.description)} ${content}` };
    });
    const MEDIAN = STAT_SOURCES.averageSalary.formatted;
    const GROWTH = STAT_SOURCES.blsGrowth2034.formatted;

    it('every post serves again: no takedown flag, and neither loader carries a draft mechanism', () => {
        for (const { slug, data, body } of posts) {
            expect(data.draft, `${slug}: draft flag`).toBeUndefined();
            expect(getMdxPost(slug), `${slug}: not served`).not.toBeNull();
            expect(body.trim().startsWith('**Quick answer:**'), `${slug}: quick answer`).toBe(true);
        }
        expect(getAllMdxPosts()).toHaveLength(MDX_FILES.length);
        for (const rel of ['lib/blog-mdx-posts.ts', 'scripts/sync-blog-to-db.ts']) {
            expect(read(rel), `${rel}: draft mechanism`).not.toMatch(/\bdraft\b/i);
        }
    });

    it('every homepage "From the blog" card resolves to a served post', () => {
        expect(HOMEPAGE_FEATURED_POSTS.length).toBeGreaterThan(0);
        for (const { href } of HOMEPAGE_FEATURED_POSTS) {
            const slug = href.replace('/blog/', '');
            expect(getMdxPost(slug), `${slug}: homepage card would 404`).not.toBeNull();
        }
    });

    it('every dollar figure is the cited BLS median and every percentage the cited BLS projection', () => {
        for (const { slug, body } of posts) {
            const dollars = body.match(/\$[\d][\d,.]*[KkMm]?\+?/g) ?? [];
            for (const figure of dollars) expect(figure, `${slug}: uncited dollar figure`).toBe(MEDIAN);
            if (dollars.length > 0) expect(body, `${slug}: median without its BLS OEWS citation`).toMatch(/BLS OEWS/);
            const percents = body.match(/\b\d+(?:\.\d+)?\s?%/g) ?? [];
            for (const figure of percents) expect(figure, `${slug}: uncited percentage`).toBe(GROWTH);
            if (percents.length > 0) {
                expect(body, `${slug}: projection without its cycle`).toContain('from 2024 to 2034');
                expect(body, `${slug}: projection without BLS`).toMatch(/BLS/);
            }
            if (body.includes(STAT_SOURCES.fullPracticeStates.formatted)) {
                expect(body, `${slug}: FPA count without AANP`).toMatch(/AANP/);
            }
            if (body.includes(STAT_SOURCES.hrsaShortagePopulation.formatted)) {
                expect(body, `${slug}: shortage figure without HRSA`).toMatch(/HRSA/);
                expect(body, `${slug}: shortage figure must say primary care`).toMatch(/primary.care/i);
            }
        }
    });

    it('says median, never average; ranges read "to"; no dash, trend word or freshness claim', () => {
        for (const { slug, text } of posts) {
            expect(text, `${slug}: dash`).not.toMatch(DASH_RULE);
            expect(text, `${slug}: "average" as a pay word`).not.toMatch(/\baverages?\b/i);
            expect(text, `${slug}: trend word`).not.toMatch(/\bgrowing\b|\bcontinues? to grow\b|\bfastest\b/i);
            expect(text, `${slug}: freshness claim`).not.toMatch(/\b(?:added|updated|refreshed) daily\b/i);
            expect(text, `${slug}: band presented as a market statistic`).not.toMatch(/commonly post(?:s|ing)? in/i);
            expect(text, `${slug}: hand-typed band`).not.toMatch(/\$\d+K|\$\d+ to \$\d+|\$\d[\d,.]*K?\s*-\s*\$?\d/);
            expect(text, `${slug}: uncited "cost of living"`).not.toMatch(/\bcost[- ]of[- ]living\b/i);
        }
    });

    it('the review date moved with the rewrite, on or after the accuracy pass and never before the publish date', () => {
        for (const { slug, data } of posts) {
            const reviewed = Date.parse(String(data.reviewed));
            expect(Number.isFinite(reviewed), `${slug}: reviewed`).toBe(true);
            expect(reviewed, `${slug}: reviewed before the accuracy pass`).toBeGreaterThanOrEqual(Date.parse(ACCURACY_PASS_DATE));
            expect(reviewed, `${slug}: reviewed before published`).toBeGreaterThanOrEqual(Date.parse(String(data.date)));
        }
    });
});

describe('copy rules (PLAN C.5)', () => {
    it('no generated guide, description, FAQ or HowTo step carries an en dash, em dash or spaced hyphen', () => {
        for (const { state, post } of allPosts) {
            expect(post.content, state.name).not.toMatch(DASH_RULE);
            expect(post.meta_description, state.name).not.toMatch(DASH_RULE);
            expect(post.title, state.name).not.toMatch(DASH_RULE);
            for (const f of post.faq_json!) {
                expect(`${f.name} ${f.text}`, state.name).not.toMatch(DASH_RULE);
            }
            for (const step of buildLicenseGuideSteps(state)) {
                expect(`${step.name} ${step.text}`, state.name).not.toMatch(DASH_RULE);
            }
        }
    });
});
