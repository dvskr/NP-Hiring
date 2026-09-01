/**
 * P2 #10 + #22 — salary-band consolidation and /resources guide accuracy.
 *
 * #10: pay RANGES were hand-typed per page and disagreed with each other
 * (the remote-NP band alone shipped three different ways). SALARY_BANDS in
 * lib/stats-sources.ts is the single source, DERIVED from
 * config/niche/salary.ts — the same bands the ingest pipeline validates
 * postings against — so a migrated surface can never advertise pay the
 * pipeline would reject. The migration is NOT complete: see the
 * UNMIGRATED_SALARY_BAND_SURFACES ratchet below, which pins the remaining
 * debt so the constant's existence is never mistaken for its adoption.
 * The two open TODO(verify) markers were resolved by deleting the
 * unverifiable claims they carried rather than promoting them.
 *
 * #22: the 1099 guide was titled 2026 while printing 2024-cycle IRS
 * figures (a "$66,000/year in 2024" SEP cap that was actually the 2023
 * cap, a "$23,000 / $69,000" solo-401(k) stack, a "$7,000/year" IRA limit,
 * a "$0.67/mile for 2024" rate). The FPA guide asserted a "+12-15% salary
 * premium", "2-3x more private practice owners", and "41 states are NLC
 * members" with nothing behind any of them. The private-practice guide
 * said "34 Full Practice Authority states + DC" — the repo's own dataset
 * says 27 + DC.
 *
 * SECOND PASS (review follow-up), all covered below:
 *   - The "+12-15%" FPA premium was removed from /resources/fpa-guide but
 *     stayed published on /salary-guide and in the generated PDF, where a
 *     P1 parity test actively REQUIRED it. All five locations are now
 *     asserted absent.
 *   - The 1099 comparison table added a deferred employer 401(k) match
 *     into a row labelled "Cash before income tax", which is what inflated
 *     the headline break-even from 25% to 30%.
 *   - `citedValue()` / `bandWithBasis()` were helper-shaped no-ops with
 *     zero production call sites; the isEstimate hedge now lives in data.
 *   - The FPA guide's derived NLC member count was self-consistent but
 *     externally wrong; the page publishes no count at all now.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { STAT_SOURCES, SALARY_BANDS, type StatSource } from '@/lib/stats-sources';
import { salaryConfig } from '@/config/niche/salary';
import { getStatesByAuthority } from '@/lib/state-practice-authority';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Collapse whitespace so source assertions survive reformatting. */
const flat = (s: string) => s.replace(/\s+/g, ' ');

/**
 * Strip comments before asserting a figure is unpublished. A comment that
 * NAMES the fabricated figure it removed is documentation worth keeping —
 * it is what stops the next editor from reinstating it — so the "is this
 * still published?" scans must look at code and copy only. `://` is
 * excluded so URLs survive the line-comment rule.
 */
const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const GUIDE_1099 = 'app/resources/1099-vs-w2/page.tsx';
const GUIDE_FPA = 'app/resources/fpa-guide/page.tsx';
const GUIDE_PP = 'app/resources/private-practice-guide/page.tsx';
const STATS_SOURCE = 'lib/stats-sources.ts';
const SALARY_HUB = 'app/salary-guide/page.tsx';
const SALARY_PDF = 'scripts/generate-salary-pdf.ts';

describe('P2 #10 — SALARY_BANDS is the single source for published pay ranges', () => {
    it('every band derives from config/niche/salary.ts, not a typed literal', () => {
        expect(SALARY_BANDS.typicalW2Annual.min).toBe(salaryConfig.normalizer.typical.min);
        expect(SALARY_BANDS.typicalW2Annual.max).toBe(salaryConfig.normalizer.typical.max);
        expect(SALARY_BANDS.contractorHourly.min).toBe(salaryConfig.normalizer.contractorHourlyMin);
        expect(SALARY_BANDS.contractorHourly.max).toBe(salaryConfig.normalizer.contractorHourlyMax);
        expect(SALARY_BANDS.w2AnnualAccepted.min).toBe(salaryConfig.normalizer.annualMin);
        expect(SALARY_BANDS.w2AnnualAccepted.max).toBe(salaryConfig.normalizer.annualMax);
    });

    it('the hourly W-2 band is the annual band at the configured hours/year', () => {
        expect(SALARY_BANDS.typicalW2Hourly.min).toBeCloseTo(
            salaryConfig.normalizer.typical.min / salaryConfig.hoursPerYear,
            6,
        );
        expect(SALARY_BANDS.typicalW2Hourly.max).toBeCloseTo(
            salaryConfig.normalizer.typical.max / salaryConfig.hoursPerYear,
            6,
        );
    });

    it('no published band can claim pay the ingest pipeline would reject', () => {
        for (const band of Object.values(SALARY_BANDS)) {
            expect(band.min).toBeLessThan(band.max);
        }
        expect(SALARY_BANDS.typicalW2Annual.min).toBeGreaterThanOrEqual(SALARY_BANDS.w2AnnualAccepted.min);
        expect(SALARY_BANDS.typicalW2Annual.max).toBeLessThanOrEqual(SALARY_BANDS.w2AnnualAccepted.max);
    });

    it('every band carries a basis string so a validation range never reads as a wage survey', () => {
        for (const [key, band] of Object.entries(SALARY_BANDS)) {
            expect(band.basis.length, `${key} needs a basis`).toBeGreaterThan(20);
            expect(band.formatted.length, `${key} needs a formatted band`).toBeGreaterThan(0);
        }
    });
});

