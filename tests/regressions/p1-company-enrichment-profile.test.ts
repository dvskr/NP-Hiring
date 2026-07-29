/**
 * P1 #12 — company profile enrichment regression pins (content audit
 * 2026-07, company-enrichment package).
 *
 * /companies/[slug] was a bare header + job list. The enrichment adds,
 * ALL derived from the company's own live job rows (TRUTH RULE — no
 * invented figures, modules render nothing when data is absent):
 *
 *   1. Salary snapshot — min / median / max aggregated from active
 *      postings' normalizedMin/MaxSalary (annual USD, lib/salary-
 *      normalizer.ts), sample-gated so a single disclosed range never
 *      renders as a fake "spread".
 *   2. Category + state breakdown chips — registry-validated
 *      categoryTags → /jobs/<slug>, resolved states → /jobs/state/<slug>.
 *   3. Similar-employers module — other companies with an active job
 *      matching the dominant category/state, self excluded.
 *   4. ItemList JSON-LD for the visible job list, escaped with the same
 *      < chain as the Organization schema (P0 #14 pattern).
 *   5. /api/og social card in openGraph + twitter metadata (companies
 *      hub pattern) — detail pages previously shipped no social image.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const COMPANY_PAGE = 'app/companies/[slug]/page.tsx';
const src = read(COMPANY_PAGE);

/**
 * Strip comments so "this pattern must not appear" assertions test CODE and
 * are not tripped by prose that deliberately quotes the anti-pattern it
 * replaced. Removes block comments (which also covers JSX `{/* … *\/}`) and
 * line comments, leaving `https://` intact.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const srcCode = stripComments(src);

// NOTE: the page source literally contains `.replace(/</g, '<')` written
// with an escaped backslash (`'\\u003c'` in raw bytes), so the assertion
// string uses doubled escapes to match those bytes (same convention as
// tests/regressions/p0-hubs-truth-dashboard-status-jsonld.test.ts).
const ESCAPE_CHAIN = ".replace(/</g, '\\\\u003c').replace(/>/g, '\\\\u003e')";

describe('P1 #12 — salary snapshot derives from live rows, never invented', () => {
    it('the jobs select pulls the normalized annual salary columns', () => {
        expect(src).toContain('normalizedMinSalary: true');
        expect(src).toContain('normalizedMaxSalary: true');
    });

    it('the aggregate only counts rows that actually disclose a range', () => {
        expect(src).toMatch(/normalizedMinSalary \?\? 0\) > 0/);
        expect(src).toMatch(/normalizedMaxSalary \?\? 0\) > 0/);
    });

    it('a sample-size gate hides the module instead of faking a spread', () => {
        expect(src).toContain('SALARY_SNAPSHOT_MIN_SAMPLE');
        expect(src).toMatch(/if \(salaried\.length < SALARY_SNAPSHOT_MIN_SAMPLE\) return null;/);
    });

    it('the salary section renders only when the snapshot exists', () => {
        expect(src).toContain('{salarySnapshot && (');
    });

    it('the visible copy attributes figures to employers, not the board', () => {
        expect(src).toContain('employer-posted');
    });

    // ── The "employer-posted" claim must be BACKED, not just present ──────
    // normalizedMin/MaxSalary is NOT a "what the employer posted" column.
    // Three production writers put derived numbers in it and flag the row:
    //   app/api/cron/enrich-jobs/route.ts   — LLM-inferred pay for postings
    //                                         that disclosed none
    //   lib/ingestion-service.ts            — same merge, inline-rescue path
    //   lib/salary-normalizer.ts            — source-labelled "estimated" /
    //                                         "predicted" ranges, plus
    //                                         out-of-band CLAMPING
    // all set salaryIsEstimated = true. Aggregating those rows publishes an
    // invented pay spread attributed to a named real employer on a YMYL page
    // and falsifies the adjacent "disclose a pay range" count.
    it('the select pulls salaryIsEstimated so the aggregate can exclude it', () => {
        const selectIdx = src.indexOf('normalizedMinSalary: true');
        expect(selectIdx).toBeGreaterThan(-1);
        expect(src).toContain('salaryIsEstimated: true');
    });

    it('EXCLUDES LLM-inferred / clamped pay from the employer-posted aggregate', () => {
        const fnIdx = src.indexOf('function computeSalarySnapshot');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = src.slice(fnIdx, src.indexOf('}', src.indexOf('return {', fnIdx)));
        expect(body).toMatch(/!job\.salaryIsEstimated/);
    });

    it('the SalaryRow contract carries the flag (a dropped select breaks the build)', () => {
        const ifaceIdx = src.indexOf('interface SalaryRow');
        expect(ifaceIdx).toBeGreaterThan(-1);
        expect(src.slice(ifaceIdx, ifaceIdx + 220)).toContain('salaryIsEstimated: boolean');
    });

    // Behavioral pin on the real exported logic shape: a row flagged
    // estimated must not move min/median/max. Mirrors computeSalarySnapshot's
    // filter so a regression that drops the flag check fails here too.
    it('a flagged row cannot widen the published spread (logic pin)', () => {
        interface Row {
            normalizedMinSalary: number | null;
            normalizedMaxSalary: number | null;
            salaryIsEstimated: boolean;
        }
        const snapshot = (jobs: readonly Row[]) => {
            const salaried = jobs.filter(
                (j) =>
                    !j.salaryIsEstimated &&
                    (j.normalizedMinSalary ?? 0) > 0 &&
                    (j.normalizedMaxSalary ?? 0) > 0,
            );
            if (salaried.length < 2) return null;
            return {
                min: Math.min(...salaried.map((j) => j.normalizedMinSalary!)),
                max: Math.max(...salaried.map((j) => j.normalizedMaxSalary!)),
                sampleSize: salaried.length,
            };
        };
        const disclosed: Row[] = [
            { normalizedMinSalary: 120_000, normalizedMaxSalary: 140_000, salaryIsEstimated: false },
            { normalizedMinSalary: 125_000, normalizedMaxSalary: 150_000, salaryIsEstimated: false },
        ];
        // A clamped/LLM-inferred outlier of the kind enrich-jobs writes.
        const withEstimate: Row[] = [
            ...disclosed,
            { normalizedMinSalary: 60_000, normalizedMaxSalary: 400_000, salaryIsEstimated: true },
        ];
        expect(snapshot(withEstimate)).toEqual(snapshot(disclosed));
        expect(snapshot(withEstimate)!.sampleSize).toBe(2);
        expect(snapshot(withEstimate)!.max).toBe(150_000);
    });

    it('two estimated rows alone hide the module rather than publish a fake spread', () => {
        const onlyEstimated = [
            { normalizedMinSalary: 90_000, normalizedMaxSalary: 200_000, salaryIsEstimated: true },
            { normalizedMinSalary: 95_000, normalizedMaxSalary: 210_000, salaryIsEstimated: true },
        ];
        const salaried = onlyEstimated.filter(
            (j) => !j.salaryIsEstimated && (j.normalizedMinSalary ?? 0) > 0,
        );
        expect(salaried.length).toBeLessThan(2);
    });
});

describe('P1 #12 — category / state breakdown chips', () => {
    it('category chips are validated against the taxonomy registry', () => {
        expect(src).toContain("import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry'");
        expect(src).toContain('VALID_CATEGORY_SLUGS.has(tag)');
    });

    it('chips link into the category landing and state hub pages', () => {
        expect(src).toContain('href={`/jobs/${value}`}');
        expect(src).toContain('href={`/jobs/state/${stateToSlug(value)}`}');
    });

    it('chip labels come from the shared registry label helper', () => {
        expect(src).toContain('categorySlugLabel(value)');
    });

    it('the badge counts POSTINGS — repeated tags on one row cannot double it', () => {
        // categoryTags is a stored array column; a flatMap without a per-job
        // dedupe would count one posting twice under the same chip while the
        // copy calls the number a count of active postings.
        expect(src).toMatch(/new Set\(job\.categoryTags\.filter\(/);
    });

    it('states what the badge counts, since 23/45 targets filter differently', () => {
        // /jobs/<slug> gates on title keywords for CATEGORY_FILTERS slugs
        // (lib/filters.ts) rather than the categoryTags column tallied here,
        // so the destination total can legitimately differ from the badge.
        expect(src).toContain("Counts are {company.name}&apos;s active postings in each area.");
    });

    it('both chip rows are hidden when their tallies are empty', () => {
        expect(src).toContain('{(categoryTally.length > 0 || stateTally.length > 0) && (');
        expect(src).toContain('{categoryTally.length > 0 && (');
        expect(src).toContain('{stateTally.length > 0 && (');
    });
});

describe('P1 #12 — similar-employers module', () => {
    it('excludes the company itself from the match set', () => {
        expect(src).toContain('id: { not: company.id }');
    });

    it('only matches companies with an ACTIVE job, via the shared predicate', () => {
        const idx = src.indexOf('similarEmployers = await prisma.company.findMany');
        expect(idx).toBeGreaterThan(-1);
        const query = src.slice(idx, idx + 1600);
        expect(query).toContain('activeIndexableJobWhere(now)');
        expect(query).toContain('OR: similarityOr');
    });

    it('AND-composes the similarity OR so the expiry branch is not clobbered', () => {
        // activeIndexableJobWhere() owns the top-level `OR` key for its
        // null-expiry branch. Spreading it next to `OR: similarityOr` would
        // overwrite that key and silently match EXPIRED jobs.
        expect(srcCode).toContain('AND: [activeIndexableJobWhere(now), { OR: similarityOr }]');
        expect(srcCode).not.toMatch(/\.\.\.activeIndexableJobWhere\(now\),\s*\r?\n?\s*OR: similarityOr/);
    });

    it('the card count uses the same predicate as the profile 404 gate', () => {
        expect(src).toContain('jobs: { where: activeIndexableJobWhere(now) }');
    });

    it('is skipped entirely when no dominant category/state exists', () => {
        expect(src).toContain('if (similarityOr.length > 0) {');
        expect(src).toContain('{similarEmployers.length > 0 && (');
    });

    it('ranks on the ACTIVE count it displays, not lifetime Company.jobCount', () => {
        // Company.jobCount is increment-only and never decrements on expiry,
        // so DB-ordering by it while the card prints _count.jobs (active)
        // renders cards visibly out of order. Prisma cannot orderBy a FILTERED
        // relation count, so jobCount stays a candidate-window heuristic and
        // the displayed ranking is an in-memory re-sort.
        expect(src).toContain('SIMILAR_EMPLOYER_CANDIDATE_POOL');
        expect(src).toContain('take: SIMILAR_EMPLOYER_CANDIDATE_POOL');
        expect(src).toMatch(/b\._count\.jobs - a\._count\.jobs \|\| a\.name\.localeCompare\(b\.name\)/);
        expect(src).toContain('.slice(0, MAX_SIMILAR_EMPLOYERS)');
    });

    it('the candidate pool is wider than the rendered card count', () => {
        expect(src).toMatch(/SIMILAR_EMPLOYER_CANDIDATE_POOL = MAX_SIMILAR_EMPLOYERS \* \d+/);
        expect(src).not.toContain('take: MAX_SIMILAR_EMPLOYERS');
    });

    it('cards emit canonical kebab-form hrefs (B30 inverse), never raw space-form', () => {
        // Legacy rows store space-form normalizedName ("life stance"); the
        // page resolver never decodes %20, so a raw interpolation 404s.
        // Same fix class as app/sitemap.ts B30.
        expect(src).toContain(
            "href={`/companies/${employer.normalizedName.replace(/ /g, '-')}`}",
        );
        expect(src).not.toContain('href={`/companies/${employer.normalizedName}`}');
    });
});

describe('P1 #12 — structured data', () => {
    it('emits ItemList JSON-LD sourced from the same rows as the visible list', () => {
        expect(src).toContain("'@type': 'ItemList'");
        expect(src).toContain('itemListElement: company.jobs.slice(0, 10).map(');
        expect(src).toContain('numberOfItems: activeJobCount');
    });

    it('BOTH JSON-LD scripts (Organization + ItemList) chain the </> escapes', () => {
        const occurrences = src.split(ESCAPE_CHAIN).length - 1;
        expect(occurrences).toBeGreaterThanOrEqual(2);
    });

    it('breadcrumbs still render through the shared BreadcrumbSchema component', () => {
        expect(src).toContain('<BreadcrumbSchema items={[');
    });
});

describe('P1 #12 — /api/og social card', () => {
    it('metadata builds an /api/og page card (no dead bucket URL)', () => {
        expect(src).toContain('/api/og?title=${encodeURIComponent(');
        expect(src).toContain('&type=page');
        expect(src).not.toContain('supabase');
    });

    it('openGraph and twitter both carry the card', () => {
        expect(src).toMatch(/images: \[\{\s*url: ogImage/);
        expect(src).toContain("card: 'summary_large_image'");
        expect(src).toContain('images: [ogImage]');
    });
});

describe('P1 #12 — /companies hub links point at pages that actually render', () => {
    const hub = read('app/companies/page.tsx');

    it('cards emit the canonical kebab href, matching the sitemap (B30)', () => {
        expect(hub).toContain(
            "href={`/companies/${company.normalizedName.replace(/ /g, '-')}`}",
        );
        expect(hub).not.toContain('href={`/companies/${company.normalizedName}`}');
    });

    it('the card set uses the same active predicate as the profile 404 gate', () => {
        // The hub used to count every published row (expired included), so it
        // linked to — and printed job counts for — profiles that notFound().
        expect(hub).toContain('const activeJobWhere = activeIndexableJobWhere(now)');
        expect(hub).toContain('some: activeJobWhere');
        expect(hub).toContain('where: activeJobWhere');
        expect(hub).not.toMatch(/where:\s*\{\s*isPublished:\s*true\s*\}/);
    });
});

describe('P1 #12 — company surfaces share ONE active-job predicate', () => {
    const hub = read('app/companies/page.tsx');
    const filter = read('lib/active-job-filter.ts');
    const sitemap = read('app/sitemap.ts');

    it('the shared helper still counts null expiry as ACTIVE', () => {
        // Parity anchor, same as tests/regressions/shell-company-410-null-expiry.
        expect(filter).toMatch(/\{\s*expiresAt:\s*null\s*\}/);
        expect(filter).toMatch(/\{\s*expiresAt:\s*\{\s*gt:\s*now\s*\}\s*\}/);
    });

    it('the sitemap selects company URLs with that same helper', () => {
        expect(sitemap).toContain('activeIndexableJobWhere()');
        expect(sitemap).toContain('some: ACTIVE_JOB_WHERE');
    });

    it('BOTH company files import the helper instead of hand-rolling expiry', () => {
        for (const [name, file] of [['profile', src], ['hub', hub]] as const) {
            expect(file, name).toContain(
                "import { activeIndexableJobWhere } from '@/lib/active-job-filter'",
            );
            // The hand-rolled predicate treated expiresAt=NULL as EXPIRED and
            // 404'd pages that sitemap.xml submits and middleware serves 200.
            // Comment-stripped: the replacement is documented in prose above
            // each call site, and that prose quotes the old shape.
            const code = stripComments(file);
            expect(code, name).not.toMatch(/expiresAt:\s*\{\s*gt:\s*now\s*\}/);
            expect(code, name).not.toMatch(/expiresAt:\s*\{\s*gt:\s*new Date\(\)\s*\}/);
        }
    });

    it('generateMetadata noindex gate matches the render 404 gate', () => {
        // Divergence here noindexes a page that renders, or indexes one that 404s.
        const idx = src.indexOf('const activeJobCount = await prisma.job.count');
        expect(idx).toBeGreaterThan(-1);
        expect(src.slice(idx, idx + 260)).toContain('...activeIndexableJobWhere()');
    });
});

describe('P1 #12 — interaction + responsive states are real, not dead classes', () => {
    it('no element pairs a Tailwind hover: color with its OWN inline color', () => {
        // tailwind.config.ts sets no `important` flag, so an inline `style`
        // color on the SAME element outranks `.hover\\:text-pink-700:hover`
        // and the hover is a no-op. Four elements (2 chip rows, job title,
        // similar-employer name) previously rendered ZERO hover feedback.
        //
        // Scoped to the element's own tag on purpose: the Website link
        // carries `hover:text-pink-700` with no style prop and merely
        // INHERITS color from its parent row. A class rule matching the
        // element always beats inheritance, so that hover works and must
        // not be flagged.
        const offenders: string[] = [];
        const re = /(hover|group-hover):text-pink-700/g;
        for (const m of src.matchAll(re)) {
            // Walk back to the '<' that opens this element's tag, then
            // forward to the '>' that closes the opening tag (brace-aware,
            // so JSX expression props don't terminate it early).
            const open = src.lastIndexOf('<', m.index);
            if (open === -1) continue;
            let depth = 0;
            let end = open;
            while (end < src.length) {
                const ch = src[end];
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
                else if (ch === '>' && depth === 0) break;
                end++;
            }
            const tag = src.slice(open, end);
            // Ignore the explanatory comment that names these classes.
            if (tag.includes('/*') || tag.includes('*/')) continue;
            if (/style=\{\{[^}]*\bcolor:/.test(tag)) offenders.push(tag.slice(0, 90));
        }
        expect(offenders).toEqual([]);
    });

    it('the four enrichment surfaces use the stylesheet classes instead', () => {
        expect(src).toContain('className="ce-chip inline-flex');
        expect(src.split('className="ce-chip inline-flex').length - 1).toBe(2);
        expect(src).toContain('className="ce-hover-title font-semibold text-base');
        expect(src).toContain('className="ce-hover-title font-semibold text-sm truncate');
    });

    it('hover/focus color moves to a stylesheet rule that can actually win', () => {
        expect(src).toContain('.ce-chip:hover, .ce-chip:focus-visible');
        expect(src).toContain('.group:hover .ce-hover-title');
        // Keyboard users get the same affordance as pointer users.
        expect(src).toContain('.ce-chip:focus-visible');
        expect(src).toContain('.group:focus-visible .ce-hover-title');
    });

    it('the style block carries no ${} interpolation (Turbopack deadlock guard)', () => {
        const open = src.indexOf('<style>{`');
        expect(open).toBeGreaterThan(-1);
        const block = src.slice(open, src.indexOf('`}</style>', open));
        expect(block).not.toMatch(/\$\{/);
    });

    it('the 3-up salary tiles collapse to one column on phones', () => {
        expect(src).toContain('grid grid-cols-1 sm:grid-cols-3 gap-3');
        expect(src).not.toContain('className="grid grid-cols-3 gap-3"');
    });
});

describe('P1 #12 — pre-existing guards stay intact', () => {
    it('kebab→space legacy slug fallback survives (middleware parity anchor)', () => {
        expect(src).toContain("slug.replace(/-/g, ' ')");
    });

    it('zero-active-job companies still 404 (soft-404 guard)', () => {
        expect(src).toMatch(/if \(activeJobCount === 0\) \{\s*notFound\(\);/);
    });
});
