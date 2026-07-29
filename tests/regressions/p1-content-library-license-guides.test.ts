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
 *   3. VARIATION: FPA vs reduced vs restricted states (and compact vs
 *      non-compact) read genuinely differently.
 *   4. DRIFT: the NLC membership mirror stays in sync with the canonical
 *      set in lib/pseo/state-narrative.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    LICENSE_GUIDE_STATES,
    LICENSE_GUIDE_NLC_NON_MEMBERS,
    getAllLicenseGuideSlugs,
    getLicenseGuidePost,
    buildLicenseGuideSteps,
    buildLicenseGuideFaq,
    buildLicenseGuideHowTo,
} from '@/lib/blog-license-guides';
import {
    LICENSE_GUIDE_SERIES_PUBLISHED,
    licenseGuideSlug,
    LICENSE_GUIDE_SLUG_REGEX,
} from '@/config/niche/content-map';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import { STAT_SOURCES } from '@/lib/stats-sources';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

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

    it('salary tie-in links the live state salary page instead of restating state figures', () => {
        for (const { state, post } of allPosts) {
            expect(post.content).toContain(`/salary-guide/${state.stateSlug}`);
            expect(post.content).toContain(`/jobs/state/${state.stateSlug}`);
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
        for (const { post } of allPosts) {
            expect(post.content).not.toMatch(/pmhnp|psychiatric|mental health/i);
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

    it('compact and non-compact states get different NLC narratives', () => {
        const member = allPosts.find(({ state }) => state.nlcMember)!.post.content;
        const nonMember = allPosts.find(({ state }) => !state.nlcMember)!.post.content;
        expect(member).toContain('participates in the **Nurse Licensure Compact');
        expect(nonMember).toContain('does **not** participate');
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

describe('NLC membership drift guard', () => {
    it('mirror set matches the canonical set in lib/pseo/state-narrative.ts', () => {
        const src = read('lib/pseo/state-narrative.ts');
        const setLiteral = src.match(
            /NLC_NON_MEMBER_STATES[\s\S]*?new Set\(\[([\s\S]*?)\]\)/,
        );
        expect(setLiteral, 'canonical NLC set not found in state-narrative.ts').toBeTruthy();
        const canonical = new Set(
            [...setLiteral![1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
        );
        expect(canonical.size).toBeGreaterThan(0);
        expect(new Set(LICENSE_GUIDE_NLC_NON_MEMBERS)).toEqual(canonical);
    });
});
