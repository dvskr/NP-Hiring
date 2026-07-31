/**
 * P4 content wedges — the preceptor pillar (brief #4) and the NP-program
 * decision guide (brief #3).
 *
 * Both ship through the mechanism P1 established and P2/P3 extended: .mdx
 * in content/blog/, published by scripts/sync-blog-to-db.ts (which extracts
 * the visible "Frequently asked questions" section into faq_json → the
 * FAQPage JSON-LD emitted by app/blog/[slug]/page.tsx), bylined by
 * components/EditorialByline.tsx, and wired into the job-page sidebar slots
 * in config/niche/content-map.ts.
 *
 * WHY THIS SUITE EXISTS
 * Each of these pages is the DELIBERATELY NARROW slice of a much bigger
 * feature the repo has no data for, and the whole value of the slice is
 * that it refuses to invent the missing data:
 *
 *   - There is no `Program`/`School` model, no accreditation dataset, and
 *     no /schools route in this repo (`grep '^model ' prisma/schema.prisma`;
 *     `ls app`). The only program-shaped table is `ProgramDirectorLead`, a
 *     PMHNP-scoped outreach CRM holding named individuals' work emails —
 *     not a directory, and nothing in it is accreditation-verified. So the
 *     schools page NAMES NO SCHOOL AND NO PROGRAM. Someone chooses a
 *     multi-year, five-figure education from a page like this, and a wrong
 *     "accredited" label can leave a graduate ineligible to sit for
 *     AANP/ANCC/NBCRNA/AMCB certification. That is strictly worse than a
 *     wrong salary band, and it is the single most harmful fabrication
 *     available to this codebase.
 *   - There are no per-state preceptor rules anywhere in this repo. Who may
 *     precept an APRN student, required hour counts, ratios, preceptor tax
 *     credits, and CE-for-precepting are set by 51 boards, the accreditors,
 *     and each school — 51 sources, no common format, none of them here.
 *     lib/blog-license-guides.ts already refuses to quote CE hours for
 *     exactly this reason ("boards revise them and stale numbers are worse
 *     than none"), and the same rule governs this page.
 *   - Neither page may price anything. Tuition, placement-service fees, and
 *     preceptor stipends appear in no repo source of truth. Note that
 *     app/jobs/mid-career/page.tsx:39 already asserts "many employers offer
 *     preceptor stipends or bonuses" with no source — pre-existing debt this
 *     package does not own, did not copy, and reports upward instead.
 *
 * The shared shape rules (frontmatter, Quick-answer opener, FAQ block,
 * bold-led block rendering, internal-link resolution) mirror
 * tests/regressions/p3-guides-round-2-malpractice-credentialing.test.ts
 * deliberately: these posts render through the same bespoke converter in
 * lib/blog.ts, so the same authoring hazards apply.
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
const PRECEPTOR_SLUG = 'np-preceptor-guide';
const SCHOOLS_SLUG = 'how-to-evaluate-np-programs';
const P4_SLUGS = [SCHOOLS_SLUG, PRECEPTOR_SLUG] as const;

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

/** Same counter the P1/P2/P3 suites use, so the bands are comparable. */
function wordCount(markdown: string): number {
    return markdown
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#*`>|]/g, '')
        .split(/\s+/)
        .filter(Boolean).length;
}

const BODIES = P4_SLUGS.map((slug) => ({ slug, ...parsePost(slug) }));

describe('content-map wiring', () => {
    const linked = new Set([
        ...RELATED_BLOG_SLUGS.always,
        ...RELATED_BLOG_SLUGS.remoteOrTelehealth,
        ...RELATED_BLOG_SLUGS.newGrad,
        ...RELATED_BLOG_SLUGS.generalFallback,
    ]);

    it('both wedges are linked from a sidebar slot and resolve to a real .mdx', () => {
        for (const slug of P4_SLUGS) {
            expect(linked.has(slug), `${slug} not wired into config/niche/content-map.ts`).toBe(true);
            expect(
                fs.existsSync(path.join(BLOG_DIR, `${slug}.mdx`)),
                `content/blog/${slug}.mdx missing — sidebar link drops silently, fork-preflight fails`,
            ).toBe(true);
        }
    });

    /**
     * Both ENDS of generalFallback are already owned by other suites: the P2
     * suite pins the first two entries (interview prep + resume, the only
     * two that can render on a plain job page, since the sidebar caps at 3
     * and `always` spends one slot) and the P3 suite pins the last two
     * (credentialing + malpractice). This package therefore inserts
     * MID-LIST. Asserted from this side too so a future reorder cannot
     * quietly break another package's contract while satisfying this one.
     */
    it('insertion did not disturb either end of generalFallback', () => {
        const fb = RELATED_BLOG_SLUGS.generalFallback;
        expect(fb.slice(0, 2)).toEqual(['np-interview-questions', 'np-resume-guide']);
        expect(new Set(fb.slice(-2))).toEqual(
            new Set(['np-credentialing-checklist', 'np-malpractice-insurance-guide']),
        );
        for (const slug of P4_SLUGS) {
            const i = fb.indexOf(slug);
            expect(i, `${slug} not in generalFallback`).toBeGreaterThan(1);
            expect(i, `${slug} landed in the P3-owned tail`).toBeLessThan(fb.length - 2);
        }
    });
});

