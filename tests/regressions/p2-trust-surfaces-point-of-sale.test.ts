/**
 * Regression guards for content audit P2 #16 — employer trust at the point
 * of sale.
 *
 * Before this change an employer could complete the whole wizard, click a
 * button labelled "Looks Good — Post Job", and first learn the price on
 * Stripe's hosted page. The checkout step mentioned no refund posture and
 * carried no social proof, and the /for-employers comparison table asserted
 * things the product does not do ("No Unqualified Applicants") and things
 * about competitors that are simply false (that neither offers a free post).
 *
 * These guards pin:
 *   1. the price is disclosed on /post-job/preview, before checkout, and the
 *      primary button says what clicking it will do;
 *   2. the refund language everywhere matches Terms §8 — "generally
 *      non-refundable, requests inside 7 days reviewed case by case" — and
 *      is never upgraded to a money-back guarantee;
 *   3. checkout carries the policy plus consent-gated social proof that
 *      renders nothing when nothing is approved;
 *   4. the free post's shorter duration is disclosed on /for-employers;
 *   5. the comparison table keeps its honesty guarantees.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { brand } from '@/config/brand';
import { config as pricingConfig } from '@/lib/config';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Strip block and line comments. The "must NOT contain" assertions below run
 * against this, because the source comments deliberately quote the banned
 * strings when explaining why they were removed — a doc comment naming the
 * claim it deleted must not trip the guard that keeps it deleted.
 */
const code = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const preview = read('app/post-job/preview/page.tsx');
const checkoutLayout = read('app/post-job/checkout/layout.tsx');
const employers = read('app/for-employers/page.tsx');
const terms = read('app/terms/page.tsx');
const featuredTestimonials = read('components/FeaturedTestimonials.tsx');
// Live review item 8c (WP-5): the comparison table moved to a SHARED module
// consumed by BOTH /for-employers and /pricing, because /pricing carried a
// stale pre-audit fork of it. The table-honesty guards below now read the
// module; the page-level guards still read the pages.
const comparison = read('lib/employer-comparison.ts');
const pricing = read('app/pricing/page.tsx');

/** WCAG 2.x sRGB relative-luminance contrast, so colour claims are computed. */
const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => channel(v / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
}

const previewCode = code(preview);
const checkoutLayoutCode = code(checkoutLayout);
const employersCode = code(employers);
const comparisonCode = code(comparison);
const pricingCode = code(pricing);

describe('P2 #16 — the price is visible before checkout', () => {
    it('derives the paid/free decision from the quota API, not a guess', () => {
        expect(preview).toContain('const quotaKnown = quotaStatus?.eligible === true');
        expect(preview).toContain('const willBePaid = quotaKnown && quotaStatus?.willBeFree === false');
    });

    it('renders the price from lib/config, never a hardcoded literal', () => {
        expect(preview).toContain('`$${config.postingPrice}`');
        // No typed-in dollar amount in the preview page's actual markup.
        expect(previewCode).not.toMatch(/\$199\b/);
    });

    it('shows nothing rather than a wrong price while quota status is unknown', () => {
        // priceLabel is null until the API answers — the JSX is gated on it.
        expect(preview).toContain('{priceLabel && (');
        expect(preview).toContain('{priceCaption && (');
    });

    it('labels the primary button with the action it actually performs', () => {
        expect(preview).toContain('const primaryCtaLabel = willBePaid');
        expect(preview).toContain('`Continue to Payment — $${config.postingPrice}`');
        expect(preview).toContain("'Looks Good — Post Job'");
        expect(preview).toContain('{primaryCtaLabel}');
    });

    it('states the real refund posture next to the price, not a guarantee', () => {
        expect(preview).toMatch(/generally non-refundable/);
        expect(preview).toMatch(/7 days are reviewed case\s*by\s*case/);
        expect(previewCode).not.toMatch(/money[- ]back guarantee/i);
        expect(previewCode).not.toMatch(/full refund/i);
    });
});

