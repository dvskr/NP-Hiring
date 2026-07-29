/**
 * P3 #5 remainder — the last two guides on the content worklist:
 * NP malpractice insurance, and the NP credentialing checklist.
 *
 * Both ship through the mechanism P1 established and P2 extended: .mdx in
 * content/blog/, published by scripts/sync-blog-to-db.ts (which extracts
 * the visible "Frequently asked questions" section into faq_json → the
 * FAQPage JSON-LD emitted by app/blog/[slug]/page.tsx), bylined by
 * components/EditorialByline.tsx, and wired into the job-page sidebar
 * slots in config/niche/content-map.ts.
 *
 * WHY THESE TWO GET THEIR OWN SUITE
 * Every other pillar on this board is career advice. These two are
 * REGULATED-ADJACENT: one describes an insurance product, the other a
 * compliance process, and both are read by someone about to sign
 * something. The failure mode is not a stale number — it is a confident
 * specific that was never true. So this suite pins a *stricter* contract
 * than the P1/P2 provenance ratchets:
 *
 *   - The P1/P2 rule is "a dollar figure must trace to a repo source".
 *     Here there is NO sourceable money figure at all — no premium, no
 *     limit structure, no fee lives in lib/stats-sources.ts,
 *     config/niche/salary.ts, or anywhere else — so the rule is ZERO
 *     dollar figures. Same for percentages.
 *   - NO invented durations. Credentialing timelines, renewal cycles,
 *     and tail periods are set by 51 boards, every payer, and one
 *     committee's calendar. app/resources/private-practice-guide/page.tsx
 *     already publishes "This process takes 90-180 days" with no source
 *     (see the note on the timeline test below); these pages must not add
 *     a second unsourced number, and they explain who owns the clock
 *     instead.
 *   - NO carrier or commercial-payer names. Naming one is a
 *     recommendation whether or not the sentence says so, and this board
 *     has no basis for one. Medicare and Medicaid are exempt: they are
 *     government programs the enrollment mechanics literally cannot be
 *     described without.
 *   - NO per-state requirement claims. The pages route every "what does
 *     my state require" question to the board, via the licensure series
 *     and /tools/licensure-checker.
 *   - Every external link goes to a government body, a board/accreditor,
 *     a certifying body, or the named system of record — never a carrier,
 *     broker, or content site.
 *
 * The shared shape rules (frontmatter, Quick-answer opener, FAQ block,
 * bold-led block rendering, internal-link resolution) mirror
 * tests/regressions/p2-content-pillars-guides.test.ts deliberately: these
 * posts render through the same bespoke converter in lib/blog.ts, so the
 * same authoring hazards apply.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RELATED_BLOG_SLUGS, LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';
import { BLOG_CATEGORIES } from '@/lib/blog-categories';
import { markdownToHtml } from '@/lib/blog';
import { STAT_SOURCES } from '@/lib/stats-sources';

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, 'app');
const BLOG_DIR = path.join(ROOT, 'content', 'blog');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The two guides authored in this package. */
const P3_SLUGS = ['np-malpractice-insurance-guide', 'np-credentialing-checklist'] as const;

const CATEGORY_IDS = new Set<string>(BLOG_CATEGORIES.map((c) => c.id));

function parsePost(slug: string): { fm: Record<string, string>; body: string } {
    const raw = fs.readFileSync(path.join(BLOG_DIR, `${slug}.mdx`), 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    const fm: Record<string, string> = {};
    if (m) {
        for (const line of m[1].split(/\r?\n/)) {
            const idx = line.indexOf(':');
            if (idx <= 0) continue;
            let value = line.slice(idx + 1).trim();
            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))
            ) {
                value = value.slice(1, -1);
            }
            fm[line.slice(0, idx).trim()] = value;
        }
    }
    return { fm, body: m ? m[2] : raw };
}

/** Same counter the P1/P2 suites use, so the bands are comparable. */
function wordCount(markdown: string): number {
    return markdown
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#*`>|]/g, '')
        .split(/\s+/)
        .filter(Boolean).length;
}

const BODIES = P3_SLUGS.map((slug) => ({ slug, ...parsePost(slug) }));

