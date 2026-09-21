/**
 * Company profile thin-content pins (PLAN.md C.4 item 7, thin-spec-4 3E).
 *
 * Three things are worth failing a build over on `/companies/[slug]`, and
 * all three are the kind that regress silently:
 *
 *   1. THE INDEX GATE. A profile is `index,follow` only at
 *      MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX active jobs; 1 to 4 render and stay
 *      linked but do not compete in search with the job detail pages they
 *      mostly repeat, and 0 never renders at all. Robots, the page's own 404
 *      gate and the sitemap must read one count.
 *   2. FAQ PARITY. One array feeds the visible accordion and the FAQPage
 *      JSON-LD, the accordion is a server component so every answer is in
 *      the served HTML, and the schema is emitted only with two or more
 *      entries. A question that fails its render condition must leave both
 *      halves together — the alternative is structured data whose answers
 *      are nowhere on the page.
 *   3. THE MIDDLEWARE PREDICATE. The 410 gate must count the same rows the
 *      profile does. When it counted more (no dead-link gate, no profession
 *      quarantine) a company whose only remaining rows were dead links or
 *      quarantined non-NP titles passed the gate and then 404'd on the page.
 *
 * Plus the CO-B6 pay floor and the CO-B9 similarity axis, which are the two
 * defects a future edit is most likely to undo by "simplifying".
 *
 * Source pins follow the repo's static-guard convention
 * (tests/regressions/p1-company-enrichment-profile.test.ts); the behavioural
 * assertions run the real exported helpers.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
    MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX,
    MIN_JOBS_FOR_LINK_LIST_ROW,
    shouldIndexCompanyProfile,
} from '@/lib/pseo/render-gate';
import { BENCHMARK_MIN_POSTINGS } from '@/components/tools/benchmark-model';
import { DEAD_LINK_MISS_THRESHOLD } from '@/lib/active-job-filter';
import { buildCompanyFaqs } from '@/lib/pseo/listing-narrative';
import {
    COMPANY_CITY_LINK_MIN_JOBS,
    buildCompanyProfileFacts,
    resolveRowStateName,
    selectCompanyCities,
    selectDominantCategory,
    type CompanyProfileRow,
} from '@/lib/company-profile-facts';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PROFILE_PAGE = 'app/companies/[slug]/page.tsx';
const CLAIM_CTA = 'app/companies/[slug]/ClaimProfileCta.tsx';
const MIDDLEWARE = 'middleware.ts';

const page = read(PROFILE_PAGE);
const cta = read(CLAIM_CTA);
const middleware = read(MIDDLEWARE);

/** A row with only the fields a given assertion cares about. */
function row(overrides: Partial<CompanyProfileRow> = {}): CompanyProfileRow {
    return {
        city: null,
        state: null,
        stateCode: null,
        isRemote: false,
        isHybrid: false,
        jobType: null,
        categoryTags: [],
        originalPostedAt: null,
        createdAt: new Date('2026-09-01T00:00:00Z'),
        newGradFriendly: false,
        normalizedMinSalary: null,
        normalizedMaxSalary: null,
        salaryIsEstimated: false,
        ...overrides,
    };
}

/* ── 1. The index gate ───────────────────────────────────────────────────── */