/* ─────────────────────────────────────────────────────────────────────────
 * P2 #10 — MIGRATION-DEBT RATCHET
 * ─────────────────────────────────────────────────────────────────────────
 * Review finding: SALARY_BANDS had exactly ONE consumer, so none of the
 * contradictions it was created to fix were actually fixed — while the
 * file's own header claimed ranges "now derive" from config/niche/salary.ts.
 * Creating a constant is not a migration. These are the surfaces that still
 * print hand-typed annual bands. The list may only SHRINK: migrate a
 * surface onto SALARY_BANDS, then delete its entry here.
 * ────────────────────────────────────────────────────────────────────────*/
const UNMIGRATED_SALARY_BAND_SURFACES: readonly string[] = [
    'app/api/og/city/route.tsx',
    'app/jobs/city/[slug]/page.tsx',
    'app/jobs/community-health/page.tsx',
    'app/jobs/correctional/page.tsx',
    'app/jobs/entry-level/page.tsx',
    'app/jobs/full-time/page.tsx',
    'app/jobs/geriatric/page.tsx',
    'app/jobs/hospital/page.tsx',
    'app/jobs/mid-career/page.tsx',
    'app/jobs/new-grad/page.tsx',
    'app/jobs/outpatient/page.tsx',
    'app/jobs/part-time/page.tsx',
    'app/jobs/private-practice/page.tsx',
    'app/jobs/remote/page.tsx',
    'app/jobs/senior/page.tsx',
    'app/jobs/telehealth/page.tsx',
    'app/salary-guide/page.tsx',
    'app/salary-guide/specialty/specialty-content.ts',
    'components/HomepageFAQ.tsx',
    'lib/blog-formatter.ts',
    'lib/pseo/category-city-template.tsx',
    'lib/pseo/category-faq-data.ts',
    'lib/pseo/category-landing-content.ts',
    'lib/pseo/city-narrative.ts',
    'lib/pseo/setting-state-config.ts',
    'lib/pseo/setting-state-template.tsx',
    'lib/pseo/state-narrative.ts',
    'scripts/generate-salary-pdf.ts',
];

/**
 * Files the scan flags but which publish nothing: lib/stats-sources.ts
 * describes the bad bands in its own documentation, and these two carry
 * salary-shaped strings as parser comments / an LLM prompt example.
 */
const SCAN_EXEMPT: readonly string[] = [
    'lib/stats-sources.ts',
    'lib/job-normalizer.ts',
    'app/api/autofill/classify-fields/route.ts',
];

function filesPrintingHandTypedBands(): string[] {
    const dirs = ['app', 'lib', 'components', 'config', 'scripts'];
    // "$95K-$160K" / "$95K–140K" / "$150,000 - $180,000", both bounds
    // salary-shaped so bonus and insurance-limit ranges do not match.
    const patterns = [
        /\$(\d{2,3})K?\s*(?:-|–|—|\s+to\s+)\s*\$?(\d{2,3})K/g,
        /\$(\d{2,3}),000\s*(?:-|–|—|\s+to\s+)\s*\$?(\d{2,3}),000/g,
    ];
    const salaryShaped = (n: number) => n >= 50 && n <= 500;

    const walk = function* (dir: string): Generator<string> {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.next') continue;
                yield* walk(full);
            } else if (/\.(ts|tsx)$/.test(entry.name)) {
                yield full;
            }
        }
    };

    const hits: string[] = [];
    for (const dir of dirs) {
        for (const file of walk(path.join(ROOT, dir))) {
            const src = fs.readFileSync(file, 'utf8');
            const matched = patterns.some((re) => {
                re.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = re.exec(src))) {
                    const lo = Number(m[1]);
                    const hi = Number(m[2]);
                    if (salaryShaped(lo) && salaryShaped(hi) && lo < hi) return true;
                }
                return false;
            });
            if (matched) hits.push(path.relative(ROOT, file).split(path.sep).join('/'));
        }
    }
    return hits.filter((f) => !SCAN_EXEMPT.includes(f)).sort();
}

