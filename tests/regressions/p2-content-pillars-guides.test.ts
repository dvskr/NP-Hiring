/**
 * P2 — content worklist remainder (interview / resume / cover letter /
 * negotiation / CE-by-state) + P3 #5 partial.
 *
 * Five new pillars ship through the P1 mechanism: .mdx in content/blog/,
 * published by scripts/sync-blog-to-db.ts (which extracts the visible
 * "Frequently asked questions" section into faq_json → FAQPage JSON-LD),
 * wired into the job-page sidebar slots in config/niche/content-map.ts.
 *
 * What these tests defend:
 *
 *   1. WIRING — every new slug is linked from the content map and
 *      resolves to a real content/blog/<slug>.mdx (a linked slug with no
 *      file silently drops out of the sidebar; fork-preflight fails on it).
 *   2. SHAPE — frontmatter, a public category id, a Quick-answer opener,
 *      an FAQ section the sync script can extract, and an evergreen word
 *      band.
 *   3. TRUTH RULES (YMYL career advice) — cited statistics match
 *      lib/stats-sources.ts with attribution, every dollar figure traces
 *      to a repo source of truth, certification bodies are role-correct,
 *      and no fabricated people/inventory claims re-enter.
 *   4. CE GENERATOR — content/blog/np-ceu-requirements-by-state.mdx is
 *      byte-identical to lib/blog-ceu-guide.ts output, covers all 51
 *      jurisdictions with the board URLs verified by the licensure
 *      series, and quotes NO CE hour counts, cycle lengths, or fees.
 *   5. DEAD REDIRECT — /blog/pmhnp-interview-questions 301'd to a slug
 *      that never existed (a permanent redirect into a 404). It now
 *      points at the published interview post.
 *
 * REGENERATING the CE hub after editing lib/blog-ceu-guide.ts:
 *   UPDATE_CEU_GUIDE_MDX=1 npx vitest run tests/regressions/p2-content-pillars-guides.test.ts
 * (Same env-flag convention as the niche-copy debt baseline.)
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RELATED_BLOG_SLUGS, LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';
import { BLOG_CATEGORIES } from '@/lib/blog-categories';
import { markdownToHtml } from '@/lib/blog';
import { STAT_SOURCES, SALARY_BANDS } from '@/lib/stats-sources';
import { salaryConfig } from '@/config/niche/salary';
import { LICENSE_GUIDE_STATES } from '@/lib/blog-license-guides';
import {
    CEU_GUIDE_SLUG,
    CEU_GUIDE_CATEGORY,
    buildCeuGuideMdx,
    buildCeuGuideFaq,
} from '@/lib/blog-ceu-guide';

const ROOT = process.cwd();
const BLOG_DIR = path.join(ROOT, 'content', 'blog');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Line-ending normalizer — required, not cosmetic.
 *
 * This repo is checked out with `core.autocrlf=true` and ships no
 * .gitattributes, so git rewrites text files to CRLF in the working tree
 * on every checkout/clone/reset while the index keeps LF. Every
 * already-committed content/blog/*.mdx therefore sits at CRLF locally
 * (63–74 CRs each) even though the generators in lib/ emit "\n". Any
 * assertion that compares generator output to file bytes must normalize
 * first, or it passes on LF-based CI and fails permanently for every
 * Windows contributor the moment the file is committed — and the
 * UPDATE_CEU_GUIDE_MDX regeneration below can never clear it, because
 * git re-converts what the test just wrote.
 *
 * (Adding `*.mdx text eol=lf` to a root .gitattributes would also fix
 * this, but that is a repo-wide checkout change; normalizing at the
 * comparison boundary is local to what this suite actually asserts.)
 */
const normalizeEol = (s: string) => s.replace(/\r\n/g, '\n');

/** The five pillars authored in this package. */
const P2_SLUGS = [
    'np-interview-questions',
    'np-resume-guide',
    'np-cover-letter-guide',
    'np-salary-negotiation-guide',
    CEU_GUIDE_SLUG,
] as const;

const CATEGORY_IDS = new Set<string>(BLOG_CATEGORIES.map((c) => c.id));

const CEU_MDX_PATH = path.join(BLOG_DIR, `${CEU_GUIDE_SLUG}.mdx`);

// Regeneration hook — runs before the drift assertion below so a single
// command both rewrites the artifact and re-verifies the rest.
if (process.env.UPDATE_CEU_GUIDE_MDX === '1') {
    fs.writeFileSync(CEU_MDX_PATH, buildCeuGuideMdx());
}

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

function wordCount(markdown: string): number {
    return markdown
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#*`>|]/g, '')
        .split(/\s+/)
        .filter(Boolean).length;
}