describe('C-IDX — a profile is indexable only at the company floor', () => {
    it('the floor is the same 5 every other "enough postings to say something" gate uses', () => {
        expect(MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX).toBe(BENCHMARK_MIN_POSTINGS);
    });

    it('1 to 4 active jobs is noindex, 5 and up is index', () => {
        expect(shouldIndexCompanyProfile(0)).toBe(false);
        expect(shouldIndexCompanyProfile(1)).toBe(false);
        expect(shouldIndexCompanyProfile(MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX - 1)).toBe(false);
        expect(shouldIndexCompanyProfile(MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX)).toBe(true);
        expect(shouldIndexCompanyProfile(MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX + 20)).toBe(true);
    });

    it('generateMetadata decides robots with that function, not a local literal', () => {
        expect(page).toContain("import { shouldIndexCompanyProfile } from '@/lib/pseo/render-gate'");
        expect(page).toContain('index: shouldIndexCompanyProfile(activeJobCount)');
    });

    it('a noindexed profile still follows its links and keeps a self canonical', () => {
        // A profile below the floor is still the only page listing those jobs
        // together; de-indexing it must not also orphan them.
        expect(page).toContain('follow: true');
        expect(page).toContain('canonical: `${brand.baseUrl}/companies/${slug}`');
        expect(page).not.toMatch(/follow:\s*false/);
    });

    it('robots and the 404 gate count the SAME rows (one loader, one array)', () => {
        // Both read company.jobs.length from the cache()d loader, so a company
        // can never be noindexed while its page renders, or vice versa.
        expect(page).toContain('const loadCompanyProfile = cache(');
        expect(page).toContain('const activeJobCount = company.jobs.length');
        expect(page).toContain('if (activeJobCount === 0) {');
        // And there is no second count to drift from the first.
        expect(page).not.toContain('await prisma.job.count');
    });

    it('a database failure is a 5xx, never a cached 404 on a live profile', () => {
        // This route is ISR-cached for an hour. `catch { notFound() }` around
        // the load turned one bad minute into a 404 crawlers de-index on,
        // for a company whose page was fine. Absence is `null`; failure throws.
        const loader = page.slice(
            page.indexOf('const loadCompanyProfile = cache('),
            page.indexOf('export async function generateMetadata'),
        );
        expect(loader.length).toBeGreaterThan(0);
        expect(loader).not.toContain('notFound()');
        expect(loader).not.toMatch(/catch\s*\(/);
        expect(loader).toContain('if (!resolvedName) return null;');
    });
});

/* ── 2. FAQ parity ───────────────────────────────────────────────────────── */

describe('CO-C6 — the FAQ the crawler reads is the FAQ the reader reads', () => {
    it('the accordion and the schema consume ONE array', () => {
        expect(page).toContain('const faqs: FaqEntry[] = buildCompanyFaqs(');
        expect(page).toContain('<CategoryFAQAccordion faqs={faqs} />');
        expect(page).toContain('faqs.map((entry) => ({');
    });

    it('the accordion is the shared SERVER component, so answers are in the HTML', () => {
        expect(page).toContain("import CategoryFAQAccordion from '@/components/CategoryFAQAccordion'");
        const accordion = read('components/CategoryFAQAccordion.tsx');
        expect(accordion).not.toContain("'use client'");
        expect(accordion).toContain('<p className="faq-answer">{faq.answer}</p>');
    });

    it('FAQPage is emitted only with two or more entries', () => {
        expect(page).toContain('const MIN_FAQ_ENTRIES_FOR_SCHEMA = 2');
        expect(page).toContain('faqs.length >= MIN_FAQ_ENTRIES_FOR_SCHEMA');
    });

    it('a question whose data is missing leaves the array, so it leaves both halves', () => {
        // No states, no disclosed pay, no new-grad rows: those three questions
        // must be absent rather than answered with an empty or zero clause.
        const faqs = buildCompanyFaqs({
            company: 'Acme Health',
            total: 3,
            states: [],
            disclosed: 0,
            workMode: { total: 3, remote: 0, hybrid: 0, onsite: 3 },
            newGradFriendly: 0,
        });
        const questions = faqs.map((entry) => entry.question);
        expect(questions.some((q) => q.startsWith('Where is'))).toBe(false);
        expect(questions.some((q) => q.includes('new graduate'))).toBe(false);
        for (const entry of faqs) {
            expect(entry.answer.trim().length).toBeGreaterThan(0);
            expect(entry.answer).not.toMatch(/\b0 /);
        }
    });

    it('every answer is plain text with no dash characters', () => {
        const faqs = buildCompanyFaqs({
            company: 'Acme Health',
            total: 6,
            states: [{ name: 'Texas', count: 4 }, { name: 'Ohio', count: 2 }],
            disclosed: 2,
            workMode: { total: 6, remote: 2, hybrid: 1, onsite: 3 },
            newGradFriendly: 1,
        });
        expect(faqs.length).toBeGreaterThanOrEqual(2);
        for (const entry of [...faqs.map((f) => f.question), ...faqs.map((f) => f.answer)]) {
            expect(entry).not.toMatch(/[–—]/);
            expect(entry).not.toMatch(/ - /);
        }
    });
});

/* ── 3. The middleware predicate ─────────────────────────────────────────── */

describe('the company 410 gate counts what the profile counts', () => {
    const gate = middleware.slice(
        middleware.indexOf('410 Gone for Empty Company Pages'),
        middleware.indexOf('410 Gone for Structurally Invalid pSEO URLs'),
    );

    it('the block exists and is the region under test', () => {
        expect(gate.length).toBeGreaterThan(0);
    });

    it('treats a NULL expiry as active, exactly as the page predicate does', () => {
        expect(gate).toContain('expires_at.is.null');
    });

    it('applies the repeated-dead-link gate from the shared constant', () => {
        expect(middleware).toContain("import { DEAD_LINK_MISS_THRESHOLD } from '@/lib/active-job-filter'");
        expect(gate).toContain('health_consecutive_missing=lt.${DEAD_LINK_MISS_THRESHOLD}');
        expect(gate).not.toMatch(/health_consecutive_missing=lt\.\d/);
        expect(DEAD_LINK_MISS_THRESHOLD).toBeGreaterThan(0);
    });

    it('applies the profession quarantine in memory rather than re-expressing it in REST', () => {
        // GLOBAL_EXCLUSIONS is case-insensitive title patterns with rescue
        // signals; a hand-written PostgREST copy would drift from lib/filters.ts.
        expect(gate).toContain('select=${LISTING_GATE_SELECT}');
        expect(gate).toContain('passesListingQuarantine(jobRow)');
    });

    it('never 410s on an unevaluable quarantine or an incomplete row set', () => {
        // `!== false` keeps a null verdict alive; `sawEveryRow` keeps a capped
        // fetch from being read as proof of absence.
        expect(gate).toContain('passesListingQuarantine(jobRow) !== false');
        expect(gate).not.toContain('passesListingQuarantine(jobRow) === true');
        expect(gate).toContain('servable === 0 && sawEveryRow');
        expect(gate).toContain('jobRows.length < ACTIVE_JOB_FETCH_LIMIT');
    });

    it('still falls back from the kebab slug to the legacy space form (B30)', () => {
        expect(gate).toContain("decodedSlug.replace(/-/g, ' ')");
        expect(gate).toContain('lookupDefinitive');
    });
});

/* ── 4. CO-B6: the pay floor ─────────────────────────────────────────────── */

describe('CO-B6 — an employer median waits for the same sample everything else does', () => {
    it('the snapshot floor is BENCHMARK_MIN_POSTINGS, not a page literal', () => {
        expect(page).toContain('const SALARY_SNAPSHOT_MIN_SAMPLE = BENCHMARK_MIN_POSTINGS');
        expect(page).not.toMatch(/SALARY_SNAPSHOT_MIN_SAMPLE = \d/);
    });

    it('below the floor the block renders the count sentence and no figure', () => {
        expect(page).toContain('const payCountSentence = buildCompanyPaySentence(');
        expect(page).toContain('{!salarySnapshot && (');
        expect(page).toContain('{payCountSentence}');
    });

    it('the disclosed-pay count excludes inferred pay, like the snapshot does', () => {
        const rows = [
            row({ normalizedMinSalary: 120_000, normalizedMaxSalary: 140_000 }),
            row({ normalizedMinSalary: 60_000, normalizedMaxSalary: 400_000, salaryIsEstimated: true }),
            row({ normalizedMinSalary: null, normalizedMaxSalary: null }),
        ];
        expect(buildCompanyProfileFacts(rows).disclosedPay).toBe(1);
    });
});

/* ── 5. CO-B9: the similarity axis ───────────────────────────────────────── */

describe('CO-B9 — similar employers match on clinical intent, never on "Full Time"', () => {
    it('an employment-type tag never wins, even as the most common tag', () => {
        const rows = [
            row({ categoryTags: ['full-time', 'psychiatric-mental-health'] }),
            row({ categoryTags: ['full-time'] }),
            row({ categoryTags: ['full-time'] }),
        ];
        expect(selectDominantCategory(rows)).toBe('psychiatric-mental-health');
    });

    it('an experience tag never wins either', () => {
        const rows = [
            row({ categoryTags: ['new-grad', 'new-grad'] }),
            row({ categoryTags: ['new-grad', 'remote'] }),
        ];
        expect(selectDominantCategory(rows)).toBe('remote');
    });

    it('the setting axis is the runner up when no specialty tag exists', () => {
        const rows = [
            row({ categoryTags: ['telehealth', 'per-diem'] }),
            row({ categoryTags: ['telehealth'] }),
        ];
        expect(selectDominantCategory(rows)).toBe('telehealth');
    });

    it('an APRN tag counts as clinical intent', () => {
        expect(selectDominantCategory([row({ categoryTags: ['anesthesia', 'contract'] })])).toBe('anesthesia');
    });

    it('nothing clinical and nothing about setting yields no match at all', () => {
        expect(selectDominantCategory([row({ categoryTags: ['full-time', 'senior'] })])).toBeNull();
    });

    it('a repeated tag on one row cannot outvote a tag on two rows', () => {
        const rows = [
            row({ categoryTags: ['oncology', 'oncology', 'oncology'] }),
            row({ categoryTags: ['cardiology'] }),
            row({ categoryTags: ['cardiology'] }),
        ];
        expect(selectDominantCategory(rows)).toBe('cardiology');
    });

    it('the page reads the derived value rather than the old all-axis tally', () => {
        expect(page).toContain('const dominantCategory = facts.dominantCategory');
        expect(page).not.toContain('const dominantCategory = categoryTally[0]?.value ?? null');
    });
});

/* ── 6. CO-C5: a linked city is a city that renders ──────────────────────── */

describe('CO-C5 — a city chip links only where the destination resolves', () => {
    it('the link floor is the shared link-list row floor', () => {
        expect(COMPANY_CITY_LINK_MIN_JOBS).toBe(MIN_JOBS_FOR_LINK_LIST_ROW);
    });

    it('below the floor the city is named but carries no slug', () => {
        const rows = [
            row({ city: 'Austin', stateCode: 'TX' }),
            row({ city: 'Austin', stateCode: 'TX' }),
        ];
        const [austin] = selectCompanyCities(rows);
        expect(austin.name).toBe('Austin');
        expect(austin.count).toBe(2);
        expect(austin.slug).toBeNull();
    });

    it('at the floor the city links to its own page', () => {
        const rows = Array.from({ length: COMPANY_CITY_LINK_MIN_JOBS }, () =>
            row({ city: 'Austin', stateCode: 'TX' }));
        expect(selectCompanyCities(rows)[0].slug).toBe('austin-tx');
    });

    it('a name the slug cannot round-trip is never linked, however many roles it has', () => {
        // "St. Louis" slugifies to "st-louis-mo", which the city route parses
        // back to "St Louis" and matches zero rows.
        const rows = Array.from({ length: COMPANY_CITY_LINK_MIN_JOBS + 5 }, () =>
            row({ city: 'St. Louis', stateCode: 'MO' }));
        const [stLouis] = selectCompanyCities(rows);
        expect(stLouis.count).toBeGreaterThan(COMPANY_CITY_LINK_MIN_JOBS);
        expect(stLouis.slug).toBeNull();
    });

    it('a row with no state code is never linked', () => {
        const rows = Array.from({ length: COMPANY_CITY_LINK_MIN_JOBS }, () =>
            row({ city: 'Remote', stateCode: null }));
        expect(selectCompanyCities(rows)[0].slug).toBeNull();
    });
});

/* ── 7. CO deletions and the remaining copy rules ────────────────────────── */

describe('CO deletions — the claim prompt is one sentence', () => {
    it('the prompt comes from the copy module the lint covers', () => {
        expect(page).toContain('intro={COMPANY_CLAIM_CTA}');
        expect(cta).toContain('{intro}');
    });

    it('the four-sentence pitch is gone from the client component', () => {
        expect(cta).not.toContain('This profile was built from public job postings. If you hire here');
        expect(cta).not.toContain('you can ask');
    });

    it('the component still promises review rather than control', () => {
        expect(cta).toContain('nothing on this page changes');
    });
});

describe('profile copy obeys the house rules', () => {
    const owned = [PROFILE_PAGE, CLAIM_CTA, 'lib/company-profile-facts.ts'] as const;

    it.each(owned)('%s carries no en dash, em dash or spaced hyphen in a string', (rel) => {
        const src = read(rel);
        // Comments legitimately use an em dash as an aside; string and JSX text
        // content is what ships to a reader, a title or a JSON-LD field.
        const withoutComments = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
        expect(withoutComments, `${rel} has an en or em dash in code`).not.toMatch(/[–—]/);
    });

    it.each(owned)('%s has no console.log and no styled-jsx interpolation', (rel) => {
        const src = read(rel);
        expect(src).not.toContain('console.log');
        expect(src).not.toContain('<style jsx');
    });

    it('the page publishes no hand-typed salary band', () => {
        expect(page).not.toMatch(/\$\d{2,3}K?\s*(to|-)\s*\$\d{2,3}K?/i);
        expect(page).not.toContain('avgSalary');
        expect(page).not.toContain('rawAvgSalary');
        expect(page).not.toContain('salaryRange');
    });

    it('the page makes no cadence or trend claim it cannot back', () => {
        for (const banned of ['added daily', 'updated daily', 'cost of living', 'HPSA']) {
            expect(page, `profile page re-introduces "${banned}"`).not.toContain(banned);
        }
    });
});

/* ── 8. CO-C1 to CO-C4 render conditions ─────────────────────────────────── */

describe('every new block omits itself rather than padding', () => {
    it('the footprint sentence names states, specialties and a date only when they exist', () => {
        const facts = buildCompanyProfileFacts([
            row({ state: 'Texas', stateCode: 'TX', categoryTags: ['psychiatric-mental-health'] }),
        ]);
        expect(facts.states).toEqual([{ name: 'Texas', count: 1 }]);
        expect(facts.topSpecialties.length).toBe(1);
        expect(facts.recency?.newestPostedAt).toBeInstanceOf(Date);

        const empty = buildCompanyProfileFacts([]);
        expect(empty.states).toEqual([]);
        expect(empty.topSpecialties).toEqual([]);
        expect(empty.recency).toBeNull();
        expect(empty.dominantCategory).toBeNull();
        expect(empty.allRemote).toBe(false);
    });

    it('work arrangement needs two postings before it renders', () => {
        expect(page).toContain('const MIN_JOBS_FOR_WORK_ARRANGEMENT = 2');
        expect(page).toContain('activeJobCount >= MIN_JOBS_FOR_WORK_ARRANGEMENT');
        expect(page).toContain('{arrangementLines.length > 0 && (');
    });

    it('a work-mode branch with zero rows never prints as a zero', () => {
        const facts = buildCompanyProfileFacts([
            row({ isRemote: true }),
            row({ isRemote: true }),
        ]);
        expect(facts.workMode).toEqual({ total: 2, remote: 2, hybrid: 0, onsite: 0 });
        expect(facts.allRemote).toBe(true);
    });

    it('a state-code-only row still counts as a state, on both surfaces', () => {
        // Otherwise the footprint sentence reads "in remote roles with no
        // listed state" directly above a chip row naming the states.
        expect(resolveRowStateName({ state: null, stateCode: 'TX' })).toBe('Texas');
        expect(resolveRowStateName({ state: 'Texas', stateCode: null })).toBe('Texas');
        expect(resolveRowStateName({ state: 'Nowhere', stateCode: null })).toBeNull();

        const facts = buildCompanyProfileFacts([row({ state: null, stateCode: 'TX', isRemote: true })]);
        expect(facts.states).toEqual([{ name: 'Texas', count: 1 }]);
        expect(facts.allRemote).toBe(false);

        // And the page's chip tally reads that same function, not a copy.
        expect(page).toContain('.map(resolveRowStateName)');
        expect(page).not.toContain('function resolveJobStateName');
    });

    it('practice rules render from the dataset, capped, and drop unknown states', () => {
        expect(page).toContain("import { getPracticeEnvironment } from '@/lib/pseo/practice-environment'");
        expect(page).toContain('return env ? [{ state, env }] : [];');
        expect(page).toContain('{practiceStates.length > 0 && (');
        const nine = ['Texas', 'Ohio', 'Florida', 'Georgia', 'Arizona', 'Nevada', 'Utah', 'Maine', 'Iowa'];
        const facts = buildCompanyProfileFacts(nine.map((state) => row({ state })));
        expect(facts.states.length).toBe(9);
        expect(facts.topStates.length).toBe(5);

        // A state name outside the dataset is dropped, not printed blank.
        const unknown = buildCompanyProfileFacts([row({ state: 'Westeros' })]);
        expect(unknown.states).toEqual([]);
    });
});