describe('P2 #16 — checkout carries the policy and real social proof', () => {
    it('adds the trust rail as a server layout so the client page is untouched', () => {
        expect(checkoutLayout).not.toContain("'use client'");
        expect(checkoutLayout).toContain('export default function CheckoutLayout');
        expect(checkoutLayout).toContain('{children}');
    });

    it('states the 7-day review window and links the governing Terms section', () => {
        expect(checkoutLayout).toMatch(/generally non-refundable/);
        expect(checkoutLayout).toContain('7 days of purchase');
        expect(checkoutLayout).toContain('href="/terms"');
        expect(checkoutLayoutCode).not.toMatch(/money[- ]back guarantee/i);
    });

    it('keeps that promise consistent with what the Terms actually say', () => {
        // If Terms §8 ever stops offering the 7-day review, this fails and
        // forces the point-of-sale copy to be updated in the same change.
        expect(terms).toContain('within 7 days of purchase');
        expect(terms).toMatch(/generally non-refundable/);
    });

    it('renders price and package figures from lib/config', () => {
        expect(checkoutLayout).toContain('config.postingPrice');
        expect(checkoutLayout).toContain('config.durationDays');
        expect(checkoutLayout).toContain('config.limits.candidateUnlocksPerPosting');
        expect(checkoutLayoutCode).not.toMatch(/\$199\b/);
    });

    it('uses the consent-gated testimonial component for social proof', () => {
        expect(checkoutLayout).toContain("import FeaturedTestimonials from '@/components/FeaturedTestimonials'");
        expect(checkoutLayout).toContain('<FeaturedTestimonials variant="compact" />');
        // No hand-written quote, logo wall, or customer-count claim.
        expect(checkoutLayoutCode).not.toMatch(/&ldquo;|&rdquo;/);
        expect(checkoutLayoutCode).not.toMatch(/\b\d{2,3},?\d*\+\s*(employers|companies|teams)/i);
    });
});

/**
 * The trust rail this package added to checkout renders on the BARE page
 * background: the aside paints nothing, and app/post-job/checkout/page.tsx
 * renders no wrapper background, so both it and the compact testimonial panel
 * inherit body { background-color: #F5F0EB } from app/globals.css.
 *
 * That surface is what makes #6B7280 a failure. It clears AA on white
 * (4.833:1) and fails on #F5F0EB (4.269:1), which is exactly how it survived
 * review — and why the assertion has to name the surface rather than the
 * token. The three trust PAGES were moved to a darker token for this reason
 * and their guard computes it, but its page list did not reach these two
 * files, so the failure shipped inside the same package that fixed it.
 */
