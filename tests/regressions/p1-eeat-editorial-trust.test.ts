/**
 * P1 #8 — E-E-A-T infrastructure without fabricated people.
 *
 * Pins:
 *   1. brand.editorial.reviewer DEFAULTS TO NULL — no invented reviewer
 *      ships until a real credentialed clinician is contracted.
 *   2. editorialSchemaFields() emits nothing while the reviewer config is
 *      null, and a schema.org Person derived from the SAME config object
 *      when populated (schema can never disagree with the visible byline).
 *   3. /editorial-policy exists, cites stats exclusively through
 *      lib/stats-sources.ts (no hardcoded figures), branches its review
 *      status on the reviewer config, and ships a canonical. Its
 *      disclosures about other surfaces never promise less than those
 *      surfaces print: the metro-guide paragraph is run against every
 *      record in lib/metro-data.ts.
 *   4. app/blog/[slug]/page.tsx renders the byline (hero + author card —
 *      both the license-guide and generic branches flow through these
 *      shared blocks), spreads editorialSchemaFields() into the
 *      BlogPosting JSON-LD, and escapes its serialized schema.
 *   5. The byline component itself reads brand.editorial.reviewer and
 *      links the editorial policy — it never hardcodes a person.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { brand, type EditorialReviewer } from '@/config/brand';
import { editorialSchemaFields, reviewerDisplayName } from '@/components/EditorialByline';
import { METRO_CITIES } from '@/lib/metro-data';

const ROOT = process.cwd();
const read = (rel: string): string =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Collapse JSX indentation/newlines so prose assertions match the sentence
 * a reader actually sees. Without this, a claim is "absent" purely because
 * Prettier wrapped it across two lines — which would let a false claim slip
 * back in under a differently-wrapped phrasing.
 */
const prose = (src: string): string => src.replace(/\s+/g, ' ');

const SAMPLE_REVIEWER: EditorialReviewer = {
    name: 'Test Reviewer',
    credentials: 'DNP, APRN, FNP-BC',
    title: 'Clinical Reviewer',
    profileUrl: 'https://example.com/reviewer',
    npi: '1234567890',
};

describe('P1 #8 — reviewer config defaults', () => {
    it('brand.editorial.reviewer defaults to null (no fabricated person)', () => {
        expect(brand.editorial.reviewer).toBeNull();
    });

    it('policyPath points at /editorial-policy', () => {
        expect(brand.editorial.policyPath).toBe('/editorial-policy');
    });
});

describe('P1 #8 — editorialSchemaFields()', () => {
    it('emits nothing while the reviewer config is null (Organization-only schema)', () => {
        // Default argument reads brand.editorial.reviewer, which is null.
        expect(editorialSchemaFields()).toEqual({});
        expect(editorialSchemaFields(null)).toEqual({});
    });

    it('emits a Person derived from the reviewer object when populated', () => {
        const fields = editorialSchemaFields(SAMPLE_REVIEWER) as {
            reviewedBy?: Record<string, unknown>;
        };
        expect(fields.reviewedBy).toBeDefined();
        expect(fields.reviewedBy).toMatchObject({
            '@type': 'Person',
            name: SAMPLE_REVIEWER.name,
            honorificSuffix: SAMPLE_REVIEWER.credentials,
            jobTitle: SAMPLE_REVIEWER.title,
            url: SAMPLE_REVIEWER.profileUrl,
            identifier: {
                '@type': 'PropertyValue',
                propertyID: 'NPI',
                value: SAMPLE_REVIEWER.npi,
            },
        });
    });

    it('omits optional fields that are not provided (nothing invented)', () => {
        const fields = editorialSchemaFields({
            name: 'Test Reviewer',
            credentials: 'DNP',
        }) as { reviewedBy: Record<string, unknown> };
        expect(fields.reviewedBy).not.toHaveProperty('jobTitle');
        expect(fields.reviewedBy).not.toHaveProperty('url');
        expect(fields.reviewedBy).not.toHaveProperty('identifier');
    });

    it('reviewerDisplayName joins name and credentials', () => {
        expect(reviewerDisplayName(SAMPLE_REVIEWER)).toBe(
            'Test Reviewer, DNP, APRN, FNP-BC',
        );
    });
});