describe('content-map wiring', () => {
    const linked = new Set([
        ...RELATED_BLOG_SLUGS.always,
        ...RELATED_BLOG_SLUGS.remoteOrTelehealth,
        ...RELATED_BLOG_SLUGS.newGrad,
        ...RELATED_BLOG_SLUGS.generalFallback,
    ]);

    it('both guides are linked from a sidebar slot and resolve to a real .mdx', () => {
        for (const slug of P3_SLUGS) {
            expect(linked.has(slug), `${slug} not wired into config/niche/content-map.ts`).toBe(true);
            expect(
                fs.existsSync(path.join(BLOG_DIR, `${slug}.mdx`)),
                `content/blog/${slug}.mdx missing — sidebar link drops silently, fork-preflight fails`,
            ).toBe(true);
        }
    });

    /**
     * The sidebar renders at most 3 slugs and `always` consumes one, so only
     * the first two generalFallback entries can appear on a plain job page.
     * These two guides were APPENDED to the tail on purpose — credentialing
     * and coverage are post-offer questions, and displacing interview prep or
     * the resume guide for them would be a downgrade. Guards the invariant
     * tests/regressions/p2-content-pillars-guides.test.ts also asserts, from
     * the side that could break it.
     */
    it('appending did not displace the job-page-relevant pillars', () => {
        expect(RELATED_BLOG_SLUGS.generalFallback.slice(0, 2)).toEqual([
            'np-interview-questions',
            'np-resume-guide',
        ]);
        const tail = RELATED_BLOG_SLUGS.generalFallback.slice(-2);
        expect(new Set(tail)).toEqual(new Set(P3_SLUGS));
    });
});