describe('post shape', () => {
    for (const slug of P4_SLUGS) {
        it(`${slug}: frontmatter, category, length, quick answer, FAQ`, () => {
            const { fm, body } = parsePost(slug);
            expect(fm.title, 'title missing').toBeTruthy();
            expect(fm.slug, 'slug missing or mismatched').toBe(slug);
            expect(fm.description, 'description missing').toBeTruthy();
            expect(fm.date, 'date missing').toBeTruthy();
            expect(fm.reviewed, 'reviewed date missing').toBeTruthy();
            expect(CATEGORY_IDS.has(fm.category), `invalid category '${fm.category}'`).toBe(true);

            // The brief's band for both wedges.
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
     * schema stays Organization-only). Asserted here because an invented
     * "reviewed by a DNP faculty member" line on an education-choice page
     * would be a fabricated credential attached to a YMYL recommendation.
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
 * or it is dropped by .filter(Boolean) and appears NOWHERE). Everything else
 * falls through to the article grid, which groups by category and styles
 * each group from CATEGORY_CONFIG — a category with no entry there renders
 * under its raw id.
 *
 * On top of that automatic path this package adds ONE band ("Before you
 * apply"), and it resolves its cards against the DB rows the page already
 * fetches rather than hardcoding /blog/<slug> hrefs — those would be live
 * internal 404s in the window between deploying the file and running
 * scripts/sync-blog-to-db.ts against prod (the hazard
 * config/niche/content-map.ts documents for HOMEPAGE_FEATURED_POSTS, and
 * the reason lib/blog.ts's code fallback covers the license series ONLY).
 */
describe('reachable from /resources', () => {
    const resources = read('app/resources/page.tsx');

    it('the category split these posts rely on is still the one in the page', () => {
        expect(resources).toContain("p.category === 'state_spotlight'");
        expect(resources).toContain("p.category !== 'state_spotlight'");
    });

    for (const slug of P4_SLUGS) {
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
     * LABEL AGREEMENT between /resources and the canonical taxonomy.
     *
     * /resources is the ONLY surface that relabels a category: its
     * CATEGORY_CONFIG carries its own short `label`, while every other
     * surface reads lib/blog-categories.ts. app/blog/[slug]/page.tsx:227
     * derives `categoryLabel` from BLOG_CATEGORIES and renders it in the
     * breadcrumb (:392), the Category metadata field (:419), the hero photo
     * caption (:458) and — machine-readably — as Article JSON-LD
     * `articleSection` (:296); app/blog/page.tsx:290 badges the cards and the
     * filter chips from the same map.
     *
     * So filing a post under an id whose two labels disagree ships a visible
     * AND structured-data contradiction on the same post. `career_myths` is
     * exactly that id — BLOG_CATEGORIES calls it "Career Myths", /resources
     * calls it "Education" — and it is why both wedges are filed under
     * `career_opportunities`, the precedent np-ceu-requirements-by-state
     * already sets for a regulatory/education guide. The divergence was inert
     * only because no post had ever used the id; publishing under it is what
     * would have made it live.
     *
     * The rule is "shares a word", not string equality, because /resources
     * legitimately ABBREVIATES: "Career" for "Career Opportunities", "Salary"
     * for "Salary Negotiation", "Job Search" for "Job Seeker Tips".
     * Abbreviating is fine; RENAMING is the defect. Scoped to the categories
     * real posts actually use, so a dormant divergence on an unused id stays
     * out of this suite's blast radius (relabelling it is a taxonomy change,
     * and lib/blog-categories.ts is not this package's file).
     */
    it('every category a post is filed under is labelled consistently on both surfaces', () => {
        const resourceLabels = new Map<string, string>();
        for (const [, id, label] of resources.matchAll(/^\s*(\w+):\s*\{\s*label:\s*'([^']+)'/gm)) {
            resourceLabels.set(id, label);
        }
        expect(resourceLabels.size, 'CATEGORY_CONFIG parse failed — the shape changed').toBeGreaterThan(4);

        const wordsOf = (s: string) => new Set(s.toLowerCase().match(/[a-z]+/g) ?? []);
        const usedCategories = new Set(
            fs
                .readdirSync(BLOG_DIR)
                .filter((f) => f.endsWith('.mdx'))
                .map((f) => parsePost(f.replace(/\.mdx$/, '')).fm.category),
        );

        for (const id of usedCategories) {
            const canonical = BLOG_CATEGORIES.find((c) => c.id === id)?.label;
            expect(canonical, `a post is filed under '${id}', which is not in the public taxonomy`).toBeTruthy();
            const shortLabel = resourceLabels.get(id);
            // A missing entry is a DIFFERENT defect (the group renders under
            // the raw id) and the per-slug test above already pins it for the
            // two slugs this package owns.
            if (!shortLabel) continue;
            const shared = [...wordsOf(shortLabel)].filter((w) => wordsOf(canonical!).has(w));
            expect(
                shared,
                `/resources labels '${id}' "${shortLabel}" but every other surface — breadcrumb, Category field, hero caption, /blog badge, and Article JSON-LD articleSection — says "${canonical}"`,
            ).not.toEqual([]);
        }
    });

    it('the education band lists both wedges and is gated on the DB rows', () => {
        for (const slug of P4_SLUGS) {
            expect(resources, `${slug} missing from EDUCATION_WEDGE_SLUGS`).toContain(`'${slug}'`);
        }
        // Resolved against the already-fetched published rows…
        expect(resources).toContain('const educationWedge = EDUCATION_WEDGE_SLUGS');
        expect(resources).toContain('blogPosts.find(p => p.slug === slug)');
        // …and the band renders only when at least one resolved.
        expect(resources).toContain('{educationWedge.length > 0 && (');
        // No literal blog href anywhere on the page: that is the 404 hazard.
        expect(
            resources.match(/href="\/blog\/[a-z]/g) ?? [],
            'hardcoded /blog/<slug> href on /resources — 404s until the sync script runs',
        ).toEqual([]);
    });

    /**
     * No sitemap change is needed and none was made: blog URLs come from
     * getAllPublishedSlugs() (a DB read), so both posts enter the sitemap
     * the moment the sync script publishes them.
     */
    it('blog sitemap entries stay DB-derived (no hardcoded route list to update)', () => {
        const sitemap = read('app/sitemap.ts');
        expect(sitemap).toContain("import { getAllPublishedSlugs } from '@/lib/blog'");
        expect(sitemap).toContain('await getAllPublishedSlugs()');
    });
});

/**
 * The /for-programs flywheel. That page is the program-DIRECTOR side of the
 * same market; the schools guide is the applicant side. The link is gated
 * on a published DB row for the same 404 reason as the /resources band.
 */
describe('/for-programs cross-link', () => {
    const forPrograms = read('app/for-programs/page.tsx');

    it('links the schools guide via a DB lookup, not a hardcoded href', () => {
        expect(forPrograms).toContain(`const PROGRAM_GUIDE_SLUG = '${SCHOOLS_SLUG}'`);
        expect(forPrograms).toContain('slug: PROGRAM_GUIDE_SLUG');
        expect(forPrograms).toContain("status: 'published'");
        expect(forPrograms).toContain('{programGuide && (');
        expect(
            forPrograms.match(/href="\/blog\/[a-z]/g) ?? [],
            'hardcoded /blog/<slug> href on /for-programs — 404s until the sync script runs',
        ).toEqual([]);
    });

    it('the schools guide links back to /for-programs', () => {
        expect(parsePost(SCHOOLS_SLUG).body).toContain('/for-programs');
    });

    /**
     * The /for-programs FAQ still derives its FAQPage JSON-LD from the same
     * `programFaqs` array the visible accordion renders. The cross-link card
     * was added INSIDE that section, so this pins that it did not become a
     * second, unmirrored source of answers.
     */
    it('the for-programs FAQPage schema still derives from the visible array', () => {
        expect(forPrograms).toContain('const programFaqs = [');
        expect(forPrograms).toContain('mainEntity: programFaqs.map(');
    });
});

/**
 * ── TRUTH RULES ────────────────────────────────────────────────────────
 * Each rule below names a specific invented specific that would be harmful
 * on these two topics.
 */
describe('truth rules for the education wedges', () => {
    /**
     * THE RULE THIS WHOLE PACKAGE EXISTS FOR.
     *
     * The schools page is a decision GUIDE, not a directory, because the
     * dataset a directory needs does not exist in this repo and cannot be
     * reconstructed from ProgramDirectorLead (a PMHNP-scoped outreach CRM
     * with no accreditor, no status, and no as-of date). A named school on
     * this page would be an accreditation-adjacent claim with no source
     * behind it, read by someone about to commit years and tuition.
     *
     * The check is a denylist of institution-shaped patterns rather than a
     * fixed list of school names: the failure to catch is a future editor
     * "helpfully" adding examples, and examples always arrive in one of
     * these shapes.
     */
    it('names no school, university, or specific program', () => {
        const INSTITUTION_SHAPES: Array<[string, RegExp]> = [
            ['a named university/college', /\b(?:University|College|School)\s+of\s+[A-Z]/],
            ['a "X University/College" name', /\b[A-Z][A-Za-z&.'-]+\s+(?:University|College)\b/],
            ['a state-system campus', /\b[A-Z][A-Za-z]+\s+State\s+(?:University|College)\b/],
            ['a ranked/"best programs" list', /\b(?:top|best)\s+\d*\s*(?:np|nurse practitioner|nursing|msn|dnp)\s+programs?\b/i],
            ['a ranking source', /\bU\.?S\.?\s*News\b|\bniche\.com\b|\bnursingschool[a-z]*\.(?:com|org)\b/i],
        ];
        for (const { slug, body } of BODIES) {
            for (const [label, re] of INSTITUTION_SHAPES) {
                expect(body.match(re) ?? [], `${slug}: ${label}`).toEqual([]);
            }
        }
        // And the schools page states the contract in its own copy, so the
        // policy is legible to the next editor and not only to this test.
        const schools = parsePost(SCHOOLS_SLUG);
        expect(schools.fm.description).toMatch(/names no schools/i);
        expect(schools.body).toMatch(/names no schools and ranks no programs/i);
    });

    /**
     * ZERO money. Tuition, cost per credit, placement-service fees, and
     * preceptor stipends live in no repo source of truth
     * (lib/stats-sources.ts, config/niche/salary.ts). The pages route every
     * cost question to the financial-aid office or the program instead.
     */
    it('publishes no dollar figure of any kind', () => {
        for (const { slug, body } of BODIES) {
            expect(
                body.match(/\$\s?[\d]/g) ?? [],
                `${slug}: a dollar figure on a page that must not price tuition, fees, or stipends`,
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
     * NO invented durations, and NO clinical-hour counts.
     *
     * Program length, affiliation-agreement turnaround, preceptor-approval
     * time, and required clinical hours are set by accreditors, 51 boards,
     * and each individual school. None of them is in this repo. The pages
     * say WHO owns each clock instead — which is also the honest answer,
     * because the student cannot influence any of them.
     */
    it('quotes no program length, turnaround, or required hour count', () => {
        const DURATION = /\b\d+\s*(?:[-–]|to)?\s*\d*\s*(?:business\s+)?(?:day|week|month|year|semester|hour|minute)s?\b/gi;
        for (const { slug, body } of BODIES) {
            expect(body.match(DURATION) ?? [], `${slug}: invented duration or hour count`).toEqual([]);
            expect(
                body.match(/\b\d[\d,]*\s*(?:clinical|contact|direct[- ]care)\s+hours?\b/gi) ?? [],
                `${slug}: a clinical-hour requirement this repo cannot source`,
            ).toEqual([]);
        }
        // The preceptor page says so explicitly.
        expect(parsePost(PRECEPTOR_SLUG).body).toMatch(/no required hour counts, no fees/i);
    });

    /**
     * NO per-state requirement claims. Both pages route "what does my state
     * require" to the board, via the licensure series and the checker — the
     * same rule lib/blog-ceu-guide.ts applies to CE hours, and the reason
     * brief #4 rejected 51 per-state preceptor pages outright.
     */
    it('asserts no per-state or universal requirement', () => {
        for (const { slug, body } of BODIES) {
            expect(body, `${slug}: universal requirement claim`).not.toMatch(/\b(?:all|every) states? (?:require|requires|mandate)/i);
            expect(body, `${slug}: prevalence claim about state law`).not.toMatch(/\bmost states? (?:require|requires|allow|allows)/i);
            expect(body, `${slug}: names board rules it cannot source`).not.toMatch(/your state (?:requires|mandates) (?:a|an|that)/i);
            expect(body, `${slug}: invents a per-state precepting rule`).not.toMatch(/states? (?:require|requires) (?:a |an )?preceptor/i);
            // Hedged form is required wherever state law is invoked at all.
            if (/state law|board rule|board of nursing/i.test(body)) {
                expect(body, `${slug}: invokes state regulation without pointing at the board`).toMatch(
                    /board of nursing|licensure checker|\/tools\/licensure-checker/,
                );
            }
        }
    });

    /**
     * Brief #4 rejected the "willing to precept" employer flag: on
     * aggregated inventory (8 ATS sources, per public/llms.txt) it is either
     * empty or inferred, and inferring it from JD text would publish a false
     * claim about a named employer's commitment — "preceptor" in a JD almost
     * always means the NEW HIRE gets one. So the pillar must not imply this
     * board can route students to precepting sites, and must not promise
     * placement.
     */
    it('promises no preceptor matching, placement, or employer commitment', () => {
        const preceptor = parsePost(PRECEPTOR_SLUG).body;
        expect(preceptor, 'implies the board matches students to preceptors').not.toMatch(
            /\b(?:we|this board|our team)\b[^.]{0,60}\b(?:match|find|place|connect)\b[^.]{0,40}\bpreceptor/i,
        );
        expect(preceptor, 'implies a searchable preceptor-friendly employer filter').not.toMatch(
            /(?:filter|search|browse)[^.]{0,40}\b(?:willing to precept|preceptor[- ]friendly)\b/i,
        );
        expect(preceptor, 'unsourced stipend claim — the same one app/jobs/mid-career/page.tsx carries')
            .not.toMatch(/employers (?:offer|provide|pay)[^.]{0,40}\bpreceptor (?:stipend|bonus)/i);
        // The honest replacement: compensation and CE are the employer's,
        // the school's, and the board's answer to give.
        expect(preceptor).toMatch(/Whether precepting is compensated/i);
    });

    /**
     * FPA citation carries the AANP vintage and the transition-to-practice
     * caveat — the same rule the P2/P3 suites apply. The schools page turns
     * the classification into advice about WHERE to study relative to where
     * you will practice, which is exactly where day-one independence must
     * not be overstated.
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
     * name them — the schools page because certification eligibility is the
     * whole reason accreditation matters, the preceptor page because the
     * credential decides what precepting requires of an NP.
     */
    it('certification bodies are role-correct on both pages', () => {
        for (const { slug, body } of BODIES) {
            expect(body, `${slug}: NP bodies missing`).toMatch(/AANP/);
            expect(body, `${slug}: NP bodies missing`).toMatch(/ANCC/);
            expect(body, `${slug}: CRNA body missing`).toMatch(/NBCRNA/);
            expect(body, `${slug}: CNM body missing`).toMatch(/AMCB/);
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

    /**
     * The accreditor set must be complete and correctly scoped. Listing only
     * CCNE and ACEN silently mislabels a CNEA-accredited program as
     * unaccredited, and routing a CRNA or nurse-midwifery applicant to a
     * general nursing accreditor sends them to the wrong directory.
     */
    it('the schools page names all three nursing accreditors and the track-specific ones', () => {
        const schools = parsePost(SCHOOLS_SLUG).body;
        for (const acc of ['CCNE', 'ACEN', 'CNEA', 'COA', 'ACME']) {
            expect(schools, `accreditor ${acc} missing`).toContain(acc);
        }
        // The three-layer distinction is the page's core teaching: a school
        // can hold institutional accreditation without the programmatic
        // nursing accreditation certification eligibility turns on, and
        // board approval is a third, separate determination.
        expect(schools).toMatch(/institutional accreditation/i);
        expect(schools).toMatch(/programmatic/i);
        expect(schools).toMatch(/board approval/i);
        // Status, not label — an "accredited" badge with no date is the
        // failure mode that puts someone in an ineligible program.
        expect(schools).toMatch(/accreditation is a status with a date/i);
        expect(schools).toMatch(/accreditation pending/i);
    });

    /** The preceptor page's core mechanics — the reason it exists. */
    it('the preceptor page covers the parties, the agreement, and the failure modes', () => {
        const preceptor = parsePost(PRECEPTOR_SLUG).body;
        expect(preceptor).toMatch(/affiliation agreement/i);
        expect(preceptor).toMatch(/clinical placement coordinator|clinical coordinator/i);
        expect(preceptor).toMatch(/population focus/i);
        expect(preceptor).toMatch(/preceptor approval/i);
        expect(preceptor).toMatch(/third-party placement/i);
        // Who the authorities are, stated as authorities rather than answered.
        expect(preceptor).toMatch(/your program's policy and your board of nursing/i);
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
     * Every external link is a government body, an accreditor, a board or
     * regulator, or a certifying body. This is the positive half of the
     * no-invented-facts rule: the pages tell readers to verify at the
     * source, so where they send them is load-bearing. No school sites, no
     * ranking sites, no placement vendors.
     */
    it('every external link points at an authoritative body', () => {
        const ALLOWED_HOSTS = new Set([
            // Federal government
            'ope.ed.gov', 'nces.ed.gov', 'studentaid.gov',
            // Nursing accreditors
            'www.aacnnursing.org', 'www.acenursing.org', 'cnea.nln.org', 'www.coacrna.org',
            // Boards and license verification
            'www.ncsbn.org', 'www.nursys.com',
            // Professional associations and certifying bodies
            'www.aanp.org', 'www.aanpcert.org', 'www.nursingworld.org', 'www.nbcrna.com',
            'www.amcbmidwife.org',
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
        const schools = parsePost(SCHOOLS_SLUG).body;
        for (const host of [
            'www.aacnnursing.org', 'www.acenursing.org', 'cnea.nln.org', 'www.coacrna.org',
            'ope.ed.gov', 'www.ncsbn.org', 'www.aanpcert.org', 'www.nbcrna.com', 'www.amcbmidwife.org',
        ]) {
            expect(schools, `schools guide does not link ${host}`).toContain(host);
        }
        const preceptor = parsePost(PRECEPTOR_SLUG).body;
        for (const host of ['www.ncsbn.org', 'www.nursys.com', 'www.aacnnursing.org', 'www.acenursing.org', 'cnea.nln.org']) {
            expect(preceptor, `preceptor guide does not link ${host}`).toContain(host);
        }
    });
});

/**
 * The repo ships its own markdown converter (lib/blog.ts), not a standard
 * one, so markdown a normal renderer would handle can land on the page as
 * raw pipes or literal asterisks. Same checks as the P2/P3 suites.
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
     * leading header cell silently misaligns: markdownToHtml filters empty
     * cells out of the header row but keeps every non-empty body cell, so
     * the table renders with fewer <th> than <td> and the columns shift.
     * Both tables here name their first column for that reason.
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
     * The connective tissue brief #4 asks for. The pillar is only worth
     * shipping if the corpus that already uses preceptor language routes
     * into it and back out again — those three posts are the natural
     * inbound anchors, and the two wedges are each other's next step.
     */
    it('the two wedges cross-link each other and the existing preceptor corpus', () => {
        const preceptor = parsePost(PRECEPTOR_SLUG).body;
        const schools = parsePost(SCHOOLS_SLUG).body;
        expect(preceptor).toContain(`/blog/${SCHOOLS_SLUG}`);
        expect(schools).toContain(`/blog/${PRECEPTOR_SLUG}`);
        for (const anchor of [
            '/blog/new-grad-np-first-job',
            '/blog/np-interview-questions',
            '/blog/np-resume-guide',
        ]) {
            expect(preceptor, `preceptor pillar does not reach ${anchor}`).toContain(anchor);
        }
        for (const slug of P4_SLUGS) {
            expect(parsePost(slug).body, `${slug}: no route into the licensure series`).toContain('/tools/licensure-checker');
        }
    });

    /**
     * The three posts that already used preceptor language keep doing so.
     * If a future edit strips it, the inbound anchors above stop making
     * sense and the pillar is orphaned from the corpus it was written for.
     */
    it('the existing preceptor corpus still mentions preceptors', () => {
        for (const slug of ['new-grad-np-first-job', 'np-interview-questions', 'np-resume-guide']) {
            expect(
                parsePost(slug).body,
                `content/blog/${slug}.mdx no longer mentions preceptors — the pillar's inbound anchors are stale`,
            ).toMatch(/preceptor/i);
        }
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