const BODIES = P2_SLUGS.map((slug) => ({ slug, ...parsePost(slug) }));

describe('content-map wiring', () => {
    it('every P2 pillar is linked from a sidebar slot', () => {
        const linked = new Set([
            ...RELATED_BLOG_SLUGS.always,
            ...RELATED_BLOG_SLUGS.remoteOrTelehealth,
            ...RELATED_BLOG_SLUGS.newGrad,
            ...RELATED_BLOG_SLUGS.generalFallback,
        ]);
        for (const slug of P2_SLUGS) {
            expect(linked.has(slug), `${slug} not wired into config/niche/content-map.ts`).toBe(true);
        }
    });

    it('every linked slug resolves to a content/blog/<slug>.mdx file', () => {
        const linked = [
            ...RELATED_BLOG_SLUGS.always,
            ...RELATED_BLOG_SLUGS.remoteOrTelehealth,
            ...RELATED_BLOG_SLUGS.newGrad,
            ...RELATED_BLOG_SLUGS.generalFallback,
        ];
        for (const slug of new Set(linked)) {
            expect(
                fs.existsSync(path.join(BLOG_DIR, `${slug}.mdx`)),
                `content/blog/${slug}.mdx missing — sidebar link drops silently, fork-preflight fails`,
            ).toBe(true);
        }
    });

    /**
     * The sidebar renders at most 3 slugs and `always` consumes one, so a
     * pillar that is not in the first two generalFallback positions never
     * appears on a plain job page. Interview prep and resume are the two
     * that belong there for someone reading a specific posting.
     */
    it('the first two generalFallback entries are the job-page-relevant pillars', () => {
        expect(RELATED_BLOG_SLUGS.generalFallback.slice(0, 2)).toEqual([
            'np-interview-questions',
            'np-resume-guide',
        ]);
    });
});

