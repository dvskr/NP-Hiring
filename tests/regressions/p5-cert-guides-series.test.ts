/**
 * P5 certification guide series (A3) — the track→body router
 * (np-certification-overview) and three deep-dives: the FNP two-body
 * choice (fnp-certification-aanp-vs-ancc), the PMHNP two-body choice
 * (pmhnp-certification-guide), and the adult-gero acute/primary split
 * (agacnp-vs-agpcnp).
 *
 * All four ship through the mechanism P1 established and P2/P3/P4
 * extended: .mdx in content/blog/, published by scripts/sync-blog-to-db.ts
 * (which extracts the visible "Frequently asked questions" section into
 * faq_json → the FAQPage JSON-LD emitted by app/blog/[slug]/page.tsx),
 * bylined by components/EditorialByline.tsx, and wired into the job-page
 * sidebar slots in config/niche/content-map.ts.
 *
 * WHY THIS SUITE EXISTS
 * Certification-body facts are the single most harmful thing to get wrong
 * on these pages: a reader who routes a verification request — or worse, an
 * exam application — to the wrong body loses real time and money, and a
 * page that claims a body certifies a track it does not — OR denies a real
 * accredited credential pathway — is misinformation on a YMYL surface. The
 * pairings below are the SAME ones lib/pseo/category-city-template.tsx
 * publishes on every category×city FAQ (its CATEGORY_CREDENTIALS map):
 *
 *   FNP    → AANPCB (FNP-C) or ANCC (FNP-BC)
 *   AGPCNP → AANPCB (A-GNP) or ANCC (AGPCNP-BC)
 *   AGACNP → ANCC (AGACNP-BC) or AACN (ACNPC-AG)   [critical-care AACN]
 *   PMHNP  → ANCC (PMHNP-BC) or AANPCB (PMHNP-C)
 *            [AANPCB launched PMHNP-C in 2024; ABSNC-accredited Jan 2025,
 *             NCCA-accredited effective June 11, 2025 — "ANCC-only" is a
 *             pre-2024 claim and must never reappear on these pages]
 *   PNP    → PNCB (CPNP-PC / CPNP-AC)
 *   NNP    → NCC (NNP-BC)      WHNP → NCC (WHNP-BC)
 *   CRNA   → NBCRNA            CNM  → AMCB
 *   CNS    → ANCC (AGCNS-BC) or AACN (ACCNS)
 *
 * Beyond the pairings, the guides are MECHANICS-ONLY by design: no fees,
 * no question counts, no pass rates, no clinical-hour requirements, no
 * renewal-cycle lengths — every one of those is set and revised by the
 * certifying bodies, lives in no repo source of truth, and is linked to
 * the body's own handbook instead. Same contract as the P3/P4 guides,
 * same rendering hazards (the bespoke converter in lib/blog.ts), same
 * shape rules.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RELATED_BLOG_SLUGS, LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';
import { BLOG_CATEGORIES } from '@/lib/blog-categories';
import { markdownToHtml } from '@/lib/blog';

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, 'app');
const BLOG_DIR = path.join(ROOT, 'content', 'blog');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The four guides authored in this package. */
const ROUTER_SLUG = 'np-certification-overview';
const FNP_SLUG = 'fnp-certification-aanp-vs-ancc';
const PMHNP_SLUG = 'pmhnp-certification-guide';
const AG_SLUG = 'agacnp-vs-agpcnp';
const P5_SLUGS = [ROUTER_SLUG, FNP_SLUG, PMHNP_SLUG, AG_SLUG] as const;

/** All four guides carry a comparison table — the PMHNP guide gained one
 *  when the track became two-body (AANPCB's PMHNP-C, launched 2024). */
const TABLE_SLUGS = [ROUTER_SLUG, FNP_SLUG, PMHNP_SLUG, AG_SLUG] as const;

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

/** Same counter the P1–P4 suites use, so the bands are comparable. */
function wordCount(markdown: string): number {
    return markdown
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#*`>|]/g, '')
        .split(/\s+/)
        .filter(Boolean).length;
}