describe('P2 #10 — the band migration is pinned as debt, not claimed as done', () => {
    const src = read(STATS_SOURCE);

    it('lib/stats-sources.ts does not claim the consolidation already happened', () => {
        // The original header sentence. Restoring it without migrating the
        // surfaces below re-publishes a false status claim.
        expect(flat(src)).not.toContain(
            'Ranges now derive from config/niche/salary.ts, the same file the ingest pipeline validates against, so a published band can never claim something the pipeline would reject.',
        );
        expect(src).toContain('UNMIGRATED_SALARY_BAND_SURFACES');
        expect(src).toContain('MIGRATION STATUS');
    });

    it('the ratchet list matches reality — no surface silently added or dropped', () => {
        expect(filesPrintingHandTypedBands()).toEqual([...UNMIGRATED_SALARY_BAND_SURFACES].sort());
    });

    it('the debt is real and large, so nothing reads this as a finished migration', () => {
        expect(UNMIGRATED_SALARY_BAND_SURFACES.length).toBeGreaterThan(20);
    });

    it('the one migrated surface stays migrated', () => {
        expect(UNMIGRATED_SALARY_BAND_SURFACES).not.toContain(GUIDE_1099);
        const guide = read(GUIDE_1099);
        expect(guide).toContain("from '@/lib/stats-sources'");
        expect(guide).toContain('SALARY_BANDS.contractorHourly');
    });
});