describe('post shape', () => {
    for (const slug of P2_SLUGS) {
        it(`${slug}: frontmatter, category, length, quick answer, FAQ`, () => {
            const { fm, body } = parsePost(slug);
            expect(fm.title, 'title missing').toBeTruthy();
            expect(fm.slug, 'slug missing').toBe(slug);
            expect(fm.description, 'description missing').toBeTruthy();
            expect(fm.date, 'date missing').toBeTruthy();
            expect(fm.reviewed, 'reviewed date missing').toBeTruthy();
            expect(CATEGORY_IDS.has(fm.category), `invalid category '${fm.category}'`).toBe(true);

            // Evergreen band. The upper bound is wider than the P1 seed
            // batch on purpose: "40 questions with sample answers" is a
            // 40-item deliverable, and trimming it to hit a word target
            // would break the promise in the title.
            const words = wordCount(body);
            expect(words, `${slug}: ${words} words — under the 900-word pillar floor`).toBeGreaterThanOrEqual(900);
            expect(words, `${slug}: ${words} words — over the 2600-word ceiling`).toBeLessThanOrEqual(2600);

            // Hoisted into the styled callout by app/blog/[slug]/page.tsx.
            expect(body).toMatch(/\*\*Quick answer:\*\*/);

            // The sync script extracts this exact heading into faq_json,
            // which is the ONLY source of the FAQPage JSON-LD — so schema
            // can never diverge from visible content.
            expect(body).toMatch(/^## Frequently asked questions/m);
            const faqSection = body.split(/^## Frequently asked questions/m)[1];
            const questions = faqSection.match(/^### .+$/gm) ?? [];
            expect(questions.length, 'need at least 3 FAQ questions').toBeGreaterThanOrEqual(3);

            // At least two H2s so the Key Takeaways block renders.
            expect((body.match(/^## /gm) ?? []).length).toBeGreaterThanOrEqual(2);
        });
    }

    it('the interview post actually delivers 40 numbered questions', () => {
        const { body } = parsePost('np-interview-questions');
        // List-item form (`- **N. …**`) is load-bearing, not stylistic —
        // see the "bold-led lines" suite below.
        const numbered = new Set(
            (body.match(/^- \*\*(\d{1,2})\. /gm) ?? []).map((m) => Number(m.replace(/\D/g, ''))),
        );
        for (let n = 1; n <= 40; n++) {
            expect(numbered.has(n), `question ${n} missing — the title promises 40`).toBe(true);
        }
    });
});

describe('truth rules', () => {
    it('cited statistics match lib/stats-sources.ts and carry attribution', () => {
        for (const { slug, body } of BODIES) {
            if (body.includes('$129,210')) {
                expect(STAT_SOURCES.averageSalary.formatted).toBe('$129,210');
                expect(body, `${slug}: median cited without BLS attribution`).toMatch(/BLS/);
            }
            if (body.includes('27 states + DC')) {
                expect(STAT_SOURCES.fullPracticeStates.formatted).toBe('27 states + DC');
                expect(body, `${slug}: FPA count cited without AANP attribution`).toMatch(/AANP/);
            }
            if (body.includes('90 million+')) {
                expect(body, `${slug}: HPSA stat must say primary care`).toMatch(/primary.care/i);
                expect(body, `${slug}: HPSA stat cited without HRSA attribution`).toMatch(/HRSA/);
            }
        }
    });

    /**
     * Provenance ratchet (same rule as the P1 seed batch): a dollar figure
     * may only appear if it already exists in a repo source of truth. New
     * bands must be added to the source file FIRST and listed here.
     *
     * The allow-list is DERIVED from the constants rather than hand-typed,
     * so a band that is retuned in config/niche/salary.ts fails here as a
     * content mismatch instead of quietly staying legal.
     *
     * `$60–$150+` was removed from this list (it is still allowed in the P1
     * seed batch, which publishes it in five posts). Its only provenance is
     * a PROSE COMMENT — config/niche/salary.ts:24, "locum NP commonly
     * $60–150/hr", itself attributed to a donor file — with no exported
     * constant, no `basis` string, and no citation, so nothing forces a
     * surface to say what the number is. The negotiation guide was the one
     * page presenting it as a market fact ("commonly posts at"), on the page
     * whose entire job is telling a reader what to anchor on, so the figure
     * was dropped from the prose rather than restated. Adding it back
     * requires a real SALARY_BANDS entry with a `basis` first.
     */
    it('every dollar figure traces to a repo source of truth', () => {
        const ALLOWED = new Map<string, string>([
            [STAT_SOURCES.averageSalary.formatted, 'lib/stats-sources.ts — BLS OEWS median'],
            [SALARY_BANDS.typicalW2Annual.formatted, 'lib/stats-sources.ts — SALARY_BANDS.typicalW2Annual'],
        ]);
        const patterns = [...ALLOWED.keys()].sort((a, b) => b.length - a.length);
        for (const { slug, body } of BODIES) {
            let rest = body;
            for (const p of patterns) rest = rest.split(p).join('');
            const orphans = rest.match(/\$[\d][\d,.]*[KkMm]?\+?/g) ?? [];
            expect(orphans, `${slug}: untraced dollar figure(s)`).toEqual([]);
        }
        const cfg = salaryConfig.normalizer.typical;
        expect(SALARY_BANDS.typicalW2Annual.formatted).toBe(`$${cfg.min / 1000}K–$${cfg.max / 1000}K`);
        expect(SALARY_BANDS.typicalW2Annual.formatted).toBe('$110K–$170K');
    });

    /**
     * THE band-mischaracterization rule — the failure the provenance ratchet
     * above structurally cannot see.
     *
     * `$110K–$170K` is salaryConfig.normalizer.typical: the band the INGEST
     * PIPELINE validates and clamps a posting against. lib/stats-sources.ts
     * states the rule in its own words — "these bands are NOT a wage survey
     * and must never be presented as one … Every band therefore carries a
     * `basis` string, and surfaces should render it (or a short paraphrase
     * of it) next to the number" — and adds that where a page wants "what
     * NPs actually earn", the honest answer is STAT_SOURCES.averageSalary,
     * not a band.
     *
     * The provenance ratchet only proves the LITERAL traces to a constant,
     * so "full-time W-2 NP roles commonly post in a $110K–$170K band"
     * passed it while turning a board-inventory envelope into a national
     * pay claim. The migrated surface /resources/1099-vs-w2 renders the
     * basis ("what NP Hiring accepts and displays for a real posting, not a
     * survey of what every NP earns") and the P1 sibling np-salary-guide.mdx
     * scopes it ("postings on this board"); this asserts the same of every
     * P2 use.
     */
    it('the typical-W2 band is scoped to this board wherever it is published', () => {
        const band = SALARY_BANDS.typicalW2Annual.formatted;
        /** Scope: whose postings the number describes. */
        const SCOPED = /on this board|postings on this board|this board/i;
        /** Basis paraphrase: what the band IS, per the SalaryBand contract. */
        const BASIS = /not a (wage )?survey|accepts and displays|validates postings against/i;
        for (const { slug, body } of BODIES) {
            let from = body.indexOf(band);
            expect(
                body,
                `${slug}: presents the validation band as a market statistic ("commonly post in")`,
            ).not.toMatch(/commonly post(s|ing)? in/i);
            while (from !== -1) {
                const window = body.slice(Math.max(0, from - 260), from + band.length + 260);
                expect(
                    SCOPED.test(window),
                    `${slug}: "${band}" published with no board scope — it is the ingest ` +
                    'validation band, not a wage survey (lib/stats-sources.ts SALARY BANDS header)',
                ).toBe(true);
                expect(
                    BASIS.test(window),
                    `${slug}: "${band}" published with no paraphrase of SalaryBand.basis ` +
                    `("${SALARY_BANDS.typicalW2Annual.basis}")`,
                ).toBe(true);
                from = body.indexOf(band, from + band.length);
            }
        }
    });

    /**
     * The dollar ratchet above only matches `$<digit>`, so a fabricated
     * NON-dollar proportion passed it untouched — "roughly half of
     * application forms make the field required anyway" shipped with no
     * source anywhere in the repo. Percentages and fraction quantifiers
     * are statistics too: either they trace to lib/stats-sources.ts (and
     * carry attribution) or they do not belong on a YMYL page.
     */
    it('every proportion or percentage traces to a repo source of truth', () => {
        const SOURCED = new Set(
            Object.values(STAT_SOURCES)
                .map((s) => (s as { formatted?: string }).formatted)
                .filter((f): f is string => Boolean(f)),
        );
        for (const { slug, body } of BODIES) {
            let rest = body;
            for (const f of SOURCED) rest = rest.split(f).join('');
            expect(
                rest.match(/\b\d+(\.\d+)?\s?%/g) ?? [],
                `${slug}: percentage with no lib/stats-sources.ts entry`,
            ).toEqual([]);
            // Fraction-of-a-population claims. Deliberately NOT `about \d`
            // — that matches ordinary prose like "about 20 seconds", which
            // is a reading-time heuristic, not a statistic. The lookbehind
            // exempts positional usage ("the upper half of your posted
            // range"), which describes a range, not a population.
            expect(
                rest.match(
                    /(?<!\b(?:upper|lower|top|bottom|first|second|latter|back)\s)\b(half|a third|a quarter|two[- ]thirds|three[- ]quarters|the majority)\s+of\b/gi,
                ) ?? [],
                `${slug}: quantified proportion with no source — cut it or drop the number`,
            ).toEqual([]);
        }
    });

    it('no fabricated inventory claims', () => {
        for (const { slug, body } of BODIES) {
            expect(body, slug).not.toMatch(/10,000\+|3,000\+|#1 (job board|source)/i);
            expect(body, slug).not.toMatch(/\b\d{1,3}(,\d{3})?\+ (open )?(positions|jobs|employers|companies)\b/i);
        }
    });

    it('no fabricated people, quotes, or testimonials', () => {
        for (const { slug, body } of BODIES) {
            expect(body, slug).not.toMatch(/testimonial/i);
            // "— Jane D., FNP" style attributions.
            expect(body, slug).not.toMatch(/—\s*[A-Z][a-z]+ [A-Z]\.,/);
        }
    });

    it('no invented NHSC award amount (link to the program instead)', () => {
        for (const { slug, body } of BODIES) {
            if (!/NHSC|National Health Service Corps/.test(body)) continue;
            expect(body, `${slug}: quotes an NHSC award amount`)
                .not.toMatch(/(NHSC|National Health Service Corps)[^.]{0,120}\$[\d]/);
            expect(body, `${slug}: NHSC mentioned without pointing at the program`)
                .toMatch(/nhsc\.hrsa\.gov/);
        }
    });

    /**
     * Certification bodies must be role-correct wherever a post names
     * them: AANP/ANCC certify NPs, NBCRNA certifies CRNAs, AMCB certifies
     * CNMs. The failure mode this guards is the one P2 #8 fixes elsewhere
     * — "ANCC or AANP" offered as the answer for every APRN role.
     */
    it('certification bodies are role-correct wherever named', () => {
        for (const { slug, body } of BODIES) {
            if (!/NBCRNA|AMCB/.test(body)) continue;
            expect(body, `${slug}: names NBCRNA/AMCB without the NP bodies`).toMatch(/AANP/);
            expect(body, `${slug}: CRNA body missing`).toMatch(/NBCRNA/);
            expect(body, `${slug}: CNM body missing`).toMatch(/AMCB/);
        }
    });

    /**
     * FPA citations carry the vintage the rest of the repo publishes, and —
     * where the classification is turned into a claim about what an NP may
     * DO — the transition-to-practice caveat.
     *
     * Every other FPA surface in this repo pairs the count with its AANP
     * vintage (`STAT_SOURCES.fullPracticeStates.asOf`): the P1 posts say
     * "(AANP, 2025)", app/tools/licensure-checker renders "as of
     * ${asOf}", and lib/blog-ceu-guide.ts says "(as of 2025)". The
     * licensure series goes further wherever it says an NP can practice
     * independently — lib/blog-license-guides.ts:235,318,327 all attach
     * "some full-practice states phase authority in through a
     * transition-to-practice period" — because day-one independence is the
     * part that is not uniformly true across the 27. A negotiation page
     * telling a reader independent practice is their walk-away alternative
     * is exactly where that caveat matters most.
     *
     * The caveat is required only for the independence CLAIM, not for a
     * page that cites the classification as a column legend (the CE hub).
     */
    it('FPA citations carry the AANP vintage, and independence claims carry the caveat', () => {
        const fpa = STAT_SOURCES.fullPracticeStates;
        for (const { slug, body } of BODIES) {
            if (!body.includes(fpa.formatted)) continue;
            expect(body, `${slug}: FPA count cited without the AANP vintage (${fpa.asOf})`)
                .toContain(fpa.asOf);
            if (!/practice and prescribe|prescribe without/i.test(body)) continue;
            expect(body, `${slug}: implies day-one independence with no transition-to-practice caveat`)
                .toMatch(/transition-to-practice/i);
        }
    });

    /**
     * Recruiter-behaviour numbers are statistics too.
     *
     * The proportion ratchet above only catches `%` and fraction words, and
     * its own comment used to wave "about 20 seconds" through as "a
     * reading-time heuristic, not a statistic". It is neither — it is a
     * measured claim about how long a human spends on a resume, with no
     * entry in lib/stats-sources.ts and no citation, published in the
     * frontmatter description, the Quick answer, and an H2. The sibling
     * prevalence claim ("Almost every NP application passes through an
     * applicant tracking system") is the same shape. Both were replaced
     * with the mechanism, which is true without a number attached.
     */
    it('no unsourced recruiter-behaviour statistic', () => {
        for (const { slug, body } of BODIES) {
            expect(
                body.match(/\b\d+\s*-?\s*seconds?\b/gi) ?? [],
                `${slug}: publishes a measured scan/skim duration with no source`,
            ).toEqual([]);
            expect(
                body.match(
                    /\b(almost every|nearly every|most|virtually all|the vast majority of)\s+(\w+\s+){0,2}applications?\b/gi,
                ) ?? [],
                `${slug}: prevalence claim about how applications are processed, with no source`,
            ).toEqual([]);
        }
    });

    /**
     * PRODUCT CLAIMS MUST BE REACHABLE.
     *
     * The cover-letter guide promoted "the AI cover-letter assistant …
     * included in your plan", and the resume guide cross-referenced it
     * ("Our own AI cover-letter draft deliberately omits them"). That
     * feature is POST /api/autofill/generate-cover-letter, and its only
     * client is the browser extension: the route authenticates with
     * verifyExtensionToken() (an extension-issued JWT — a signed-in web
     * session cannot call it), the endpoint constant lives in
     * pmhnp-autofill-extension/src/shared/constants.ts, and no app route,
     * component, /pricing entry or /for-job-seekers copy mentions it. The
     * extension itself is neither linked nor distributed anywhere on the
     * site. Readers of a blog post therefore cannot reach the thing the
     * post told them they might already have.
     *
     * The editing advice is the durable part and now stands on its own for
     * any assistant, so these pages describe drafting generically.
     */
    it('no pillar promotes an AI feature only reachable through the extension', () => {
        const route = read('app/api/autofill/generate-cover-letter/route.ts');
        expect(route, 'route is no longer extension-token gated — re-check this rule')
            .toContain('verifyExtensionToken');
        expect(read('pmhnp-autofill-extension/src/shared/constants.ts'))
            .toContain('/api/autofill/generate-cover-letter');
        for (const { slug, body } of BODIES) {
            expect(body, `${slug}: promotes an AI cover-letter feature readers cannot reach`)
                .not.toMatch(/AI cover[- ]letter/i);
            expect(body, `${slug}: points readers at the browser extension, which the site does not offer`)
                .not.toMatch(/browser extension|autofill extension/i);
        }
    });
});

describe('CE hub generator', () => {
    it('the committed .mdx is byte-identical to lib/blog-ceu-guide.ts output', () => {
        // Both sides normalized — see normalizeEol above. Without this the
        // assertion fails on every CRLF checkout of a committed .mdx.
        const committed = normalizeEol(fs.readFileSync(CEU_MDX_PATH, 'utf8'));
        expect(
            committed,
            'content/blog/np-ceu-requirements-by-state.mdx has drifted from its generator — regenerate with ' +
            'UPDATE_CEU_GUIDE_MDX=1 npx vitest run tests/regressions/p2-content-pillars-guides.test.ts',
        ).toBe(normalizeEol(buildCeuGuideMdx()));
    });

    it('covers all 51 jurisdictions with the licensure series board data', () => {
        const { body } = parsePost(CEU_GUIDE_SLUG);
        expect(LICENSE_GUIDE_STATES).toHaveLength(51);
        for (const s of LICENSE_GUIDE_STATES) {
            expect(body, `${s.name}: board link missing or not the verified NCSBN URL`)
                .toContain(`[${s.boardName}](${s.boardUrl})`);
            expect(body, `${s.name}: no link into its licensure guide`)
                .toContain(`[${s.name}](/blog/${s.slug})`);
        }
    });

    /**
     * THE core truth rule for this page. CE hours, renewal cycles, audit
     * windows, and fees are set by 51 boards and revised without notice;
     * there is no repo source of truth for any of them, so the page must
     * link the board instead of quoting a number. A single "24 hours
     * every 2 years" that goes stale is a licensure-grade error on a YMYL
     * page.
     */
    it('quotes no CE hour counts, renewal cycles, or fees', () => {
        const { body } = parsePost(CEU_GUIDE_SLUG);
        expect(body, 'CE hour count published').not.toMatch(/\b\d+\s*(contact\s+)?(hours?|CEUs?|CE\s+hours?|credits?)\b/i);
        expect(body, 'renewal cycle length published').not.toMatch(/\bevery\s+\d+\s+years?\b/i);
        expect(body, 'renewal cycle length published').not.toMatch(/\b\d+-year\s+(renewal|cycle)\b/i);
        expect(body, 'fee published').not.toMatch(/\$\d/);
        // …and it says so explicitly, so an editor knows it is a policy.
        expect(body).toMatch(/do not restate hour counts/i);
    });

    it('the FAQ answers route hour/fee questions to the board', () => {
        const faq = buildCeuGuideFaq();
        expect(faq.length).toBeGreaterThanOrEqual(3);
        const hoursQ = faq.find((f) => /how many CE hours/i.test(f.name));
        expect(hoursQ, 'the "how many hours" question must be answered').toBeTruthy();
        expect(hoursQ!.text).toMatch(/board/i);
        expect(hoursQ!.text, 'answer must not invent an hour count').not.toMatch(/\b\d+\s*hours?\b/i);
    });

    /**
     * REACHABILITY on /resources. The hub shipped as 'state_spotlight',
     * which made it invisible there: app/resources/page.tsx puts every
     * state_spotlight post into `stateGuides`, maps each slug through
     * LICENSE_GUIDE_SLUG_REGEX (`^np-license-`), and drops the non-matches
     * with `.filter(Boolean)` — so a national hub filed that way lands in
     * neither the licensure grid nor the article grid. The other four
     * pillars surface automatically because their categories fall through
     * to `articles`. This asserts the same for the CE hub.
     */
    it('the CE hub is reachable from /resources (not filed as a state guide)', () => {
        expect(
            CEU_GUIDE_CATEGORY,
            'state_spotlight routes the hub into the licensure grid, where its slug fails ' +
            'LICENSE_GUIDE_SLUG_REGEX and is dropped — it then appears nowhere on /resources',
        ).not.toBe('state_spotlight');
        expect(LICENSE_GUIDE_SLUG_REGEX.test(CEU_GUIDE_SLUG)).toBe(false);
        expect(CATEGORY_IDS.has(CEU_GUIDE_CATEGORY), 'not a public category id').toBe(true);
        // The frontmatter the sync script publishes must carry it too.
        expect(parsePost(CEU_GUIDE_SLUG).fm.category).toBe(CEU_GUIDE_CATEGORY);

        // …and the /resources split it has to survive is still the one above.
        const resources = read('app/resources/page.tsx');
        expect(resources).toContain("p.category === 'state_spotlight'");
        expect(resources).toContain("p.category !== 'state_spotlight'");
        // The article grid must have a styled group for this category
        // (otherwise it renders under the raw category id).
        expect(resources).toContain(`${CEU_GUIDE_CATEGORY}: { label:`);
    });

    it('separates license renewal from certification renewal', () => {
        const { body } = parsePost(CEU_GUIDE_SLUG);
        expect(body).toMatch(/two/i);
        expect(body).toContain('AANP');
        expect(body).toContain('ANCC');
        expect(body).toContain('NBCRNA');
        expect(body).toContain('AMCB');
    });
});

/**
 * The repo ships its own markdown converter (lib/blog.ts), not a standard
 * one — GFM tables, fenced code, and the Quick-answer hoist are all
 * bespoke regex passes. Markdown that a normal renderer would handle can
 * therefore land on the page as raw pipes or literal asterisks, which is
 * invisible in a source review and obvious to a reader.
 */
describe('markdown survives the repo converter', () => {
    for (const { slug, body } of BODIES) {
        it(`${slug}: renders without leaking raw markdown`, () => {
            const html = markdownToHtml(body);
            expect(html, 'unconverted bold markers').not.toMatch(/\*\*/);
            // Table pipes only ever appear inside a rendered <table>.
            const outsideTables = html.replace(/<table[\s\S]*?<\/table>/g, '');
            expect(outsideTables, 'a markdown table did not parse').not.toMatch(/\|\s*---/);
            // Every FAQ question becomes an anchorable heading.
            const faqCount = (body.split(/^## Frequently asked questions/m)[1].match(/^### /gm) ?? []).length;
            expect((html.match(/<h3 id="/g) ?? []).length).toBeGreaterThanOrEqual(faqCount);
        });
    }

    it('the CE hub renders a real table with every jurisdiction linked', () => {
        const html = markdownToHtml(parsePost(CEU_GUIDE_SLUG).body);
        expect(html).toContain('<table>');
        expect((html.match(/<tr>/g) ?? []).length).toBeGreaterThanOrEqual(51);
        for (const s of LICENSE_GUIDE_STATES) {
            expect(html, `${s.name}: board link lost in conversion`).toContain(`href="${s.boardUrl}"`);
        }
    });

    it('the resume template renders as a code block, not as prose', () => {
        const html = markdownToHtml(parsePost('np-resume-guide').body);
        expect(html).toContain('<pre><code>');
        expect(html).toContain('LICENSES AND CERTIFICATIONS');
    });
});

/**
 * BLOCK SEPARATION — the failure the "no leaked `**`" assertion above
 * cannot see.
 *
 * markdownToHtml converts bold BEFORE its paragraph pass, and that pass
 * (`/^(?!<[a-z/]|%%)(.*\S.*)$/gm`) deliberately skips any line already
 * starting with `<`. So a standalone `**Label.** text` line emits a bare
 * `<strong>…</strong> text` node with NO <p> wrapper. `.editorial-prose`
 * sets no white-space override, so consecutive ones are anonymous inline
 * content that collapses into ONE run-on paragraph in the browser —
 * markdown-clean in source, unreadable on the page. Before this guard the
 * 40 interview questions rendered as a 12-question wall of text and the
 * negotiation Scripts section as a 7-script one.
 *
 * app/blog/[slug]/page.tsx documents this exact behaviour ("no `<p>`
 * wrapper — so the styling never lands and the text reads as plain inline
 * content") and special-cases exactly ONE line: the `**Quick answer:**`
 * opener, which it hoists into the `.ed-quick-answer` callout. That line
 * is the only permitted exception here.
 *
 * The fix for everything else is `- **Label.** …` — the converter wraps
 * those in <ul><li> and editorial.css already styles
 * `ul li:has(strong:first-child)` as a definition row.
 */
describe('bold-led lines render as real blocks', () => {
    /** Rendered top-level nodes that are bare <strong>-led inline content. */
    function bareStrongBlocks(html: string): string[] {
        return html
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('<strong>'))
            // The one line the post page hoists into its own callout.
            .filter((line) => !/^<strong>\s*Quick\s+answer/i.test(line));
    }

    for (const { slug, body } of BODIES) {
        it(`${slug}: no unwrapped bold-led block`, () => {
            const offenders = bareStrongBlocks(markdownToHtml(body));
            expect(
                offenders.map((o) => o.slice(0, 80)),
                `${slug}: bold-led line(s) emitted with no <p>/<li> wrapper — ` +
                'consecutive ones collapse into a single run-on paragraph in ' +
                '.editorial-prose. Author them as `- **Label.** …` list items.',
            ).toEqual([]);
        });
    }

    /**
     * Belt-and-braces on the authoring side, so the rule is legible in
     * the source file and not only in rendered output.
     */
    it('no body line opens with ** except the Quick answer', () => {
        for (const { slug, body } of BODIES) {
            const leads = (body.match(/^\*\*.*$/gm) ?? []).filter(
                (l) => !/^\*\*Quick answer:\*\*/.test(l),
            );
            expect(leads.map((l) => l.slice(0, 60)), `${slug}: bold-led line(s)`).toEqual([]);
        }
    });

    /**
     * The list form only pays off if editorial.css keeps styling it. If
     * that selector is ever dropped, the 40 questions silently lose their
     * definition-row treatment.
     */
    it('editorial.css still styles the definition-row list form', () => {
        expect(read('app/editorial.css')).toContain('.editorial-prose ul li:has(strong:first-child)');
    });
});

/**
 * INTERNAL LINK RESOLUTION.
 *
 * Nothing in this package checked that an internal href reaches the page
 * its anchor text names. `[specialty pages](/salary-guide)` shipped
 * pointing at the state salary hub while app/salary-guide/specialty/
 * existed — a duplicate of the `[salary guide](/salary-guide)` earlier in
 * the same sentence, and a dead promise to the reader.
 */
describe('internal links resolve to real routes', () => {
    const APP_DIR = path.join(ROOT, 'app');

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
            // Either an authored .mdx or a code-generated licensure guide.
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
            expect(hrefs.length, 'post has no internal links at all').toBeGreaterThan(0);
            const dead = [...new Set(hrefs)].filter((h) => !resolves(h));
            expect(dead, `${slug}: internal href(s) with no route`).toEqual([]);
        });
    }

    /**
     * Anchor text that names the specialty hub must not point at the
     * state hub (the specific regression above).
     */
    it('"specialty" anchors point at the specialty hub', () => {
        for (const { slug, body } of BODIES) {
            for (const [, text, href] of body.matchAll(/\[([^\]]*specialty[^\]]*)\]\((\/[^)\s]*)\)/gi)) {
                expect(href, `${slug}: "${text}" links to ${href}`).toBe('/salary-guide/specialty');
            }
        }
        expect(fs.existsSync(path.join(APP_DIR, 'salary-guide', 'specialty', 'page.tsx'))).toBe(true);
    });
});

describe('stale interview redirect', () => {
    /**
     * next.config.ts permanently redirected /blog/pmhnp-interview-questions
     * to /blog/pmhnp-interview-questions-2026 — a slug that exists nowhere
     * in this board's content, so the 301 landed on a 404 and burned the
     * legacy URL's equity. It now points at the published post.
     */
    it('/blog/pmhnp-interview-questions resolves to a real post', () => {
        const src = read('next.config.ts');
        expect(src, 'the dead donor destination is still wired up')
            .not.toContain('pmhnp-interview-questions-2026');
        expect(src).toContain("source: '/blog/pmhnp-interview-questions'");
        expect(src).toContain("destination: '/blog/np-interview-questions'");
        expect(fs.existsSync(path.join(BLOG_DIR, 'np-interview-questions.mdx'))).toBe(true);
    });

    /**
     * …and it is TEMPORARY until the destination is live in prod.
     *
     * The redirect's destination is an authored .mdx, and authored posts
     * render only from blog_posts: getPostBySlug() (lib/blog.ts) queries
     * Supabase and falls back to a generator for the np-license-* series
     * ONLY, so /blog/np-interview-questions 404s until
     * `npx tsx scripts/sync-blog-to-db.ts` has run against prod.
     * next.config.ts ships with the app, so the redirect goes live one
     * deploy BEFORE the manual sync — a window this repo already documents
     * for the other consumers of these posts (config/niche/content-map.ts:
     * "run … against prod BEFORE deploying this file").
     *
     * A 301 through that window is the one irreversible version: the
     * permanent target is recorded as a 404 and the binding is cached. A
     * 307 leaves the legacy URL indexed and costs nothing once the sync
     * lands. Flip this assertion and next.config.ts together, after
     * confirming the destination returns 200 in prod.
     */
    it('the redirect stays temporary while its destination depends on the sync script', () => {
        const src = read('next.config.ts');
        const entry = src.slice(src.indexOf("source: '/blog/pmhnp-interview-questions'"));
        const permanence = entry.match(/permanent:\s*(true|false)/)?.[1];
        expect(
            permanence,
            'a 301 to a post that only exists after scripts/sync-blog-to-db.ts runs ' +
            'permanently points the legacy URL at a 404 — keep it temporary until the ' +
            'destination returns 200 in prod',
        ).toBe('false');

        // The dependency this rule rests on: no code fallback for authored
        // slugs. If one is ever added, the redirect can safely go permanent.
        const blog = read('lib/blog.ts');
        expect(blog).toContain('LICENSE_GUIDE_SLUG_REGEX');
        expect(
            blog.slice(blog.indexOf('export async function getPostBySlug')),
            'getPostBySlug gained a non-license fallback — re-evaluate the 307',
        ).toContain('LICENSE_GUIDE_SERIES_PUBLISHED');
    });
});