describe('P1 #8 — EditorialByline component source', () => {
    const src = read('components/EditorialByline.tsx');

    it('reads the reviewer from brand.editorial.reviewer (no hardcoded person)', () => {
        expect(src).toContain('brand.editorial.reviewer');
    });

    it('null-reviewer fallback credits the editorial team and links the policy', () => {
        expect(src).toContain('editorial team');
        expect(src).toContain('brand.editorial.policyPath');
    });

    it('has a generated-content branch that claims no human review', () => {
        // The 51-state license guide series is emitted from repo data and no
        // human read it. Claiming "Reviewed by the ... editorial team" on
        // those pages is a false statement about our own process.
        expect(src).toContain('generated');
        expect(src).toContain('not individually');
        expect(src).toMatch(/not individually\s*\n?\s*written or clinically reviewed/);
    });

    it('never asserts review of generated pages', () => {
        // REGRESSION GUARD: the old copy read "Reviewed by the {brand}
        // editorial team" for EVERY null-reviewer post, license guides
        // included. The non-generated branch now claims authorship, not
        // review, and the generated branch disclaims both.
        expect(src).not.toContain('Reviewed by the {brand.name} editorial team');
        expect(src).toContain('Written and maintained by the {brand.name} editorial team');
    });
});

describe('P1 #8 — /editorial-policy page', () => {
    const src = read('app/editorial-policy/page.tsx');
    const text = prose(src);

    it('exists with a canonical and indexable metadata', () => {
        expect(src).toContain('export const metadata');
        expect(src).toContain('${brand.baseUrl}/editorial-policy');
        expect(src).toContain('index: true');
    });

    it('cites statistics exclusively through lib/stats-sources.ts', () => {
        expect(src).toMatch(/from '@\/lib\/stats-sources'/);
        expect(src).toContain('STAT_SOURCES');
        // No hardcoded figures — every number renders from the source file.
        expect(src).not.toMatch(/129,?210/);
        expect(src).not.toContain('90 million');
        expect(src).not.toMatch(/\b45%/);
        expect(src).not.toMatch(/\b27 states/);
    });

    it('review status branches on the reviewer config (honest pending state)', () => {
        expect(src).toContain('brand.editorial.reviewer');
        expect(src).toContain('not yet been clinically reviewed');
    });

    it('scopes the licensure-detail promise to the generated guide series', () => {
        // The license guide series genuinely never quotes fees / CE hours /
        // renewal cycles / processing times (see the truth-rules docblock in
        // lib/blog-license-guides.ts) and answers each with a board link.
        // The promise is pinned to THAT series, not to the whole site.
        expect(text).toContain('state license guide series never quotes them');
        expect(text).toContain('board of nursing');
    });

    it('does NOT claim site-wide that licensure figures are never stated as fact', () => {
        // REGRESSION GUARD. Until 2026-09, components/LicensureChecker.tsx
        // (rendered on /resources and /tools/licensure-checker) printed
        // national exam, DEA, renewal and CE figures, and every metro
        // licensure note quoted a board processing window. A site-wide "never
        // stated as fact" claim was falsifiable by the site's own pages then
        // and would be again the moment any surface quotes such a figure, so
        // the promise stays scoped to the surfaces the policy names, each of
        // which is checked against its source below.
        expect(text).not.toContain('never stated as fact on our pages');
        expect(text).not.toContain('are never stated as fact');
    });

    it('describes the licensure checker as the checker actually is', () => {
        // Pinned against the component, not a remembered state of it. The
        // checker used to print national exam, DEA, renewal and CE figures
        // and a tier-keyed weeks estimate, and the policy disclosed them as
        // orientation figures. The 2026-09 truth cleanup replaced every one
        // with the body that sets it (licensureCostOwners,
        // processingTimeHeadline), so the policy now says that. If figures
        // ever return to the component, the policy must disclose them again.
        const checker = read('components/LicensureChecker.tsx')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        const printsFigures = /\$\s?\d/.test(checker) || /\d+\s*(?:-|to)\s*\d+\s*weeks/i.test(checker);
        expect(text).toContain('licensure checker');
        if (printsFigures) {
            expect(text, 'the checker prints fee or timeline figures; the policy must disclose them').toContain('orientation figures');
        } else {
            expect(text).toContain('it names the body that sets each one instead of quoting a figure');
            expect(text).not.toMatch(/licensure checker lists[^.]*ranges/);
        }
    });

    it('does NOT promise that every statistic on the site carries a source and date', () => {
        // REGRESSION GUARD. The licensure checker's dollar figures carry no
        // source or as-of date. The promise is scoped to the headline stats
        // that flow through lib/stats-sources.ts, which is exactly what the
        // table renders.
        expect(text).not.toContain('Every statistic we publish');
        expect(text).toContain('The headline statistics we publish');
    });

    /*
     * The metro disclosure, pinned against the DATA it describes.
     *
     * The policy used to say the metro market pages "describe a typical board
     * processing window", which was true while every lib/metro-data.ts
     * licensure note quoted one. The 2026-09-26 claim sweep removed those
     * windows along with the cost-of-living and population figures, pay
     * comparisons, rankings and shortage designations, and the policy
     * narrowed to match. A narrow disclosure is only honest while the records
     * stay clean, so the checks below run the policy's promise over every
     * string in lib/metro-data.ts. If a record regains any of these, this
     * fails, and the fix is to widen the policy (or clean the record), never
     * to delete the check: the policy may never promise less than the pages
     * print.
     */
    describe('metro guide disclosure matches lib/metro-data.ts', () => {
        /** Every string a metro record carries, labelled for failures. */
        const metroStrings = (): Array<[string, string]> =>
            METRO_CITIES.flatMap((metro): Array<[string, string]> => [
                [`${metro.slug} hero`, metro.heroDescription],
                [`${metro.slug} cost note`, metro.costOfLivingNote],
                [`${metro.slug} licensure`, metro.licensureNote],
                [`${metro.slug} care demand`, metro.careDemandContext],
                [`${metro.slug} avgCostOfLiving`, metro.avgCostOfLiving],
                [`${metro.slug} population`, metro.population],
                ...metro.whyThisMetro.map((value, i): [string, string] => [`${metro.slug} bullet ${i}`, value]),
                ...metro.subMarkets.flatMap((sub): Array<[string, string]> => [
                    [`${metro.slug} sub-market`, sub.name],
                    [`${metro.slug} sub-market note`, sub.note],
                ]),
                ...metro.faqs.flatMap((faq): Array<[string, string]> => [
                    [`${metro.slug} question`, faq.question],
                    [`${metro.slug} answer`, faq.answer],
                ]),
            ]);

        /** Every sentence of every metro string, labelled. */
        const metroSentences = (): Array<readonly [string, string]> =>
            metroStrings().flatMap(([where, value]) =>
                value.split(/(?<=[.?!])\s+(?=[A-Z])/).map((sentence) => [where, sentence] as const));

        /**
         * A market ranking. A definite article ranks an area or employer first
         * in its market without an -est word: "the center of the city's
         * hiring", "the heart of specialty hiring", "the metro's academic and
         * high-acuity center", "the Valley's inpatient and specialty core",
         * "anchors the region's safety net". The indefinite forms ("a center
         * of", "an academic center for the metro", "a safety-net hospital for
         * the city") make no such claim. The possessive branch allows up to
         * three words before the noun. The first pin in this block proves both
         * directions.
         */
        const MARKET_RANKING = new RegExp([
            String.raw`\b(?:fastest|largest|biggest|highest|lowest|densest|deepest|strongest|best)\b`,
            String.raw`\b(?:one of|among) the \w+est\b`,
            String.raw`\bnumber one\b`,
            String.raw`\bthe only\b`,
            String.raw`\bthe (?:center|heart) of\b`,
            String.raw`\bthe (?:[\w-]+ )?spine\b`,
            String.raw`\bthe (?:metro|metroplex|city|region|state|valley|county|borough)'s (?:[\w-]+ ){0,3}(?:center|anchor|hub|heart|core|spine)\b`,
            String.raw`\banchors? the (?:metro|metroplex|city|region|state|valley|county|borough)'s\b`,
        ].join('|'), 'i');

        /** A sentence that says a named place carries a shortage designation. */
        const SHORTAGE_CLAIM = /\b(?:carry|carries|carrying|hold|holds)\b[^.]{0,80}\b(?:shortage|HPSA)\b|\bfederally designated\b/i;

        /** What the policy says no metro guide quotes. */
        const PROMISED_ABSENT: Array<[string, RegExp]> = [
            ['a board processing time', /\bweeks?\b|\b\d+\s*(?:to|-)\s*\d+\s*(?:business\s+)?(?:days|months)\b/i],
            ['a fee or other dollar figure', /\$\s?\d/],
            ['a cost-of-living figure', /\d\s*(?:%|percent)|\b(?:above|below|near) (?:the )?(?:US|national) average\b|\bcost of living\b/i],
            ['a population figure', /\b\d[\d.,]*\s*[MK]\+?(?=[\s)/,.]|$)|\b(?:million|billion)\b/i],
            ['a pay figure or pay comparison', /\bsalar\w*|\bwages?\b|\bearnings\b|\btake-home\b|\bpurchasing power\b|\b(?:higher|lower|better)[- ]paying\b|\baverage\b/i],
            ['a market ranking', MARKET_RANKING],
            ['a shortage designation claim', SHORTAGE_CLAIM],
        ];

        it('the market-ranking pattern catches the definite forms and spares the indefinite ones', () => {
            // Wording the metro records once published, each a rank with no source.
            const ranked = [
                "Montefiore's home borough and the center of the city's safety-net and community health center hiring.",
                `Vanderbilt's academic campus and the heart of specialty ${brand.niche.short} hiring in Middle Tennessee.`,
                'Grady Health System anchors the region\'s safety net, with high acuity.',
                "The county public system's downtown footprint and the clinics around it form the metro's safety-net core.",
                "The Valley's inpatient and specialty core, including the county safety-net system.",
                "Tampa General and the university campus form the metro's academic and high-acuity center.",
                'The academic spine: NYU Langone, Mount Sinai, and Weill Cornell.',
                'Washington is the only major market split across three jurisdictions.',
            ];
            // Wording that names a place or a role without ranking it.
            const unranked = [
                "Montefiore's home borough, with public hospitals and community health centers across its neighborhoods.",
                `A dense cluster of specialty ${brand.niche.short} roles.`,
                'An academic and high-acuity center for the metro.',
                'Boston Medical Center, a safety-net hospital for the city.',
                'Atrium Health and Novant Health run large hospital networks across the metro.',
                "Nashville General Hospital is part of the city's safety-net and health-equity work.",
            ];
            for (const sample of ranked) expect(sample, sample).toMatch(MARKET_RANKING);
            for (const sample of unranked) expect(sample, sample).not.toMatch(MARKET_RANKING);
        });

        it('describes the metro guides as they now are, not as they were', () => {
            expect(text).toContain('metro market pages');
            expect(text).not.toContain('typical board processing window');
            expect(text).toContain('no board processing times, fees, cost-of-living or population figures, pay figures, or market rankings');
            // Each HRSA tool is named for what it searches: HPSA Find takes a
            // location or HPSA ID and has no street-address search, so the
            // address goes to "Find Shortage Areas by Address".
            expect(text).toContain('check the street address with HRSA&apos;s Find Shortage Areas by Address tool and the county in HPSA Find');
            expect(text).not.toMatch(/address (?:in|into|with) HRSA&apos;s HPSA Find/);
        });

        it.each(PROMISED_ABSENT)('no metro record quotes %s', (_label, pattern) => {
            for (const [where, value] of metroStrings()) {
                expect(value, `${where}: ${value}`).not.toMatch(pattern);
            }
        });

        it('carries no cost-of-living or population figure in the data fields either', () => {
            // No page renders these fields; the records stopped carrying them,
            // so no future surface can print one by accident.
            for (const metro of METRO_CITIES) {
                expect(metro.avgCostOfLiving, metro.slug).toBe('');
                expect(metro.population, metro.slug).toBe('');
            }
        });

        it('mentions a shortage designation only as a condition, never as a fact about a place', () => {
            // The policy says the guides "do not say which areas hold a federal
            // shortage designation". Indicative wording ("roles qualify through
            // the site's shortage designation") slips past the carry/hold
            // pattern, so every sentence that names a designation in a shortage
            // or loan repayment context must frame it as the open question it
            // is: "whether", or "depends". Virginia's license designation, a
            // licensing term, is not a shortage designation and is exempt.
            const designationSentences = metroSentences().filter(([, sentence]) =>
                /designat/i.test(sentence) && /shortage|HPSA|loan repayment/i.test(sentence));
            expect(designationSentences.length, 'no metro sentence names a shortage designation; this pin went vacuous').toBeGreaterThan(0);
            for (const [where, sentence] of designationSentences) {
                expect(sentence, `${where}: ${sentence}`).toMatch(/\b(?:whether|depends?)\b/i);
            }
        });

        it('sends every shortage-area loan repayment answer to both HRSA tools and the employer', () => {
            const answers = METRO_CITIES.flatMap((metro) => metro.faqs.map((faq) => [metro.slug, faq.answer] as const));
            const shortageAnswers = answers.filter(([, answer]) => /shortage area|HPSA/i.test(answer));
            expect(shortageAnswers.length).toBeGreaterThanOrEqual(4);
            for (const [slug, answer] of shortageAnswers) {
                expect(answer, slug).toContain('Find Shortage Areas by Address');
                expect(answer, slug).toContain('HPSA Find');
                expect(answer, slug).toMatch(/\bemployer\b/);
            }
        });

        it('sends the street address to the HRSA tool that searches by address', () => {
            // REGRESSION GUARD. HPSA Find searches by location or HPSA ID; it
            // has no street-address search. A draft told readers to enter a
            // clinic's address in HPSA Find, which cannot work, so every
            // sentence that names HPSA Find must send the address elsewhere.
            const hpsaFindSentences = metroSentences().filter(([, sentence]) => sentence.includes('HPSA Find'));
            expect(hpsaFindSentences.length, 'no metro sentence names HPSA Find; this pin went vacuous').toBeGreaterThanOrEqual(4);
            for (const [where, sentence] of hpsaFindSentences) {
                expect(sentence, `${where}: ${sentence}`).toContain('Find Shortage Areas by Address');
                expect(sentence, `${where}: ${sentence}`).not.toMatch(/address (?:in|into|with) HRSA's HPSA Find/);
            }
        });

        it('conditions every FAQ pointer at a local median on enough posted pay', () => {
            // REGRESSION GUARD. The metro pay card has three branches (policy
            // note 2 in lib/metro-data.ts): the gated local median; below the
            // gate, when at least one posting states pay, the cited BLS
            // national median; and nothing when none does. An FAQ answer is
            // fixed text, so it must be true on all three. A revision told
            // readers that any median on the page was computed from local
            // listings ("not from a national survey") while the below-gate
            // branch printed the BLS survey median on the same page, in the
            // accordion and in FAQPage JSON-LD.
            const medianAnswers = METRO_CITIES.flatMap((metro) =>
                metro.faqs
                    .filter((faq) => /\bmedian\b/.test(faq.answer))
                    .map((faq) => [metro.slug, faq.answer] as const));
            // Every guide answers a pay question, so the pointer is pinned on all twenty.
            expect(new Set(medianAnswers.map(([slug]) => slug)).size).toBe(METRO_CITIES.length);
            for (const [slug, answer] of medianAnswers) {
                expect(answer, `${slug}: ${answer}`).toMatch(/\benough\b[^.;]*\blistings\b[^.;]*\benough employers\b/);
                expect(answer, `${slug}: ${answer}`).not.toMatch(/(?:not|rather than) from a (?:national )?survey/i);
                // Names the national figure for what it is, the cited BLS reference.
                expect(answer, `${slug}: ${answer}`).toMatch(/\bnational median\b[^.]*\bBLS\b/);
            }
            // The policy describes the same below-gate reference, so the two
            // owned surfaces can never contradict each other. It names the
            // middle branch only: with no listing stating pay,
            // postedPaySentence returns null and the page shows no pay figure
            // at all, so "too few" (which includes zero) would be wrong there.
            expect(text).toContain('when enough listings from enough employers state pay, a posted-pay median');
            expect(text).toContain('the cited national median from the table above, shown as a reference point when some local listings state pay but too few for a local median');
            expect(text).not.toContain('when too few local listings state pay');
        });

        it('names every rule the guides cite beyond the practice-authority entries', () => {
            // The guides restate lib/state-practice-authority.ts, plus two
            // primary sources read at the source, plus the Nurse Licensure
            // Compact roster that lib/blog-license-guides.ts verifies against
            // NCSBN. If a guide cites one, the policy must say so. (A source
            // the policy names but the guides stop citing is harmless; a cited
            // source the policy omits is not.)
            const all = metroStrings().map(([, value]) => value).join('\n');
            if (/Chapter \d+ of the Acts of/.test(all)) {
                expect(text).toContain('the Massachusetts law that sets its transition to full practice authority');
            }
            if (/federal regulation lets VA grant full practice authority/.test(all)) {
                expect(text).toContain('the federal regulation on full practice authority at VA facilities');
            }
            if (/multistate nursing licenses/.test(all)) {
                expect(text).toContain('Nurse Licensure Compact roster');
            }
            if (/covers RN and LPN licenses only/.test(all)) {
                expect(text).toContain('it covers RN and LPN licenses, never APRN licenses');
            }
            expect(text).toContain('the hour and year thresholds some states set');
        });
    });

    it('describes the license guide series as generated, not hand-written', () => {
        // 51 guides are emitted from repo data by lib/blog-license-guides.ts
        // and LICENSE_GUIDE_SERIES_PUBLISHED is true, so they are live. The
        // policy page must not imply a human wrote each one.
        expect(text).toContain('generated programmatically');
        expect(text).toContain('generated-content byline');
    });

    it('correction contact derives from brand config', () => {
        expect(src).toContain('brand.email.contact');
    });
});