describe('post shape', () => {
    for (const slug of P3_SLUGS) {
        it(`${slug}: frontmatter, category, length, quick answer, FAQ`, () => {
            const { fm, body } = parsePost(slug);
            expect(fm.title, 'title missing').toBeTruthy();
            expect(fm.slug, 'slug missing or mismatched').toBe(slug);
            expect(fm.description, 'description missing').toBeTruthy();
            expect(fm.date, 'date missing').toBeTruthy();
            expect(fm.reviewed, 'reviewed date missing').toBeTruthy();
            expect(CATEGORY_IDS.has(fm.category), `invalid category '${fm.category}'`).toBe(true);

            // The P3 brief's band. Narrower than P2's 900–2600 because
            // neither of these is a numbered-deliverable post: everything
            // past the mechanics is padding on a page a reader is scanning
            // before signing something.
            const words = wordCount(body);
            expect(words, `${slug}: ${words} words — under the 900-word pillar floor`).toBeGreaterThanOrEqual(900);
            expect(words, `${slug}: ${words} words — over the 1500-word ceiling`).toBeLessThanOrEqual(1500);

            // Hoisted into the .ed-quick-answer callout by app/blog/[slug]/page.tsx.
            expect(body).toMatch(/\*\*Quick answer:\*\*/);

            // scripts/sync-blog-to-db.ts extracts THIS exact heading into
            // faq_json, the only source of the FAQPage JSON-LD — so schema
            // can never diverge from visible content.
            expect(body).toMatch(/^## Frequently asked questions/m);
            const faqSection = body.split(/^## Frequently asked questions/m)[1];
            const questions = faqSection.match(/^### .+$/gm) ?? [];
            expect(questions.length, 'need at least 3 FAQ questions').toBeGreaterThanOrEqual(3);
            // Every answer must be non-empty, or extractFaqFromMarkdown drops
            // the question and the schema silently shrinks.
            for (const q of questions) {
                const after = faqSection.slice(faqSection.indexOf(q) + q.length);
                const answer = after.split(/^### /m)[0].replace(/[#*`>|]/g, '').trim();
                expect(answer.length, `FAQ "${q}" has no answer body`).toBeGreaterThan(60);
            }

            expect((body.match(/^## /gm) ?? []).length, 'need 2+ H2s for the Key Takeaways block').toBeGreaterThanOrEqual(2);
        });
    }

    /**
     * The byline is not authored per post — app/blog/[slug]/page.tsx renders
     * components/EditorialByline.tsx for every post, and that component
     * refuses to invent a reviewer (brand.editorial.reviewer is null, so the
     * schema stays Organization-only). Asserted here because these are the
     * two pages on the board where a fabricated clinical byline would do the
     * most damage.
     */
    it('the editorial byline comes from the shared component, not post copy', () => {
        const page = read('app/blog/[slug]/page.tsx');
        expect(page).toContain("import EditorialByline, { editorialSchemaFields } from '@/components/EditorialByline'");
        expect(page).toContain('...editorialSchemaFields(),');
        for (const { slug, body } of BODIES) {
            expect(body, `${slug}: hand-written byline in post copy`).not.toMatch(/reviewed by|written by/i);
        }
    });
});

/**
 * REACHABILITY on /resources.
 *
 * app/resources/page.tsx splits DB posts on `state_spotlight` (those go to
 * the licensure grid, where every slug must match LICENSE_GUIDE_SLUG_REGEX
 * or it is dropped by .filter(Boolean) and appears NOWHERE). Everything
 * else falls through to the article grid, which groups by category and
 * styles each group from CATEGORY_CONFIG — a category with no entry there
 * renders under its raw id. That is the whole wiring these two need on the
 * listing: no hardcoded /blog/<slug> hrefs were added, because those would
 * be live internal 404s in the window between deploying this file and
 * running scripts/sync-blog-to-db.ts against prod (the hazard
 * config/niche/content-map.ts documents for HOMEPAGE_FEATURED_POSTS).
 */
describe('reachable from /resources', () => {
    const resources = read('app/resources/page.tsx');

    it('the category split these posts rely on is still the one in the page', () => {
        expect(resources).toContain("p.category === 'state_spotlight'");
        expect(resources).toContain("p.category !== 'state_spotlight'");
    });

    for (const slug of P3_SLUGS) {
        it(`${slug}: filed under a styled, non-state_spotlight category`, () => {
            const category = parsePost(slug).fm.category;
            expect(category, 'state_spotlight would route it into the licensure grid and drop it').not.toBe('state_spotlight');
            expect(LICENSE_GUIDE_SLUG_REGEX.test(slug)).toBe(false);
            expect(
                resources,
                `app/resources/page.tsx has no CATEGORY_CONFIG entry for '${category}' — the group renders under the raw id`,
            ).toContain(`${category}: { label:`);
        });
    }

    /**
     * No sitemap change is needed and none was made: blog URLs come from
     * getAllPublishedSlugs() (a DB read), so both posts enter the sitemap
     * the moment the sync script publishes them. Pinned so a future move to
     * a hardcoded route list does not silently drop them.
     */
    it('blog sitemap entries stay DB-derived (no hardcoded route list to update)', () => {
        const sitemap = read('app/sitemap.ts');
        expect(sitemap).toContain("import { getAllPublishedSlugs } from '@/lib/blog'");
        expect(sitemap).toContain('await getAllPublishedSlugs()');
    });
});

/**
 * ── TRUTH RULES ────────────────────────────────────────────────────────
 * The reason this suite exists. Each rule below names a specific invented
 * specific that would be harmful on these two topics.
 */
describe('truth rules for regulated-adjacent content', () => {
    /**
     * ZERO money. Stricter than the P1/P2 "trace it to a repo source"
     * ratchet, because for these topics there is nothing to trace TO:
     * premiums, limit structures, credentialing fees, and enrollment costs
     * appear in no repo source of truth. The pages describe per-claim and
     * aggregate limits, defense-costs-inside-or-outside, deductibles and
     * sub-limits as MECHANICS, and send the reader to a licensed agent for
     * numbers.
     */
    it('publishes no dollar figure of any kind', () => {
        for (const { slug, body } of BODIES) {
            expect(
                body.match(/\$\s?[\d]/g) ?? [],
                `${slug}: a dollar figure on a page that must not price insurance or credentialing`,
            ).toEqual([]);
        }
    });

    it('publishes no percentage or quantified proportion', () => {
        for (const { slug, body } of BODIES) {
            expect(body.match(/\b\d+(\.\d+)?\s?%/g) ?? [], `${slug}: percentage with no source`).toEqual([]);
            expect(
                body.match(
                    /(?<!\b(?:upper|lower|top|bottom|first|second|latter|back)\s)\b(half|a third|a quarter|two[- ]thirds|three[- ]quarters|the majority)\s+of\b/gi,
                ) ?? [],
                `${slug}: quantified proportion with no source`,
            ).toEqual([]);
        }
    });

    /**
     * NO invented durations — the single most damaging failure available on
     * these two topics.
     *
     * Credentialing turnaround, payer effective-date windows, board renewal
     * cycles, statute-of-limitations periods, and tail reporting windows are
     * all set by third parties and revised without notice. There is no repo
     * source for any of them. app/resources/private-practice-guide/page.tsx
     * already ships "This process takes 90-180 days" and "Board
     * certification typically renews every 5 years" (app/faq/page.tsx) with
     * no citation — pre-existing debt this package does not own and did not
     * copy. These pages state WHO owns each step instead, and say in the
     * copy that a published number is a guess.
     */
    it('quotes no processing time, renewal cycle, or reporting window', () => {
        const DURATION = /\b\d+\s*(?:[-–]|to)?\s*\d*\s*(?:business\s+)?(?:day|week|month|year|hour|minute)s?\b/gi;
        for (const { slug, body } of BODIES) {
            expect(body.match(DURATION) ?? [], `${slug}: invented duration`).toEqual([]);
            expect(body.match(/\bevery\s+\d+\s+(?:day|week|month|year)s?\b/gi) ?? [], `${slug}: renewal cycle length`).toEqual([]);
            expect(body.match(/\b\d+[-\s]?(?:day|week|month|year)\s+(?:renewal|cycle|window|period)\b/gi) ?? [], `${slug}: cycle length`).toEqual([]);
        }
        // …and the credentialing page says so explicitly, so the policy is
        // legible to the next editor rather than only to this test.
        const cred = parsePost('np-credentialing-checklist').body;
        expect(cred).toMatch(/treat any published average as a guess/i);
        expect(cred).toMatch(/Nobody can tell you how long/i);
    });

    /**
     * NO carrier or commercial-payer names. Naming one on a page a reader
     * uses to choose coverage is a recommendation regardless of how the
     * sentence is phrased, and nothing in this repo supports one. Medicare
     * and Medicaid are exempt — they are government programs, and the
     * enrollment mechanics cannot be described without them.
     */
    it('names no insurance carrier, broker, or commercial payer', () => {
        const FORBIDDEN = [
            // Malpractice / professional-liability carriers and brokers.
            'NSO', 'Nurses Service Organization', 'CM&F', 'Proliability', 'Berxi', 'Hiscox',
            'The Doctors Company', 'MedPro', 'Coverys', 'ProAssurance', 'NORCAL', 'Curi',
            'Chubb', 'Travelers', 'Liberty Mutual', 'Hanover',
            // Commercial health plans.
            'Aetna', 'Cigna', 'UnitedHealthcare', 'United Healthcare', 'Humana', 'Anthem',
            'Blue Cross', 'BCBS', 'Kaiser', 'Centene', 'Molina',
        ];
        for (const { slug, body } of BODIES) {
            const hits = FORBIDDEN.filter((name) => new RegExp(`\\b${name.replace(/[&]/g, '\\&')}\\b`, 'i').test(body));
            expect(hits, `${slug}: names a carrier or commercial payer`).toEqual([]);
        }
    });

    /**
     * NO coverage prescription. "You need $X" and "prefer an occurrence
     * policy" are the two shapes to keep out: the first invents a number,
     * the second makes a purchasing recommendation this board cannot
     * support (app/resources/private-practice-guide/page.tsx currently
     * carries the second — pre-existing, not owned here).
     */
    it('prescribes no policy form or limit, and routes the question outward', () => {
        const malp = parsePost('np-malpractice-insurance-guide').body;
        expect(malp, 'recommends a policy form').not.toMatch(/prefer (?:an|a) (?:occurrence|claims-made)/i);
        expect(malp, 'prescriptive coverage advice').not.toMatch(/\bwe recommend\b/i);
        expect(malp, 'prescriptive coverage advice').not.toMatch(/\byou (?:need|must) (?:to )?(?:buy|carry|purchase|get)\b/i);
        // The escape hatch that replaces the prescription.
        expect(malp).toMatch(/There is no universal figure/i);
        expect(malp).toMatch(/licensed agent/i);
        expect(malp).toMatch(/declarations page/i);
        // And the page states its own contract up front.
        expect(malp).toMatch(/no premiums, no carrier recommendations/i);
    });

    /**
     * NO per-state requirement claims. Both pages route "what does my state
     * require" to the board, via the licensure series and the checker — the
     * same rule lib/blog-ceu-guide.ts applies to CE hours.
     */
    it('asserts no per-state or universal requirement', () => {
        for (const { slug, body } of BODIES) {
            expect(body, `${slug}: universal requirement claim`).not.toMatch(/\b(?:all|every) states? (?:require|requires|mandate)/i);
            expect(body, `${slug}: prevalence claim about state law`).not.toMatch(/\bmost states? (?:require|requires|allow|allows)/i);
            expect(body, `${slug}: names board rules it cannot source`).not.toMatch(/your state (?:requires|mandates) (?:a|an|that)/i);
            // Hedged form is required wherever state law is invoked at all.
            if (/state law|board rule/i.test(body)) {
                expect(body, `${slug}: invokes state law without pointing at the board`).toMatch(/board of nursing|licensure checker|\/tools\/licensure-checker/);
            }
        }
    });

    /**
     * FPA citation carries the AANP vintage and the transition-to-practice
     * caveat — the same rule the P2 suite applies. The malpractice page
     * turns the classification into a claim about what an NP may DO
     * (collaborative agreements as liability documents), which is exactly
     * where day-one independence must not be overstated.
     */
    it('the FPA count matches lib/stats-sources.ts, with vintage and caveat', () => {
        const fpa = STAT_SOURCES.fullPracticeStates;
        expect(fpa.formatted).toBe('27 states + DC');
        for (const { slug, body } of BODIES) {
            if (!body.includes(fpa.formatted)) continue;
            expect(body, `${slug}: FPA count without AANP attribution`).toMatch(/AANP/);
            expect(body, `${slug}: FPA count without the AANP vintage (${fpa.asOf})`).toContain(fpa.asOf);
            expect(body, `${slug}: FPA claim with no transition-to-practice caveat`).toMatch(/transition-to-practice/i);
            expect(body, `${slug}: FPA count not linked to the AANP source`).toContain(fpa.sourceUrl);
        }
    });

    /**
     * Certification bodies must be role-correct wherever named: AANP/ANCC
     * certify NPs, NBCRNA certifies CRNAs, AMCB certifies CNMs. Both pages
     * name them (credentialing as a primary-source-verification target,
     * malpractice as the authority on what a credential requires), so both
     * have to get the mapping right.
     */
    it('certification bodies are role-correct on both pages', () => {
        for (const { slug, body } of BODIES) {
            expect(body, `${slug}: NP bodies missing`).toMatch(/AANP/);
            expect(body, `${slug}: NP bodies missing`).toMatch(/ANCC/);
            expect(body, `${slug}: CRNA body missing`).toMatch(/NBCRNA/);
            expect(body, `${slug}: CNM body missing`).toMatch(/AMCB/);
            // Role mapping, checked in a window around each mention rather
            // than by one brittle regex: the failure to catch is "ANCC or
            // AANP" offered as the answer for every APRN role.
            // Window starts AFTER the token, so `near('NBCRNA')` cannot
            // satisfy /CRNA/ from the acronym itself.
            const near = (needle: string, window = 120) => {
                const i = body.indexOf(needle);
                return i === -1 ? '' : body.slice(i + needle.length, i + needle.length + window);
            };
            expect(near('NBCRNA'), `${slug}: NBCRNA not tied to CRNAs`).toMatch(/CRNA/);
            expect(near('AMCB'), `${slug}: AMCB not tied to nurse-midwives`).toMatch(/nurse-midwi|CNM/i);
        }
    });

    it('no fabricated people, quotes, testimonials, or inventory claims', () => {
        for (const { slug, body } of BODIES) {
            expect(body, slug).not.toMatch(/testimonial/i);
            expect(body, slug).not.toMatch(/—\s*[A-Z][a-z]+ [A-Z]\.,/);
            expect(body, slug).not.toMatch(/10,000\+|3,000\+|#1 (job board|source)/i);
            expect(body, slug).not.toMatch(/\b\d{1,3}(,\d{3})?\+ (open )?(positions|jobs|employers|companies)\b/i);
        }
    });

    /**
     * Every external link is a government body, a board or accreditor, a
     * certifying body, or the named system of record. This is the positive
     * half of the no-carriers rule: the pages tell readers to verify, so
     * where they send them is load-bearing.
     */
    it('every external link points at an authoritative body', () => {
        const ALLOWED_HOSTS = new Set([
            // Federal / state government
            'www.hrsa.gov', 'www.npdb.hrsa.gov', 'oig.hhs.gov', 'sam.gov',
            'nppes.cms.hhs.gov', 'pecos.cms.hhs.gov', 'www.cms.gov', 'www.medicaid.gov',
            'www.deadiversion.usdoj.gov',
            // Boards, regulators, accreditors
            'www.ncsbn.org', 'www.nursys.com', 'content.naic.org', 'www.ncqa.org',
            'www.jointcommission.org',
            // Professional associations and certifying bodies
            'www.aanp.org', 'www.aanpcert.org', 'www.nursingworld.org', 'www.nbcrna.com',
            'www.amcbmidwife.org',
            // Named system of record for payer credentialing
            'www.caqh.org',
        ]);
        for (const { slug, body } of BODIES) {
            const urls = [...body.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
            expect(urls.length, `${slug}: cites no authoritative body at all`).toBeGreaterThan(3);
            for (const url of urls) {
                expect(url.startsWith('https://'), `${slug}: non-https external link ${url}`).toBe(true);
                const host = new URL(url).host;
                expect(ALLOWED_HOSTS.has(host), `${slug}: external link to a non-authoritative host (${host})`).toBe(true);
            }
        }
    });

    /** Each page must actually reach the bodies its own topic depends on. */
    it('each page links the bodies its topic depends on', () => {
        const malp = parsePost('np-malpractice-insurance-guide').body;
        for (const host of ['npdb.hrsa.gov', 'content.naic.org', 'www.ncsbn.org', 'www.aanp.org']) {
            expect(malp, `malpractice guide does not link ${host}`).toContain(host);
        }
        const cred = parsePost('np-credentialing-checklist').body;
        for (const host of [
            'www.nursys.com', 'npdb.hrsa.gov', 'oig.hhs.gov', 'nppes.cms.hhs.gov',
            'pecos.cms.hhs.gov', 'www.caqh.org', 'www.ncqa.org', 'www.jointcommission.org',
        ]) {
            expect(cred, `credentialing checklist does not link ${host}`).toContain(host);
        }
    });

    /**
     * The credentialing page's core distinction. Collapsing credentialing,
     * privileging, and payer enrollment into one "credentialing" process is
     * the error that makes every timeline and billing question unanswerable,
     * and it is the error most content on this topic makes.
     */
    it('the credentialing page separates verification, privileging, and enrollment', () => {
        const cred = parsePost('np-credentialing-checklist').body;
        expect(cred).toMatch(/primary source verification/i);
        expect(cred).toMatch(/privileging/i);
        expect(cred).toMatch(/payer enrollment/i);
        expect(cred).toMatch(/CAQH/);
        expect(cred).toMatch(/effective date/i);
        // Identifier hygiene — the same rule np-resume-guide.mdx applies.
        expect(cred, 'no identifier-hygiene warning for license/NPI/DEA numbers')
            .toMatch(/license, NPI, and DEA numbers/i);
    });

    /**
     * NPI entity types: a Type 2 is triggered by INCORPORATION, not by owning
     * a practice.
     *
     * Per CMS — the NPI application form CMS-10114 and the sole-proprietor NPI
     * fact sheet — a sole proprietorship is Entity Type 1 (Individual) and may
     * obtain only ONE NPI. That holds even when it has employees, and even
     * when it holds an EIN (it still reports the owner's SSN). Only an
     * incorporated individual is two entities: a Type 1 for the person and a
     * Type 2 for the corporation. So "a practice you own needs both" is false
     * for exactly the reader most likely to act on it — the NP opening a solo
     * practice, whom this page routes to /resources/private-practice-guide.
     *
     * Pinned because this was the one universal, unhedged claim on an
     * otherwise carefully hedged page, and "a confident specific that was
     * never true" is the precise failure mode this suite's header names. The
     * qualifier is asserted IN the sentence that makes the claim, not merely
     * somewhere on the page, so a future edit cannot satisfy it from a
     * paragraph the reader will not connect to the rule.
     */
    it('ties a Type 2 NPI to incorporation, not to owning a practice', () => {
        const cred = parsePost('np-credentialing-checklist').body;
        expect(cred, 'ownership alone does not create a Type 2 NPI obligation')
            .not.toMatch(/a practice you own needs both/i);
        const npiClaim = cred.split(/\r?\n/).find((line) => /Type 1 NPI/.test(line)) ?? '';
        expect(npiClaim, 'no line states the NPI entity-type rule at all').toBeTruthy();
        expect(npiClaim, 'Type 2 obligation asserted without the incorporation qualifier')
            .toMatch(/incorporat/i);
        expect(npiClaim, 'no sole-proprietor carve-out in the sentence making the claim')
            .toMatch(/sole proprietor/i);
    });

    /** The malpractice page's core distinctions. */
    it('the malpractice page covers form, tail, limits, and employer scope', () => {
        const malp = parsePost('np-malpractice-insurance-guide').body;
        expect(malp).toMatch(/occurrence/i);
        expect(malp).toMatch(/claims-made/i);
        expect(malp).toMatch(/retroactive date/i);
        expect(malp).toMatch(/extended reporting period/i);
        expect(malp).toMatch(/prior acts/i);
        expect(malp).toMatch(/aggregate limit/i);
        expect(malp).toMatch(/defense costs (?:inside|outside)/i);
        expect(malp).toMatch(/consent to settle|consent-to-settle/i);
        // The point of the whole page: the employer's policy protects the
        // employer, and it is scoped to the employer's work.
        expect(malp).toMatch(/bought the policy to protect itself/i);
        expect(malp).toMatch(/Coverage follows the employer's work/i);
    });
});

/**
 * The repo ships its own markdown converter (lib/blog.ts), not a standard
 * one, so markdown a normal renderer would handle can land on the page as
 * raw pipes or literal asterisks. Same checks as the P2 suite.
 */
describe('markdown survives the repo converter', () => {
    for (const { slug, body } of BODIES) {
        it(`${slug}: renders without leaking raw markdown`, () => {
            const html = markdownToHtml(body);
            expect(html, 'unconverted bold markers').not.toMatch(/\*\*/);
            const outsideTables = html.replace(/<table[\s\S]*?<\/table>/g, '');
            expect(outsideTables, 'a markdown table did not parse').not.toMatch(/\|\s*---/);
            expect(html, 'the comparison table did not render').toContain('<table>');
            const faqCount = (body.split(/^## Frequently asked questions/m)[1].match(/^### /gm) ?? []).length;
            expect((html.match(/<h3 id="/g) ?? []).length).toBeGreaterThanOrEqual(faqCount);
        });
    }

    /**
     * Header/body cell counts must match. A GFM table written with an EMPTY
     * leading header cell (`| | Occurrence | Claims-made |`) silently
     * misaligns: markdownToHtml filters empty cells out of the header row
     * but keeps every non-empty body cell, so the table renders with fewer
     * <th> than <td> and the columns shift. Both tables here name their
     * first column for that reason.
     */
    it('table header and body cell counts agree', () => {
        for (const { slug, body } of BODIES) {
            const html = markdownToHtml(body);
            const ths = (html.match(/<th /g) ?? []).length;
            const bodyRows = (html.match(/<tr>/g) ?? []).length - 1; // minus the header row
            const tds = (html.match(/<td /g) ?? []).length;
            expect(ths, `${slug}: no header cells`).toBeGreaterThan(1);
            expect(tds, `${slug}: header/body column mismatch — check for an empty leading header cell`).toBe(ths * bodyRows);
        }
    });

    /**
     * `.editorial-prose` sets no white-space override, so a standalone
     * `**Label.** text` line emits a bare <strong> with no <p> wrapper and
     * consecutive ones collapse into one run-on paragraph. The list form
     * (`- **Label.** …`) is the fix. Only the Quick-answer opener is exempt
     * — app/blog/[slug]/page.tsx hoists that one into its own callout.
     */
    for (const { slug, body } of BODIES) {
        it(`${slug}: no unwrapped bold-led block`, () => {
            const offenders = markdownToHtml(body)
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.startsWith('<strong>'))
                .filter((line) => !/^<strong>\s*Quick\s+answer/i.test(line));
            expect(offenders.map((o) => o.slice(0, 80)), `${slug}: bold-led line(s) with no <p>/<li> wrapper`).toEqual([]);
        });
    }

    it('no body line opens with ** except the Quick answer', () => {
        for (const { slug, body } of BODIES) {
            const leads = (body.match(/^\*\*.*$/gm) ?? []).filter((l) => !/^\*\*Quick answer:\*\*/.test(l));
            expect(leads.map((l) => l.slice(0, 60)), `${slug}: bold-led line(s)`).toEqual([]);
        }
    });
});

describe('internal links resolve to real routes', () => {
    /** True when `/a/b` is served by app/a/b/page.tsx (dynamic segments allowed). */
    function appRouteExists(pathname: string): boolean {
        const segments = pathname.split('/').filter(Boolean);
        let dir = APP_DIR;
        for (const segment of segments) {
            const literal = path.join(dir, segment);
            if (fs.existsSync(literal) && fs.statSync(literal).isDirectory()) {
                dir = literal;
                continue;
            }
            const dynamic = fs
                .readdirSync(dir, { withFileTypes: true })
                .find((e) => e.isDirectory() && /^\[.+\]$/.test(e.name));
            if (!dynamic) return false;
            dir = path.join(dir, dynamic.name);
        }
        return ['page.tsx', 'page.ts', 'route.ts'].some((f) => fs.existsSync(path.join(dir, f)));
    }

    function resolves(href: string): boolean {
        const pathname = href.split(/[?#]/)[0];
        const blog = pathname.match(/^\/blog\/([^/]+)$/);
        if (blog) {
            return (
                fs.existsSync(path.join(BLOG_DIR, `${blog[1]}.mdx`)) ||
                LICENSE_GUIDE_SLUG_REGEX.test(blog[1])
            );
        }
        return appRouteExists(pathname);
    }

    for (const { slug, body } of BODIES) {
        it(`${slug}: every internal href reaches a real page`, () => {
            const hrefs = [...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
            expect(hrefs.length, 'post has no internal links at all').toBeGreaterThan(3);
            const dead = [...new Set(hrefs)].filter((h) => !resolves(h));
            expect(dead, `${slug}: internal href(s) with no route`).toEqual([]);
        });
    }

    /** Anchor text naming the specialty hub must not point at the state hub. */
    it('"specialty" anchors point at the specialty hub', () => {
        for (const { slug, body } of BODIES) {
            for (const [, text, href] of body.matchAll(/\[([^\]]*specialty[^\]]*)\]\((\/[^)\s]*)\)/gi)) {
                expect(href, `${slug}: "${text}" links to ${href}`).toBe('/salary-guide/specialty');
            }
        }
    });

    /**
     * Cross-links into the licensure series and the sibling guides — the
     * connective tissue the P3 brief asks for. Asserted by target so a
     * future edit cannot quietly orphan these pages.
     */
    it('both guides cross-link the licensure series and each other', () => {
        for (const { slug, body } of BODIES) {
            expect(body, `${slug}: no route into the licensure series`).toContain('/tools/licensure-checker');
        }
        expect(parsePost('np-credentialing-checklist').body).toContain('/blog/np-malpractice-insurance-guide');
        expect(parsePost('np-malpractice-insurance-guide').body).toContain('/resources/fpa-guide');
    });
});

/**
 * FAQ → schema, one source. The sync script extracts the visible FAQ into
 * faq_json and the post page emits FAQPage JSON-LD from faq_json ONLY, so
 * invisible FAQ markup (a spam-policy violation) is structurally
 * impossible. Asserted by reading source rather than importing, because
 * scripts/sync-blog-to-db.ts throws at module load without
 * PROD_DATABASE_URL.
 */
describe('FAQPage schema derives from the visible FAQ', () => {
    it('the sync script extracts the same heading these posts use', () => {
        const sync = read('scripts/sync-blog-to-db.ts');
        expect(sync).toContain('export function extractFaqFromMarkdown');
        expect(sync).toMatch(/\^##\\s\+Frequently asked questions/);
        expect(sync).toContain('faqJson: faqJson ?? Prisma.DbNull');
    });

    it('the post page emits FAQPage JSON-LD from faq_json only', () => {
        const page = read('app/blog/[slug]/page.tsx');
        expect(page).toContain('post.faq_json');
        expect(page).toContain("'@type': 'FAQPage'");
    });
});