describe('P2 #16 — the point-of-sale trust copy clears AA on the surface it lands on', () => {
    const AA_NORMAL_TEXT = 4.5;
    const CHECKOUT_SURFACE = '#F5F0EB';
    const POS_FILES: [string, string][] = [
        ['app/post-job/checkout/layout.tsx', checkoutLayout],
        ['components/FeaturedTestimonials.tsx', featuredTestimonials],
    ];

    it('confirms the surface these two files actually paint text on', () => {
        // If any of these three premises changes, every ratio below is being
        // computed against the wrong background and must be redone.
        expect(read('app/globals.css')).toMatch(/body\s*\{[^}]*background-color:\s*#F5F0EB/i);
        const rail = checkoutLayout.slice(checkoutLayout.indexOf('<aside'), checkoutLayout.indexOf('</h2>'));
        expect(rail).not.toContain('background');
        expect(code(read('app/post-job/checkout/page.tsx'))).not.toContain('#F5F0EB');
    });

    it('uses no muted token that fails AA on that surface', () => {
        // Pin the premise, not just the outcome: this is a failure BECAUSE of
        // where it renders, and it would not be one on a white card.
        expect(contrast('#6B7280', CHECKOUT_SURFACE)).toBeLessThan(AA_NORMAL_TEXT);
        expect(contrast('#6B7280', '#FFFFFF')).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        for (const [name, src] of POS_FILES) {
            expect(code(src), `${name} still uses #6B7280 for text`).not.toContain("color: '#6B7280'");
        }
    });

    it('declares a MUTED_TEXT token in each that clears AA on both surfaces', () => {
        for (const [name, src] of POS_FILES) {
            const match = src.match(/const MUTED_TEXT = '(#[0-9A-Fa-f]{6})'/);
            expect(match, `${name} declares MUTED_TEXT`).not.toBeNull();
            for (const bg of [CHECKOUT_SURFACE, '#FFFFFF']) {
                expect(
                    contrast(match![1], bg),
                    `${name}: ${match![1]} on ${bg}`,
                ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
            }
        }
    });

    it('holds every literal text colour in both files to AA on that surface', () => {
        // A ratchet, not a spot check: any hex added to a `color:` in these
        // files must clear the bar. Matches only `color: '#…'`, so the star
        // icons' conditional fill (`color: i <= rating ? …`) is excluded — it
        // is decorative and sits behind an aria-label on the wrapper.
        let checked = 0;
        for (const [name, src] of POS_FILES) {
            for (const [, hex] of code(src).matchAll(/\bcolor: '(#[0-9A-Fa-f]{6})'/g)) {
                expect(
                    contrast(hex, CHECKOUT_SURFACE),
                    `${name}: ${hex} on ${CHECKOUT_SURFACE}`,
                ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(4);
    });
});

describe('P2 #16 — /for-employers discloses the free-post terms', () => {
    it('states the free post duration wherever the paid duration is sold', () => {
        expect(employers).toContain('config.freeDurationDays');
        expect(employers).toMatch(/Free post runs \{config\.freeDurationDays\} days/);
        expect(employers).toContain('One free post per organization');
    });

    it('no longer hardcodes the listing duration in the bento headline', () => {
        expect(employersCode).not.toContain('>60-Day Listing<');
        expect(employers).toContain('{config.durationDays}-Day Listing');
    });

    it('drops the unverifiable "double the industry standard" claim', () => {
        expect(employersCode).not.toMatch(/[Dd]ouble the industry standard/);
    });

    it('states the real refund policy in the FAQ (which also feeds the JSON-LD)', () => {
        expect(employers).toMatch(/generally non-refundable/);
        expect(employers).toContain('review the request case by case');
    });
});

describe('P2 #16 — the comparison table is honest', () => {
    it('both pages consume the ONE audited module — no local fork can drift', () => {
        for (const [name, src] of [['for-employers', employers], ['pricing', pricing]] as const) {
            expect(src, name).toContain("from '@/lib/employer-comparison'");
            expect(code(src), name).not.toMatch(/const comparisonRows(?::|\s*=\s*\[)/);
        }
    });

    it('drops the unenforceable "No Unqualified Applicants" guarantee', () => {
        for (const src of [employersCode, pricingCode, comparisonCode]) {
            expect(src).not.toContain('No Unqualified Applicants');
        }
    });

    it('claims screened inventory, which we can verify, rather than audience composition', () => {
        for (const src of [employersCode, pricingCode, comparisonCode]) {
            expect(src).not.toContain('100% ${brand.niche.medium} Audience');
        }
        // Live review item 8a: even "-Only Job Inventory" was an absolute the
        // inventory falsified — the row is now a screening commitment.
        expect(comparison).toContain('${brand.niche.medium}-Focused Job Inventory');
        expect(comparison).toContain('screened at ingest and removed when flagged out of scope');
    });

    it('stops asserting that competitors have no free posting option', () => {
        const rows = comparison.slice(comparison.indexOf('const EMPLOYER_COMPARISON_ROWS'));
        const freeRow = rows.split('\n').find((l) => l.includes('First Post Free'));
        expect(freeRow).toBeDefined();
        expect(freeRow).toContain("indeed: 'partial'");
        expect(freeRow).toContain("linkedin: 'partial'");
    });

    it('marks competitor paid add-ons as limited rather than absent', () => {
        const rows = comparison.slice(comparison.indexOf('const EMPLOYER_COMPARISON_ROWS'));
        for (const feature of ['Direct Candidate Messaging', 'Candidate Profile Unlocks']) {
            const row = rows.split('\n').find((l) => l.includes(feature));
            expect(row, feature).toBeDefined();
            expect(row, feature).toContain("indeed: 'partial'");
        }
    });

    it('never resurrects the fork\'s unverifiable "Others: 30 days" cell', () => {
        for (const src of [employersCode, pricingCode, comparisonCode]) {
            expect(src).not.toContain("'Others: 30 days'");
        }
    });

    it('dates and qualifies the competitor columns instead of stating them as fact', () => {
        expect(employers).toMatch(/publicly documented standard\s*offerings/);
        expect(employers).toMatch(/check their sites/);
        // And offers a correction route, matching the editorial-policy posture.
        expect(employers).toContain('brand.email.contact');
    });

    it('is screen-reader navigable: scoped headers, a caption, and text alternatives', () => {
        expect(employers).toContain('scope="col"');
        expect(employers).toContain('scope="row"');
        expect(employers).toContain('<caption className="sr-only">');
        expect(employers).toContain('<span className="sr-only">Included</span>');
        expect(employers).toContain('<span className="sr-only">Not offered</span>');
    });
});

/**
 * The comparison-table cells are template literals over config tokens, so the
 * string that ships is not the string in the source. `an ${brand.niche.long}`
 * read fine in the editor and rendered "an Nurse Practitioner" on the primary
 * employer conversion page, directly under the headline row.
 *
 * These guards RENDER the cells with the real brand/config objects and check
 * the output, so a token change (NP → CRNA → PMHNP) that breaks agreement
 * fails here instead of on the live page.
 */
describe('P2 #16 — the comparison table renders as English', () => {
    const rowsBlock = comparisonCode.slice(
        comparisonCode.indexOf('const EMPLOYER_COMPARISON_ROWS'),
    );

    /** Evaluate a source template literal against the real config objects. */
    const render = (tpl: string): string =>
        new Function('brand', 'config', `return \`${tpl}\`;`)(brand, pricingConfig) as string;

    const cells: string[] = [
        ...[...rowsBlock.matchAll(/feature: `([^`]*)`/g)].map((m) => render(m[1])),
        ...[...rowsBlock.matchAll(/note: `([^`]*)`/g)].map((m) => render(m[1])),
        ...[...rowsBlock.matchAll(/feature: '([^']*)'/g)].map((m) => m[1]),
        ...[...rowsBlock.matchAll(/note: '([^']*)'/g)].map((m) => m[1]),
    ];

    /**
     * "a" vs "an" is about sound, not spelling. Initialisms take "an" when the
     * letter NAME opens with a vowel sound (an NP, an FNP, an MSN), which is
     * why a naive first-letter test is not enough.
     */
    const VOWEL_SOUND_LETTERS = 'AEFHILMNORSX';
    const startsWithVowelSound = (word: string): boolean =>
        /^[A-Z0-9]{2,}$/.test(word) ? VOWEL_SOUND_LETTERS.includes(word[0]) : /^[aeiou]/i.test(word);

    it('renders every cell (no unresolved template tokens)', () => {
        expect(cells.length).toBeGreaterThan(8);
        for (const cell of cells) {
            expect(cell, cell).not.toContain('${');
            expect(cell, cell).not.toMatch(/\bundefined\b/);
        }
    });

    it('uses the correct indefinite article for whatever the niche tokens are', () => {
        for (const cell of cells) {
            for (const [, article, word] of cell.matchAll(/\b(an?)\s+([A-Za-z][A-Za-z-]*)/g)) {
                const needsAn = startsWithVowelSound(word);
                expect(
                    article === 'an',
                    `"${article} ${word}" in cell: "${cell}"`,
                ).toBe(needsAn);
            }
        }
    });

    it('claims inventory rather than audience everywhere on the page', () => {
        // The table deleted "100% NP Audience" because we can verify what we
        // list, not who reads it. The same unverifiable claim survived in two
        // other places: the hero ("Every candidate here is a nurse
        // practitioner") and the "Who sees my job posting?" FAQ answer ("a
        // 100% NP audience"), which also feeds the FAQPage JSON-LD.
        expect(employersCode).not.toMatch(/Every candidate here is/);
        expect(employersCode).not.toMatch(/100% \$\{brand\.niche\.\w+\} audience/i);
        expect(employersCode).not.toMatch(/100% (NP|PMHNP|CRNA) audience/i);
        // Live review item 8a (WP-5): the inventory claim itself was then
        // falsified at the DB level (out-of-scope listings, items 1a–1d), so
        // the absolute became a screening commitment. The absolute may return
        // only when the WP-1 inventory-invariant test gates it.
        expect(employersCode).not.toMatch(/Every job on this board is/);
        expect(employers).toContain('This board is built exclusively for');
        expect(employers).toContain('screened at ingest');
    });

    it('states the board scope the config declares, not a narrower one', () => {
        // Replacing an unverifiable audience claim with a verifiable inventory
        // claim only helps if the inventory claim is true. "Every job on this
        // board is a nurse practitioner role" was not: config/brand.ts scopes
        // the board to every NP specialty PLUS the APRN cohort (CRNA, CNM,
        // CNS) — config/niche/relevance.ts matches those titles and
        // config/niche/credentials.ts offers them as categories. A CRNA or CNM
        // is an APRN, not an NP. The hero has to name both halves, exactly as
        // the comparison-row note and /press already do.
        expect(employersCode).not.toMatch(
            /Every job on this board is a\{' '\}\s*\{brand\.niche\.descriptor\}/,
        );
        expect(employers).toContain('{brand.niche.long} and {brand.niche.adjective} nursing roles');
        // The note it has to agree with lives in the shared module now…
        expect(comparison).toContain(
            'Built exclusively for ${brand.niche.long} and ${brand.niche.adjective} nursing roles',
        );
        // …and both halves render as distinct English, not the same word twice.
        expect(brand.niche.long.toLowerCase()).not.toBe(brand.niche.adjective.toLowerCase());
    });

    it('is held to that scope by the config the claim is measured against', () => {
        // If the APRN cohort is ever dropped from what the board matches and
        // offers, the hero could legitimately narrow again. This fails at that
        // moment and forces the re-check, instead of leaving the broader copy
        // sitting unexamined — the same failure mode that produced the
        // original over-claim.
        const credentials = read('config/niche/credentials.ts');
        const relevance = read('config/niche/relevance.ts');
        for (const cohort of ['(CRNA)', '(CNM)', '(CNS)']) {
            expect(credentials, `credentials still offers ${cohort}`).toContain(cohort);
        }
        expect(relevance).toContain('certified registered nurse anesthetist');
        expect(relevance).toContain('certified nurse-midwife');
        expect(relevance).toContain('clinical nurse specialist');
        expect(read('config/brand.ts')).toMatch(/plus the APRN cohort/i);
    });

    it('holds the FAQ answers to the same rendering standard (they feed JSON-LD)', () => {
        const faqBlock = employersCode.slice(
            employersCode.indexOf('const employerFaqs'),
            employersCode.indexOf('export default async function ForEmployersPage'),
        );
        const answers = [...faqBlock.matchAll(/a: `([^`]*)`/g)].map((m) => render(m[1]));
        expect(answers.length).toBeGreaterThan(2);
        for (const answer of answers) {
            expect(answer, answer).not.toContain('${');
            for (const [, article, word] of answer.matchAll(/\b(an?)\s+([A-Za-z][A-Za-z-]*)/g)) {
                expect(article === 'an', `"${article} ${word}" in FAQ answer: "${answer}"`).toBe(
                    startsWithVowelSound(word),
                );
            }
        }
    });
});