const BODIES = P5_SLUGS.map((slug) => ({ slug, ...parsePost(slug) }));

describe('content-map wiring', () => {
    const linked = new Set([
        ...RELATED_BLOG_SLUGS.always,
        ...RELATED_BLOG_SLUGS.remoteOrTelehealth,
        ...RELATED_BLOG_SLUGS.newGrad,
        ...RELATED_BLOG_SLUGS.generalFallback,
    ]);

    it('all four guides are linked from a sidebar slot and resolve to a real .mdx', () => {
        for (const slug of P5_SLUGS) {
            expect(linked.has(slug), `${slug} not wired into config/niche/content-map.ts`).toBe(true);
            expect(
                fs.existsSync(path.join(BLOG_DIR, `${slug}.mdx`)),
                `content/blog/${slug}.mdx missing — sidebar link drops silently, fork-preflight fails`,
            ).toBe(true);
        }
    });

    /**
     * Both ENDS of generalFallback belong to other suites (P2 pins the
     * first two, P3 the last two) and the P4 wedges must also stay
     * mid-list. This package inserts MID-LIST, after the specialty
     * comparison it extends — asserted from this side too, so a reorder
     * cannot satisfy this suite while breaking another package's contract.
     */
    it('insertion disturbed neither end of generalFallback nor the P4 wedges', () => {
        const fb = RELATED_BLOG_SLUGS.generalFallback;
        expect(fb.slice(0, 2)).toEqual(['np-interview-questions', 'np-resume-guide']);
        expect(new Set(fb.slice(-2))).toEqual(
            new Set(['np-credentialing-checklist', 'np-malpractice-insurance-guide']),
        );
        for (const slug of [...P5_SLUGS, 'how-to-evaluate-np-programs', 'np-preceptor-guide']) {
            const i = fb.indexOf(slug);
            expect(i, `${slug} not in generalFallback`).toBeGreaterThan(1);
            expect(i, `${slug} landed in the P3-owned tail`).toBeLessThan(fb.length - 2);
        }
    });
});