describe('P1 #8 — blog template wiring', () => {
    const src = read('app/blog/[slug]/page.tsx');

    it('renders the visible byline in the hero and the author card', () => {
        const matches = src.match(/<EditorialByline/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('passes the generated flag on EVERY byline it renders', () => {
        // Both byline sites must mark license-guide posts as generated —
        // a byline that claims review in the hero and disclaims it in the
        // author card (or vice versa) is worse than either alone.
        const sites = src.match(/<EditorialByline[^/]*\/>/g) ?? [];
        expect(sites.length).toBeGreaterThanOrEqual(2);
        for (const site of sites) {
            expect(site).toContain('generated={Boolean(licenseSlugMatch)}');
        }
    });

    it('derives the generated flag from the license-guide slug regex', () => {
        expect(src).toContain('LICENSE_GUIDE_SLUG_REGEX');
        expect(src).toMatch(/licenseSlugMatch\s*=\s*slug\.match\(LICENSE_GUIDE_SLUG_REGEX\)/);
    });

    it('spreads editorialSchemaFields() into the BlogPosting JSON-LD', () => {
        expect(src).toContain('...editorialSchemaFields(),');
        expect(src).toMatch(/from '@\/components\/EditorialByline'/);
    });

    it('keeps Organization authorship inline (no fabricated Person in this file)', () => {
        expect(src).toMatch(/author:\s*\{\s*'@type':\s*'Organization'/);
        expect(src).not.toContain("'@type': 'Person'");
    });

    it('escapes serialized JSON-LD with the repo chain', () => {
        // The page source spells the escape as '\\u003c' (escaped backslash
        // in its raw bytes), so the expectation doubles it again here.
        expect(src).toContain(".replace(/</g, '\\\\u003c')");
        // All four schema scripts route through the escaping serializer.
        expect(src).not.toMatch(/__html:\s*JSON\.stringify\(/);
    });

    it('links the editorial policy from the author card', () => {
        expect(src).toContain('href="/editorial-policy"');
    });
});