describe('P2 #10 — the two TODO(verify) markers are resolved, not carried', () => {
    const src = read(STATS_SOURCE);

    it('no TODO(verify) marker remains in the stats source of truth', () => {
        expect(src).not.toContain('TODO(verify)');
    });

    it('the unverifiable figures those markers asserted are gone', () => {
        // The speculative newer projection cycle and the speculative HRSA
        // range were both stated as fact inside comments that nothing in
        // this repo could check.
        expect(src).not.toContain('~46%');
        expect(src).not.toContain('90–100M+');
    });

    it('each stat records what a vintage refresh actually requires', () => {
        for (const [key, stat] of Object.entries(STAT_SOURCES)) {
            expect(stat.vintageNote, `${key} needs a vintageNote`).toBeTruthy();
            expect(stat.sourceUrl).toMatch(/^https:\/\//);
        }
    });

    it('the OEWS vintage was left at the newest release the repo holds', () => {
        // Documented, not silently bumped to an invented newer vintage.
        expect(STAT_SOURCES.averageSalary.asOf).toBe('2024-05');
        expect(STAT_SOURCES.averageSalary.source).toContain('May 2024');
    });

    it('every stat whose sourceUrl is a moving "current" link documents the drift', () => {
        // Review finding: blsGrowth2034 documented that its OOH link always
        // shows the LATEST cycle, but averageSalary carried the identical
        // hazard (bls.gov/oes/CURRENT/) with no mention of it — so the
        // citation can silently start naming a vintage the link no longer
        // shows.
        for (const [key, stat] of Object.entries(STAT_SOURCES)) {
            if (!/\/current\//i.test(stat.sourceUrl)) continue;
            expect(
                stat.vintageNote,
                `${key} links a moving "current" URL and must document the drift`,
            ).toMatch(/drift|latest|repoint/i);
        }
        // Guard the guard: averageSalary must actually be one of them.
        expect(STAT_SOURCES.averageSalary.sourceUrl).toContain('/current/');
    });

    it('the growth stat names its projection cycle wherever it renders', () => {
        expect(STAT_SOURCES.blsGrowth2034.source).toContain('2024–2034');
    });
});

describe('P2 #10 — the isEstimate hedge is enforced in DATA, not in a helper nobody calls', () => {
    const src = read(STATS_SOURCE);

    it('the helper-shaped no-ops are gone', () => {
        // Review finding: both existed solely to be asserted by this file.
        // A hedge a surface must remember to opt into is not a hedge.
        expect(src).not.toContain('export function citedValue');
        expect(src).not.toContain('export function bandWithBasis');
    });

    it('an estimate carries its hedge inside `formatted`, which every surface renders', () => {
        // `as const satisfies` narrows each entry to its literal shape, so
        // the optional flag has to be read through the interface.
        const entries = Object.entries(STAT_SOURCES) as [string, StatSource][];
        for (const [key, stat] of entries) {
            if (!stat.isEstimate) continue;
            expect(
                /\+|~|approximately|about|over|more than/i.test(stat.formatted),
                `${key} is an estimate but ${JSON.stringify(stat.formatted)} reads as a point value`,
            ).toBe(true);
        }
        expect(STAT_SOURCES.hrsaShortagePopulation.isEstimate).toBe(true);
        expect(STAT_SOURCES.hrsaShortagePopulation.formatted).toBe('90 million+');
    });

    it('a non-estimate is never hedged, so the flag stays meaningful', () => {
        expect((STAT_SOURCES.averageSalary as StatSource).isEstimate).toBeUndefined();
        expect(STAT_SOURCES.averageSalary.formatted).not.toMatch(/\+|~|approximately/);
    });

    it('the surfaces that render these stats render `formatted`, inheriting the hedge', () => {
        for (const surface of ['app/editorial-policy/page.tsx', 'app/press/page.tsx']) {
            const s = read(surface);
            expect(s, `${surface} should render the hedged display value`).toContain('stat.formatted');
            // Never the raw numeric, which carries no hedge at all.
            expect(s, `${surface} must not render the unhedged raw value`).not.toContain('stat.value');
        }
    });
});

describe('P2 #22 — the 1099 guide prints no year-specific IRS dollar figure', () => {
    const src = read(GUIDE_1099);

    it('the stale 2024-cycle retirement and mileage figures are gone', () => {
        for (const stale of ['$66,000', '$66K', '$69,000', '$23,000', '$7,000', '$0.67']) {
            expect(src, `stale IRS figure still on the page: ${stale}`).not.toContain(stale);
        }
        expect(src).not.toContain('in 2024');
        expect(src).not.toContain('for 2024');
    });

    it('it explains the indexed limits instead, and points at the IRS', () => {
        expect(src).toContain('indexed');
        expect(src).toContain('Publication 560');
    });

    it('the statutory rates it does print are the un-indexed ones', () => {
        // 15.3% SE tax, 92.35% SE base factor, 7.65% employee FICA, and the
        // statutory 0.9% Additional Medicare thresholds.
        expect(src).toContain('const SE_TAX_RATE = 0.153');
        expect(src).toContain('const SE_BASE_FACTOR = 0.9235');
        expect(src).toContain('const FICA_EMPLOYEE_RATE = 0.0765');
        expect(src).toContain('$200,000 (single)');
        expect(src).toContain('$250,000 (married filing jointly)');
    });

    it('rate bands come from SALARY_BANDS, not from invented literals', () => {
        expect(src).toContain("from '@/lib/stats-sources'");
        expect(src).toContain('SALARY_BANDS.contractorHourly');
        expect(src).toContain('SALARY_BANDS.typicalW2Annual');
        // The invented bands the page used to publish.
        expect(src).not.toContain('$75-$150');
        expect(src).not.toContain('$55-$100');
    });

    it('the comparison table is computed, not typed', () => {
        // The old table's fabricated outputs.
        for (const fabricated of ['-$28,300', '-$30,500', '-$37,700', '~$133,000', '~$119,500']) {
            expect(src, `fabricated table figure still present: ${fabricated}`).not.toContain(fabricated);
        }
        expect(src).toContain('const w2CashBeforeIncomeTax');
        expect(src).toContain('const contractCashBeforeIncomeTax');
        expect(src).toContain('const contractBreakEvenGross');
    });

    it('states its assumptions visibly, including that income tax is excluded', () => {
        expect(src).toContain('What this example assumes');
        expect(src).toContain('income tax are excluded from both columns');
    });
});

describe('P2 #22 — the "Cash before income tax" row contains only cash', () => {
    const src = read(GUIDE_1099);
    const compact = flat(src);

    it('the cash subtotal excludes the deferred employer 401(k) match', () => {
        // Review finding: the match was summed into the row LABELLED "Cash
        // before income tax" while the contractor column carried no
        // retirement contribution at all — the same class of error as the
        // old table's "+$12,300 PTO value" line, and worth ~5 points of the
        // headline break-even.
        expect(compact).toContain(
            'const w2CashBeforeIncomeTax = EXAMPLE.w2Salary - w2Fica - EXAMPLE.w2PremiumShare;',
        );
        expect(compact).toContain(
            'const w2TotalValueBeforeIncomeTax = w2CashBeforeIncomeTax + w2Match;',
        );
    });

    it('the match is disclosed on its own row and rolls into a separate total', () => {
        expect(src).toContain('Cash before income tax');
        expect(src).toContain('Total value before income tax');
        expect(src).toContain('Deferred, not cash');
        expect(src).toContain('w2TotalValueBeforeIncomeTax');
    });

    it('both break-evens are published, and the cash one leads', () => {
        expect(src).toContain('const contractBreakEvenGross = breakEvenGrossFor(w2CashBeforeIncomeTax)');
        expect(src).toContain(
            'const contractBreakEvenGrossWithMatch = breakEvenGrossFor(w2TotalValueBeforeIncomeTax)',
        );
    });

    /**
     * REVIEW FOLLOW-UP — this assertion was too weak to be worth having.
     *
     * It pinned the absence of one exact OLD sentence ("not the 20–25% most
     * rate negotiations settle for"). The rewrite kept the same unsourced
     * market statistic and merely rephrased it to "That is the honest
     * reading of the 20–25% premium most rate negotiations settle for" — so
     * the test passed while the claim was still published, and the figure
     * READ as remediated when it had only moved. On a page whose stated
     * rule is that unsourced figures are deleted, that is the worst
     * possible outcome.
     *
     * The assertion now pins the CLAIM, not a phrasing: no statement about
     * what the wider market settles for, in any wording, and no bare
     * "20-25%" premium figure. The only premium percentages the page may
     * publish are the two it computes from EXAMPLE.
     */
    it('publishes no claim about what "most rate negotiations" settle for', () => {
        const code = stripComments(src);
        expect(code).not.toMatch(/rate negotiations/i);
        expect(code).not.toMatch(/most negotiations/i);
        // Any 20–25% / 20-25% premium literal, in either dash form.
        expect(code).not.toMatch(/20\s*[-–—]\s*25\s*%/);
    });

    it('every premium percentage on the page is computed from EXAMPLE, not typed', () => {
        const code = stripComments(src);
        // The two sanctioned figures are interpolations, not literals.
        expect(code).toContain('{contractPremiumNeededPct}%');
        expect(code).toContain('{contractPremiumNeededWithMatchPct}%');
        // And the surviving prose says what the premium buys rather than
        // appealing to an unnamed market consensus.
        expect(code).toContain(
            'That premium buys cash parity and nothing more: it is the employer&apos;s cost stack priced back in, not a raise.',
        );
    });
});

/* ─────────────────────────────────────────────────────────────────────────
 * REVIEW FOLLOW-UP — the 1099 page's central comparison must not contradict
 * its own evidence.
 * ─────────────────────────────────────────────────────────────────────────
 * The 1099 card carried a bullet reading "Higher headline rate: contract
 * postings here validate in a $40-$350/hr band" while the W-2 card two
 * bullets away printed "$110K-$170K typical band = $53-$82/hr". The
 * contract FLOOR ($40) is 25% BELOW the W-2 floor ($53), so the cited band
 * refuted the bullet it was cited under, and the FAQ repeated it as "the
 * headline gap is real".
 *
 * Root cause: SALARY_BANDS.contractorHourly is the ALL-SPECIALTY ingest
 * envelope — config/niche/salary.ts sets its $350 ceiling from CRNA work
 * and notes the narrower "locum NP commonly $60–150/hr". An envelope is not
 * a floor, and a wider band is not a higher rate.
 * ────────────────────────────────────────────────────────────────────────*/
describe('P2 #22 (follow-up) — the 1099/W-2 rate comparison is not self-contradicting', () => {
    const src = read(GUIDE_1099);
    const code = stripComments(src);

    it('the numbers are what the review said they are', () => {
        // Guards the premise: if the config is retuned so the contract floor
        // rises above the W-2 floor, this test should be revisited, not the
        // copy silently reverted.
        expect(SALARY_BANDS.contractorHourly.min).toBe(40);
        expect(SALARY_BANDS.contractorHourly.max).toBe(350);
        expect(SALARY_BANDS.typicalW2Hourly.min).toBeCloseTo(52.88, 2);
        expect(
            SALARY_BANDS.contractorHourly.min,
            'contract floor is BELOW the W-2 floor — no copy may call it higher',
        ).toBeLessThan(SALARY_BANDS.typicalW2Hourly.min);
    });

    it('no bullet or answer calls the contract band a higher rate', () => {
        expect(code).not.toContain('Higher headline rate');
        expect(code).not.toContain('Lower headline rate');
        expect(code).not.toContain('headline gap is real');
        expect(code).not.toMatch(/pays a higher headline rate/);
    });

    it('the comparison cards state mechanisms, not a rate ranking', () => {
        expect(code).toContain('You price the work');
        expect(code).toContain('Pay is set inside a band');
    });

    it('the bands are published once, together, with their non-comparability stated', () => {
        expect(flat(code)).toContain('<strong>They are not comparable end to end.</strong>');
        expect(code).toContain('a wider envelope is not a higher rate');
        // Both bases still render, so neither band can be read as a survey.
        expect(code).toContain('{CONTRACT_HOURLY.basis}');
        expect(code).toContain('{W2_ANNUAL.basis}');
    });

    it('the FAQ answer routes the comparison to the computed example', () => {
        expect(code).toContain('that is an ingest envelope, not a contract floor');
        expect(code).toContain('${contractPremiumNeededPct}% more gross');
    });
});

describe('P2 #22 — the 1099 guide arithmetic is internally correct', () => {
    // Recomputed independently of the page so a typo in either one fails.
    const w2Salary = 160_000;
    const contractGross = 200_000;
    const otherExpenses = 15_000;
    const malpractice = 2_500;
    const health = 12_000;
    const w2Premium = 3_000;
    const w2MatchRate = 0.04;
    const seEffective = 0.153 * 0.9235;

    const w2Cash = w2Salary - w2Salary * 0.0765 - w2Premium;
    const w2Match = w2Salary * w2MatchRate;
    const w2TotalValue = w2Cash + w2Match;
    const breakEvenFor = (target: number) =>
        (target + health) / (1 - seEffective) + otherExpenses + malpractice;

    it('self-employment tax applies to net profit, not gross receipts', () => {
        const netProfit = contractGross - otherExpenses - malpractice;
        expect(netProfit).toBe(182_500);
        expect(netProfit * seEffective).toBeCloseTo(25_786.43, 1);
    });

    it('health premiums do NOT reduce the self-employment tax base', () => {
        // The old table folded health insurance into the same bucket as
        // Schedule C spend; it is an above-the-line income-tax deduction.
        const withHealthWronglyDeducted =
            (contractGross - otherExpenses - malpractice - health) * seEffective;
        const correct = (contractGross - otherExpenses - malpractice) * seEffective;
        expect(correct).toBeGreaterThan(withHealthWronglyDeducted);
    });

    it('the W-2 cash subtotal is salary less FICA and premium share — no match', () => {
        expect(w2Cash).toBe(144_760);
        expect(w2Match).toBe(6_400);
        expect(w2TotalValue).toBe(151_160);
    });

    it('cash parity needs about 25% more gross, and the page must say so', () => {
        const cashBreakEven = breakEvenFor(w2Cash);
        expect(cashBreakEven).toBeCloseTo(200_053.9, 0);
        expect(Math.round((cashBreakEven / w2Salary - 1) * 100)).toBe(25);
    });

    it('replacing the match too needs about 30% — the page\'s old headline', () => {
        const totalBreakEven = breakEvenFor(w2TotalValue);
        expect(totalBreakEven).toBeCloseTo(207_507.2, 0);
        expect(Math.round((totalBreakEven / w2Salary - 1) * 100)).toBe(30);
    });

    it('the two break-evens differ by exactly the grossed-up match', () => {
        // Proves the 5-point spread was entirely the mislabelled row.
        const delta = breakEvenFor(w2TotalValue) - breakEvenFor(w2Cash);
        expect(delta).toBeCloseTo(w2Match / (1 - seEffective), 6);
    });

    it('at the example gross the contractor is already near cash parity', () => {
        const contractCash =
            (contractGross - otherExpenses - malpractice) * (1 - seEffective) - health;
        expect(contractCash).toBeCloseTo(144_713.57, 1);
        expect(Math.abs(contractCash - w2Cash)).toBeLessThan(100);
    });
});

describe('P2 #22 — unsourced FPA claims are removed or tied to repo data', () => {
    const fpa = read(GUIDE_FPA);
    const pp = read(GUIDE_PP);

    it('the invented FPA salary premium is gone from copy and metadata', () => {
        expect(fpa).not.toContain('12-15%');
        expect(fpa).not.toContain('2-3x');
        expect(fpa).not.toContain('more job openings per capita');
    });

    it('the FPA count claim rides the AANP-sourced dataset', () => {
        expect(fpa).toContain('STAT_SOURCES.fullPracticeStates');
        const derived = getStatesByAuthority('full').filter((s) => s !== 'District of Columbia').length;
        expect(String(derived)).toBe(STAT_SOURCES.fullPracticeStates.value);
    });

    it('the private-practice guide no longer claims 34 FPA states', () => {
        expect(pp).not.toContain('34 Full Practice Authority');
        expect(pp).not.toContain('34 states');
        expect(pp).toContain('FULL_PRACTICE_STATE_COUNT');
    });
});

describe('P2 #22 — the FPA guide publishes no NLC membership count', () => {
    const raw = read(GUIDE_FPA);
    const fpa = stripComments(raw);

    it('the typed "41 states" and the derived "38" are both gone', () => {
        // Review finding: replacing the typed literal with a count derived
        // from LICENSE_GUIDE_NLC_NON_MEMBERS made the claim self-consistent
        // without making it true — and a derived number reads MORE
        // authoritative. Verified against the NLC's own site on 2026-07-29:
        // 43 member jurisdictions (41 states), and the repo's non-member set
        // omits Alaska while wrongly listing Connecticut, Massachusetts,
        // Rhode Island, and Washington.
        expect(fpa).not.toContain('41 states');
        expect(fpa).not.toContain('38 states');
        expect(fpa).not.toContain('NLC_MEMBER_STATE_COUNT');
        expect(fpa).not.toContain('states are compact members');
    });

    it('it does not depend on the compact dataset it cannot vouch for', () => {
        expect(fpa).not.toContain('LICENSE_GUIDE_NLC_NON_MEMBERS');
    });

    it('it explains the mechanic and hands the reader the live roster instead', () => {
        expect(raw).toContain('NLC_MAP_URL');
        expect(raw).toContain('https://www.nursecompact.com/');
        expect(raw).toContain('NCSBN compact map');
        // The genuinely useful, verifiable part of the answer survives.
        expect(raw).toContain('not the APRN license itself');
    });
});

describe('P2 #22 — the private-practice revenue table is a computed model', () => {
    const src = read(GUIDE_PP);

    it('the previously uncomputed bands are gone', () => {
        for (const fabricated of [
            '$100,000-$130,000',
            '$200,000-$280,000',
            '$220,000-$300,000',
            '$250,000-$400,000',
            '$190,000-$340,000',
        ]) {
            expect(src, `uncomputed band still present: ${fabricated}`).not.toContain(fabricated);
        }
    });

    it('rows derive from declared assumptions that are rendered to the reader', () => {
        expect(src).toContain('PRACTICE_MODEL');
        expect(src).toContain('SCENARIO_ROWS.map');
        expect(src).toContain('What this model assumes');
        expect(src).toContain('workingWeeksPerYear');
    });

    it('net is stated as pre-tax and hands off to the 1099 guide', () => {
        expect(src).toContain('Net before tax');
        expect(src).toContain('/resources/1099-vs-w2');
    });
});

describe('P2 #22 — the salary hub and its PDF drop the fabricated FPA premium', () => {
    const hubRaw = read(SALARY_HUB);
    const pdfRaw = read(SALARY_PDF);
    const hub = stripComments(hubRaw);
    const pdf = stripComments(pdfRaw);

    it('neither surface still publishes the "+12-15%" premium', () => {
        // Review finding: item #22 removed this from /resources/fpa-guide
        // but left it on /salary-guide (three places) and in the generated
        // PDF (two places), where p1-salary-pdf-deliverable.test.ts
        // REQUIRED it. The repo's own p0 suite already lists "12-15%" as an
        // unsourced invention.
        expect(hub, `${SALARY_HUB} still publishes the unsourced FPA premium`).not.toContain('12-15%');
        expect(pdf, `${SALARY_PDF} still publishes the unsourced FPA premium`).not.toContain('12-15%');
    });

    it('the replacement explains the mechanism and is mirrored in both', () => {
        const replacement = 'Practice authority is a legal classification, not a pay scale';
        expect(hub).toContain(replacement);
        expect(pdf).toContain(replacement);
    });

    it('the FPA/non-FPA panels compare rights, not an invented pay gap', () => {
        for (const src of [hub, pdf]) {
            expect(src).not.toContain('salary premium');
            expect(src).not.toContain('Baseline salary');
            expect(src).toContain('Own and bill under your own practice');
        }
    });

    it('the "increase my salary" FAQ drops the ownership range that contradicts the model', () => {
        // /resources/private-practice-guide now MODELS ownership income at
        // $177K-$225K gross / $133K-$192K net; the hub FAQ was still
        // asserting an uncited "$180,000-$300,000+" for the same thing.
        const faqAnswer = hubRaw
            .split('\n')
            .find((l) => l.includes('q: `How can I increase my'));
        expect(faqAnswer, 'the "increase my salary" FAQ must exist').toBeTruthy();
        expect(faqAnswer).not.toContain('$180,000-$300,000');
        expect(faqAnswer).not.toContain('12-15%');
    });
});

/* ─────────────────────────────────────────────────────────────────────────
 * REVIEW FOLLOW-UP — /salary-guide must not look partially audited.
 * ─────────────────────────────────────────────────────────────────────────
 * The first pass deleted the fabricated "+12-15%" FPA premium from the hub
 * FAQ and left four figures of identical provenance beside it: "+10-25%"
 * for specialization IN THE SAME SENTENCE, "20-50% more" for travel, and
 * the "$95,000-$115,000" / "$150,000-$180,000+" pair. Removing one
 * invention and leaving its neighbours is worse than leaving all of them,
 * because the page then reads as audited.
 *
 * Why they are not simply all deleted: the tables and factor cards are
 * pinned BYTE-IDENTICAL to scripts/generate-salary-pdf.ts by the
 * pre-existing P1 parity guard, and their annual bands are already
 * enumerated as known debt by UNMIGRATED_SALARY_BAND_SURFACES above.
 * The consistent end state enforced here is instead:
 *   1. No FAQ answer — the surface FAQPage JSON-LD emits and search engines
 *      extract standalone — states an uncited figure as fact.
 *   2. Everything that remains is labelled in place, on the page AND in the
 *      PDF, by SALARY_FIGURE_PROVENANCE.
 * ────────────────────────────────────────────────────────────────────────*/
describe('P2 #22 (follow-up) — every uncited figure on /salary-guide is labelled', () => {
    const hubRaw = read(SALARY_HUB);
    const pdfRaw = read(SALARY_PDF);
    const hub = stripComments(hubRaw);
    const pdf = stripComments(pdfRaw);

    /** The `faqData` entries only — what JSON-LD emits. */
    const faqAnswers = hubRaw
        .split('\n')
        .filter((l) => /^\s*\{ q: `/.test(l))
        .join('\n');

    it('the FAQ block was actually found (guards the parser above)', () => {
        expect(faqAnswers).toContain('How much do');
        expect(faqAnswers.split('\n').length).toBeGreaterThanOrEqual(5);
    });

    it('no FAQ answer states an uncited premium percentage as fact', () => {
        // Every one of these sat in a faqData answer alongside the "+12-15%"
        // that was deleted.
        expect(faqAnswers, 'specialization premium still asserted in an FAQ').not.toContain('+10-25%');
        expect(faqAnswers, 'travel premium still asserted in an FAQ').not.toContain('20-50% more');
        expect(faqAnswers).not.toContain('12-15%');
    });

    /**
     * The general rule, applied to every answer rather than a chosen few —
     * fixing three of the four uncited ranges in `faqData` would be the same
     * defect this describe block exists to correct. An answer may name a
     * dollar range only if it also says whose estimate it is.
     */
    it('EVERY FAQ answer naming a dollar range attributes it in the same answer', () => {
        const salaryRange = /\$\d{2,3},\d{3}(?:\s*(?:-|–|—|\s+to\s+)\s*\$?\d{2,3},\d{3})?/;
        const offenders = faqAnswers
            .split('\n')
            .filter((l) => salaryRange.test(l))
            // The cited BLS median is interpolated, never typed, so any
            // literal range in an answer is by definition uncited.
            .filter((l) => !/own (?:editorial )?estimates?/.test(l));
        expect(
            offenders.map((l) => l.trim().slice(0, 90)),
            'FAQ answers state a dollar range without saying whose estimate it is',
        ).toEqual([]);
    });

    it('the travel FAQ hands the comparison to the page that computes it', () => {
        const answer = faqAnswers.split('\n').find((l) => l.includes('How much do travel'));
        expect(answer, 'the travel FAQ must exist').toBeTruthy();
        expect(answer).toContain('1099 vs W2');
    });

    it('the provenance label exists in both the hub and the PDF generator', () => {
        expect(hub).toContain('const SALARY_FIGURE_PROVENANCE');
        expect(pdf).toContain('const SALARY_FIGURE_PROVENANCE');
        // The invariant fragments both copies share, so neither can be
        // softened into meaninglessness without failing here.
        for (const [label, src] of [['hub', hub], ['pdf', pdf]] as const) {
            expect(src, `${label} provenance label lost its claim`).toContain(
                "own editorial estimate, compiled from the roles posted",
            );
            expect(src, `${label} provenance label lost its warning`).toContain(
                'Treat them as a starting point for negotiation, not as survey data.',
            );
        }
    });

    it('the hub RENDERS the label — twice, next to where the figures appear', () => {
        // Once under the Quick Answer (which prints three ranges beside a
        // cited median) and once above the breakdown tables and factor
        // cards. Declaring the constant without rendering it would be the
        // same failure mode as the deleted citedValue() helper.
        const renders = hub.match(/\{SALARY_FIGURE_PROVENANCE\}/g) ?? [];
        expect(renders.length, 'label declared but not rendered on the hub').toBeGreaterThanOrEqual(2);
    });

    it('the PDF prints the label too — it is the surface that gets cited for years', () => {
        const printed = pdf.match(/\$\{escapeHtml\(SALARY_FIGURE_PROVENANCE\)\}/g) ?? [];
        expect(printed.length, 'label declared but not printed into the PDF').toBeGreaterThanOrEqual(2);
    });

    it('the PDF no longer cites the hub page as the source of the hub page numbers', () => {
        // The old methodology line said the ranges "reflect the published
        // market bands on <domain>/salary-guide" — a pointer at the page
        // printing the same numbers, which reads as a citation and is not.
        expect(pdf).not.toContain('ranges reflect the published');
    });
});

describe('P2 #22 — the three guides cross-link each other and the salary guide', () => {
    const guides: Record<string, string> = {
        [GUIDE_1099]: read(GUIDE_1099),
        [GUIDE_FPA]: read(GUIDE_FPA),
        [GUIDE_PP]: read(GUIDE_PP),
    };
    const hrefs: Record<string, string> = {
        [GUIDE_1099]: '/resources/1099-vs-w2',
        [GUIDE_FPA]: '/resources/fpa-guide',
        [GUIDE_PP]: '/resources/private-practice-guide',
    };

    for (const [file, src] of Object.entries(guides)) {
        it(`${file} links to the other two guides and /salary-guide`, () => {
            for (const [other, href] of Object.entries(hrefs)) {
                if (other === file) continue;
                expect(src, `${file} should link ${href}`).toContain(`href="${href}"`);
            }
            expect(src).toContain('href="/salary-guide"');
        });
    }
});

describe('P2 #22 — guide JSON-LD uses the repo escaping convention', () => {
    for (const guide of [GUIDE_1099, GUIDE_FPA, GUIDE_PP]) {
        it(`${guide} escapes angle brackets in every JSON-LD block`, () => {
            const src = read(guide);
            // No script tag may serialize with a bare JSON.stringify.
            expect(src).not.toContain('__html: JSON.stringify');
            expect(src).toContain('__html: ldJson(');
            // A single-backslash < would be a TS unicode escape that
            // compiles to a literal '<' — making the replace a no-op. The
            // source must carry an escaped backslash.
            const replaceLine = src
                .split('\n')
                .find((l) => l.includes('JSON.stringify(obj).replace'));
            expect(replaceLine, 'ldJson helper missing').toBeTruthy();
            expect(replaceLine).toContain(String.fromCharCode(92, 92) + 'u003c');
            expect(replaceLine).toContain(String.fromCharCode(92, 92) + 'u003e');
        });
    }
});

describe('P2 #22 — review dates were bumped with the content rewrite', () => {
    for (const guide of [GUIDE_1099, GUIDE_FPA, GUIDE_PP]) {
        it(`${guide} reports a LAST_REVIEWED at or after the rewrite`, () => {
            const src = read(guide);
            const match = src.match(/const LAST_REVIEWED = '(\d{4}-\d{2}-\d{2})'/);
            expect(match, `${guide} must declare LAST_REVIEWED`).toBeTruthy();
            expect(match![1] >= '2026-07-29').toBe(true);
            // The P0 #23 contract still holds: one constant feeds both the
            // visible stamp and Article.dateModified.
            expect(src).toContain('new Date(`${LAST_REVIEWED}T00:00:00Z`)');
            expect(src).toMatch(/dateModified:\s*LAST_REVIEWED/);
        });
    }
});