describe('post shape', () => {
    for (const slug of P5_SLUGS) {
        it(`${slug}: frontmatter, category, length, quick answer, FAQ`, () => {
            const { fm, body } = parsePost(slug);
            expect(fm.title, 'title missing').toBeTruthy();
            expect(fm.slug, 'slug missing or mismatched').toBe(slug);
            expect(fm.description, 'description missing').toBeTruthy();
            expect(fm.date, 'date missing').toBeTruthy();
            expect(fm.reviewed, 'reviewed date missing').toBeTruthy();
            expect(CATEGORY_IDS.has(fm.category), `invalid category '${fm.category}'`).toBe(true);
            // state_spotlight routes into the /resources licensure grid,
            // where a non-license slug is dropped by the regex filter and
            // appears nowhere.
            expect(fm.category).not.toBe('state_spotlight');
            expect(LICENSE_GUIDE_SLUG_REGEX.test(slug)).toBe(false);

            // The brief's band for the series.
            const words = wordCount(body);
            expect(words, `${slug}: ${words} words — under the 900-word floor`).toBeGreaterThanOrEqual(900);
            expect(words, `${slug}: ${words} words — over the 1500-word ceiling`).toBeLessThanOrEqual(1500);

            // Hoisted into the .ed-quick-answer callout by app/blog/[slug]/page.tsx.
            expect(body).toMatch(/\*\*Quick answer:\*\*/);

            // scripts/sync-blog-to-db.ts extracts THIS exact heading into
            // faq_json, the only source of the FAQPage JSON-LD.
            expect(body).toMatch(/^## Frequently asked questions/m);
            const faqSection = body.split(/^## Frequently asked questions/m)[1];
            const questions = faqSection.match(/^### .+$/gm) ?? [];
            expect(questions.length, 'need at least 3 FAQ questions').toBeGreaterThanOrEqual(3);
            for (const q of questions) {
                const after = faqSection.slice(faqSection.indexOf(q) + q.length);
                const answer = after.split(/^### /m)[0].replace(/[#*`>|]/g, '').trim();
                expect(answer.length, `FAQ "${q}" has no answer body`).toBeGreaterThan(60);
            }

            expect((body.match(/^## /gm) ?? []).length, 'need 2+ H2s for the Key Takeaways block').toBeGreaterThanOrEqual(2);
        });

        it(`${slug}: filed under a category /resources styles`, () => {
            const resources = read('app/resources/page.tsx');
            const category = parsePost(slug).fm.category;
            expect(
                resources,
                `app/resources/page.tsx has no CATEGORY_CONFIG entry for '${category}' — the group renders under the raw id`,
            ).toContain(`${category}: { label:`);
        });
    }

    /**
     * The byline is not authored per post — app/blog/[slug]/page.tsx renders
     * components/EditorialByline.tsx for every post, and that component
     * refuses to invent a reviewer. An invented "reviewed by" line on a
     * certification-choice page would be a fabricated credential attached to
     * a YMYL recommendation.
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
 * ── TRUTH RULES ────────────────────────────────────────────────────────
 * Mechanics-only: every number a candidate actually needs (fees, question
 * counts, pass rates, clinical hours, renewal-cycle lengths, eligibility
 * windows) is set and revised by a certifying body. Quoting one here
 * publishes a figure with no repo source that goes stale on the body's
 * schedule; the guides link the handbooks instead.
 */
describe('truth rules for the certification series', () => {
    it('publishes no dollar figure of any kind', () => {
        for (const { slug, body } of BODIES) {
            expect(
                body.match(/\$\s?[\d]/g) ?? [],
                `${slug}: a dollar figure on a page that must not price exams or renewals`,
            ).toEqual([]);
        }
    });

    it('publishes no percentage and no pass-rate claim', () => {
        for (const { slug, body } of BODIES) {
            expect(body.match(/\b\d+(\.\d+)?\s?%/g) ?? [], `${slug}: percentage with no source`).toEqual([]);
            expect(body, `${slug}: pass-rate claim — the bodies publish these, this repo does not`).not.toMatch(/pass(?:ing)? rate/i);
        }
    });

    it('quotes no duration, hour count, question count, or renewal-cycle length', () => {
        const DURATION = /\b\d+\s*(?:[-–]|to)?\s*\d*\s*(?:business\s+)?(?:day|week|month|year|semester|hour|minute)s?\b/gi;
        for (const { slug, body } of BODIES) {
            expect(body.match(DURATION) ?? [], `${slug}: invented duration or cycle length`).toEqual([]);
            expect(
                body.match(/\b\d[\d,]*\s*(?:clinical|contact|practice|direct[- ]care)\s+hours?\b/gi) ?? [],
                `${slug}: a clinical-hour requirement this repo cannot source`,
            ).toEqual([]);
            expect(
                body.match(/\b\d+\s*(?:scored\s+|unscored\s+)?(?:questions?|items?)\b/gi) ?? [],
                `${slug}: an exam question count this repo cannot source`,
            ).toEqual([]);
        }
    });

    /**
     * NO per-state requirement claims. Which certifications a board accepts
     * and what else licensure takes is 51 boards' turf — the guides route
     * every such question to the board via the licensure checker, the same
     * rule the license-guide series applies to CE hours.
     */
    it('asserts no per-state or universal requirement', () => {
        for (const { slug, body } of BODIES) {
            expect(body, `${slug}: universal requirement claim`).not.toMatch(/\b(?:all|every) states? (?:require|requires|mandate)/i);
            expect(body, `${slug}: prevalence claim about state law`).not.toMatch(/\bmost states? (?:require|requires|allow|allows)/i);
            expect(body, `${slug}: names board rules it cannot source`).not.toMatch(/your state (?:requires|mandates) (?:a|an|that)/i);
            // State law is invoked on every page (scope, licensure) — each
            // must route the reader to the board, not answer for it.
            expect(body, `${slug}: invokes state regulation without pointing at the board`).toMatch(
                /board of nursing|\/tools\/licensure-checker/,
            );
            expect(body, `${slug}: no route into the licensure series`).toContain('/tools/licensure-checker');
        }
    });

    /**
     * BODY↔CREDENTIAL PAIRINGS — the rule this whole package exists for.
     * Each credential token's first mention must sit next to its correct
     * certifying body, and the classic wrong pairings are denied outright.
     * These are the same pairings lib/pseo/category-city-template.tsx and
     * app/salary-guide/specialty/specialty-config.ts publish (asserted
     * against their source below), so no surface can disagree about who
     * certifies a track.
     */
    it('FNP guide: FNP-C is AANPCB and FNP-BC is ANCC, never crossed', () => {
        const body = parsePost(FNP_SLUG).body;
        expect(body).toMatch(/AANPCB\s*\(FNP-C\)/);
        expect(body).toMatch(/ANCC\s*\(FNP-BC\)/);
        expect(body, 'FNP-C misattributed to ANCC').not.toMatch(/ANCC\s*\(FNP-C\)/);
        expect(body, 'FNP-BC misattributed to AANPCB').not.toMatch(/AANPCB\s*\(FNP-BC\)/);
        expect(body).toContain('https://www.aanpcert.org/');
        expect(body).toContain('https://www.nursingworld.org/ancc/');
        // The FNP guide once framed itself as "the one NP track" with a
        // body choice and called PMHNP "ANCC-only" — both false since
        // AANPCB's PMHNP-C launched in 2024.
        expect(body, 'FNP guide resurrects the ANCC-only PMHNP claim').not.toMatch(/ANCC[- ]only|only ANCC/i);
        expect(body, 'FNP guide claims to be the only track with a body choice').not.toMatch(/\bone NP track\b|\bonly NP track\b/i);
    });

    it('PMHNP guide: two-body track — PMHNP-BC is ANCC, PMHNP-C is AANPCB, never crossed', () => {
        const body = parsePost(PMHNP_SLUG).body;
        // The pairings, both present and never crossed (same shape as FNP).
        expect(body).toMatch(/ANCC\s*\(PMHNP-BC\)/);
        expect(body).toMatch(/AANPCB\s*\(PMHNP-C\)/);
        expect(body, 'PMHNP-BC misattributed to AANPCB').not.toMatch(/AANPCB\s*\(PMHNP-BC\)/);
        expect(body, 'PMHNP-C misattributed to ANCC').not.toMatch(/ANCC\s*\(PMHNP-C\)/);
        expect(body).toContain('https://www.aanpcert.org/');
        expect(body).toContain('https://www.nursingworld.org/ancc/');
        // PMHNP-C is real: AANPCB launched it in 2024 (ABSNC-accredited
        // Jan 2025, NCCA-accredited effective June 11, 2025, and listed in
        // AANPCB's live exam catalog). The guide must say when the second
        // body arrived — the date is what obsoletes the "ANCC-only" claim.
        expect(body).toMatch(/AANPCB[^#]*?\b2024\b/);
        // The pre-2024 falsehoods this suite once pinned must never
        // reappear: denying AANPCB's exam, calling ANCC the only/sole body,
        // or telling readers to treat PMHNP-C as an error.
        expect(body, "denies AANPCB's real PMHNP exam").not.toMatch(/AANPCB does not (?:offer|certify)/i);
        expect(body, 'resurrects the sole-body claim').not.toMatch(/\bsole certifying body\b/i);
        expect(body, 'resurrects the ANCC-only claim').not.toMatch(/ANCC[- ]only|only ANCC|single certifying body|single national certification|one-body|one-exam track/i);
        expect(body, 'still calls the real PMHNP-C credential an error').not.toMatch(/PMHNP-C[^.]*\b(?:error|typo|fake|does not exist)\b/i);
    });

    it('adult-gero guide: acute pairs with ANCC/AACN, primary with ANCC/AANPCB', () => {
        const body = parsePost(AG_SLUG).body;
        // First mention of each credential sits next to its body (window
        // starts AFTER the token so the acronym cannot satisfy itself).
        const near = (needle: string, window = 130) => {
            const i = body.indexOf(needle);
            return i === -1 ? '' : body.slice(i + needle.length, i + needle.length + window);
        };
        expect(near('AGACNP-BC'), 'AGACNP-BC not tied to ANCC').toMatch(/ANCC/);
        expect(near('ACNPC-AG'), 'ACNPC-AG not tied to AACN').toMatch(/AACN/);
        expect(near('AGPCNP-BC'), 'AGPCNP-BC not tied to ANCC').toMatch(/ANCC/);
        expect(near('A-GNP'), 'A-GNP not tied to AANPCB').toMatch(/AANPCB/);
        // The classic wrong pairings, denied.
        expect(body, 'acute credential misattributed to AANPCB').not.toMatch(/AANPCB[^.\n]{0,40}\b(?:AGACNP-BC|ACNPC-AG)\b/);
        expect(body, 'primary credential misattributed to AACN').not.toMatch(/\bAACN\b[^.\n]{0,40}\b(?:AGPCNP-BC|A-GNP)\b/);
        // The two-AACNs disambiguation is load-bearing on this page.
        expect(body).toMatch(/American Association of Critical-Care Nurses/);
        expect(body).toMatch(/American Association of Colleges of Nursing/);
    });

    it('router: every track maps to its correct body, including the non-NP APRN roles', () => {
        const body = parsePost(ROUTER_SLUG).body;
        for (const token of ['AANPCB', 'ANCC', 'AACN', 'NBCRNA', 'AMCB', 'PNCB']) {
            expect(body, `router missing certifying body ${token}`).toContain(token);
        }
        expect(body, 'router missing NCC').toMatch(/\bNCC\b/);
        // Role ties, pinned as the exact map rows — the map IS the page's
        // claim, so the row text is the right thing to hold fixed.
        expect(body, 'CRNA row lost its NBCRNA pairing').toMatch(/\| Nurse Anesthesia \(CRNA\) \| CRNA \| \[NBCRNA\]/);
        expect(body, 'CNM row lost its AMCB pairing').toMatch(/\| Nurse-Midwifery \(CNM\) \| CNM \| \[AMCB\]/);
        expect(body, 'PNP row lost its PNCB pairing').toMatch(/\| Pediatric \(PNP\) \| CPNP-PC or CPNP-AC \| \[PNCB\]/);
        expect(body, 'NNP row lost its NCC pairing').toMatch(/\| Neonatal \(NNP\) \| NNP-BC \| \[NCC\]/);
        expect(body, 'WHNP row lost its NCC pairing').toMatch(/\| Women's Health \(WHNP\) \| WHNP-BC \| NCC \|/);
        // PMHNP row carries BOTH bodies — the pre-2024 "ANCC only" row is
        // the falsehood this suite once pinned; it must never come back.
        expect(body).toMatch(/PMHNP-BC or PMHNP-C\s*\|\s*ANCC or AANPCB/);
        expect(body, 'router resurrects the pre-2024 ANCC-only claim').not.toMatch(/ANCC[- ]only|only ANCC|AANPCB does not offer/i);
        // Four tracks carry a body choice (FNP, AGPCNP, AGACNP, PMHNP) —
        // "three" was the pre-2024 count.
        expect(body).toContain('Only four tracks carry a genuine body choice');
        // And the wrong-body claim the FAQ exists to kill stays killed.
        expect(body, 'router misattributes CRNA/CNM certification to AANP/ANCC').not.toMatch(
            /(?:AANPCB|ANCC)[^.\n]{0,40}certif[^.\n]{0,40}\b(?:CRNA|CNM)s?\b/,
        );
    });

    /**
     * AGREEMENT with the repo's canonical credential surfaces: the pSEO
     * category FAQ map and the specialty salary config. If either changes
     * its pairing, this suite fails here rather than letting the guides
     * silently diverge from the rest of the site.
     */
    it('the pairings agree with category-city-template and specialty-config', () => {
        const template = read('lib/pseo/category-city-template.tsx');
        expect(template).toContain('NBCRNA');
        expect(template).toContain('American Midwifery Certification Board (AMCB)');
        expect(template).toContain('Pediatric Nursing Certification Board (PNCB)');
        expect(template).toContain('NNP-BC certification through the National Certification Corporation (NCC)');
        expect(template).toContain('WHNP-BC certification through the National Certification Corporation (NCC)');
        expect(template).toContain('AGACNP-BC through ANCC or ACNPC-AG through the American Association of Critical-Care Nurses (AACN)');

        const specialtyConfig = read('app/salary-guide/specialty/specialty-config.ts');
        expect(specialtyConfig).toContain("certification: 'AANPCB (FNP-C) or ANCC (FNP-BC)'");
        expect(specialtyConfig).toContain("certification: 'NBCRNA (CRNA)'");
        expect(specialtyConfig).toContain("certification: 'AMCB (CNM)'");
        expect(specialtyConfig).toContain("certification: 'PNCB (CPNP-PC / CPNP-AC)'");
        expect(specialtyConfig).toContain("certification: 'NCC (WHNP-BC)'");
        expect(specialtyConfig).toContain("certification: 'ANCC (AGACNP-BC) or AACN (ACNPC-AG)'");
        // KNOWN DEFECT (not pinned): specialty-config.ts's PMHNP entry still
        // carries an "ANCC is the sole certifying body" comment and derives
        // `ANCC (${credential}-BC)` alone — false since AANPCB launched
        // PMHNP-C in 2024 (NCCA-accredited June 11, 2025). That file belongs
        // to the P1 package (pinned by p1-salary-specialty-pages.test.ts),
        // so this suite deliberately does NOT pin the stale sentence: pinning
        // it would make correcting the P1 surface a P5 test failure. When P1
        // fixes it, nothing here needs to change.
    });

    it('no fabricated people, quotes, testimonials, or inventory claims', () => {
        for (const { slug, body } of BODIES) {
            expect(body, slug).not.toMatch(/testimonial/i);
            expect(body, slug).not.toMatch(/—\s*[A-Z][a-z]+ [A-Z]\.,/);
            expect(body, slug).not.toMatch(/10,000\+|3,000\+|#1 (job board|source)/i);
            expect(body, slug).not.toMatch(/\b\d{1,3}(,\d{3})?\+ (open )?(positions|jobs|employers|companies|programs|schools)\b/i);
        }
    });

    /**
     * Every external link is a certifying body, an accreditor, or the
     * boards' umbrella organization. The guides tell readers to verify at
     * the source, so where they send them is load-bearing: no review
     * courses, no prep vendors, no ranking sites.
     */
    it('every external link points at a certifying body, accreditor, or NCSBN', () => {
        const ALLOWED_HOSTS = new Set([
            // NP certifying bodies
            'www.aanpcert.org', 'www.nursingworld.org',
            // APRN certifying bodies beyond the NP tracks
            'www.aacn.org', 'www.nbcrna.com', 'www.amcbmidwife.org',
            'www.nccwebsite.org', 'www.pncb.org',
            // Boards umbrella + the CRNA program accreditor
            'www.ncsbn.org', 'www.coacrna.org',
        ]);
        for (const { slug, body } of BODIES) {
            const urls = [...body.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
            expect(urls.length, `${slug}: cites no certifying body at all`).toBeGreaterThanOrEqual(3);
            for (const url of urls) {
                expect(url.startsWith('https://'), `${slug}: non-https external link ${url}`).toBe(true);
                const host = new URL(url).host;
                expect(ALLOWED_HOSTS.has(host), `${slug}: external link to a non-authoritative host (${host})`).toBe(true);
            }
        }
    });
});

/**
 * The repo ships its own markdown converter (lib/blog.ts), not a standard
 * one — same rendering hazards the P2/P3/P4 suites pin.
 */
describe('markdown survives the repo converter', () => {
    for (const { slug, body } of BODIES) {
        it(`${slug}: renders without leaking raw markdown`, () => {
            const html = markdownToHtml(body);
            expect(html, 'unconverted bold markers').not.toMatch(/\*\*/);
            const outsideTables = html.replace(/<table[\s\S]*?<\/table>/g, '');
            expect(outsideTables, 'a markdown table did not parse').not.toMatch(/\|\s*---/);
            const faqCount = (body.split(/^## Frequently asked questions/m)[1].match(/^### /gm) ?? []).length;
            expect((html.match(/<h3 id="/g) ?? []).length).toBeGreaterThanOrEqual(faqCount);
        });
    }

    /**
     * Header/body cell counts must match (an empty leading header cell
     * silently misaligns every column — the P4 hazard). All four guides
     * carry a table now that PMHNP is a two-body track.
     */
    it('comparison tables render with aligned header and body cells', () => {
        for (const slug of TABLE_SLUGS) {
            const html = markdownToHtml(parsePost(slug).body);
            expect(html, `${slug}: the comparison table did not render`).toContain('<table>');
            const ths = (html.match(/<th /g) ?? []).length;
            const bodyRows = (html.match(/<tr>/g) ?? []).length - 1; // minus the header row
            const tds = (html.match(/<td /g) ?? []).length;
            expect(ths, `${slug}: no header cells`).toBeGreaterThan(1);
            expect(tds, `${slug}: header/body column mismatch — check for an empty leading header cell`).toBe(ths * bodyRows);
        }
    });

    /**
     * `.editorial-prose` has no white-space override, so a standalone
     * `**Label.** text` line emits a bare <strong> with no <p> wrapper.
     * The list form (`- **Label.** …`) is the fix; only the Quick-answer
     * opener is exempt (the post page hoists it into its own callout).
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
     * The brief's connective tissue: each deep-dive reaches its matching
     * salary page and category landing, the router reaches all three
     * deep-dives (and the broader APRN landings), and every guide routes
     * into the licensure series.
     */
    it('each guide cross-links its salary page and category landing', () => {
        const fnp = parsePost(FNP_SLUG).body;
        expect(fnp).toContain('/jobs/family-practice');
        expect(fnp).toContain('/salary-guide/specialty/family-practice');

        const pmhnp = parsePost(PMHNP_SLUG).body;
        expect(pmhnp).toContain('/jobs/psychiatric-mental-health');
        expect(pmhnp).toContain('/salary-guide/specialty/psychiatric-mental-health');

        const ag = parsePost(AG_SLUG).body;
        expect(ag).toContain('/jobs/acute-care');
        expect(ag).toContain('/jobs/adult-gerontology');
        expect(ag).toContain('/salary-guide/specialty/acute-care');
        expect(ag).toContain('/salary-guide/specialty/adult-gerontology');

        const router = parsePost(ROUTER_SLUG).body;
        for (const href of [
            '/jobs/psychiatric-mental-health', '/jobs/pediatric', '/jobs/neonatal',
            '/jobs/women-health', '/jobs/anesthesia', '/jobs/midwifery',
            '/jobs/clinical-nurse-specialist', '/salary-guide/specialty',
        ]) {
            expect(router, `router does not reach ${href}`).toContain(href);
        }
    });

    it('the router and the deep-dives link each other', () => {
        const router = parsePost(ROUTER_SLUG).body;
        for (const slug of [FNP_SLUG, PMHNP_SLUG, AG_SLUG]) {
            expect(router, `router does not link /blog/${slug}`).toContain(`/blog/${slug}`);
        }
        for (const slug of [FNP_SLUG, PMHNP_SLUG, AG_SLUG]) {
            expect(parsePost(slug).body, `${slug} does not link back to the router`).toContain(`/blog/${ROUTER_SLUG}`);
        }
        // The series roots into the existing corpus: the specialty-choice
        // comparison and the program-verification wedge.
        for (const { slug, body } of BODIES) {
            expect(body, `${slug}: no link to the specialty-choice comparison`).toContain('/blog/fnp-vs-pmhnp-vs-agacnp');
        }
        expect(parsePost(FNP_SLUG).body).toContain('/blog/how-to-evaluate-np-programs');
        expect(parsePost(PMHNP_SLUG).body).toContain('/blog/how-to-evaluate-np-programs');
    });
});

/**
 * FAQ → schema, one source. Asserted by reading source rather than
 * importing, because scripts/sync-blog-to-db.ts throws at module load
 * without PROD_DATABASE_URL.
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
