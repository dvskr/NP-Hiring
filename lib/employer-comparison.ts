/**
 * Employer comparison table — SINGLE audited copy consumed by BOTH
 * /for-employers and /pricing.
 *
 * Why this module exists (live review 2026-08-17, item 8c → WP-5):
 * /pricing carried a stale pre-audit FORK of this table ("100% NP
 * Audience", "No Unqualified Applicants", "Others: 30 days") labeled
 * "same as employer page" — the honesty audit (content audit P2 #16)
 * had only reached /for-employers. Sharing one module means the audited
 * cells cannot be forked away again; the regression guard in
 * tests/regressions/p9-claims-promises-review5.test.ts fails if either
 * page declares a local copy.
 *
 * Cell honesty rules (carried over from the P2 #16 audit, plus the
 * 2026-08-19 promise-removal pass):
 *
 *   - "100% NP Audience" → deleted (P2 #16): we can verify what we list,
 *     not who is reading.
 *   - "NP-Only Job Inventory" → softened to a screening commitment
 *     (2026-08-19): the live inventory carried out-of-scope listings
 *     (review items 1a–1d), so an absolute inventory guarantee is not
 *     currently true. The row now states what the pipeline actually
 *     does: listings are screened at ingest and removed when flagged
 *     out of scope. The absolute claim may return ONLY when the WP-1
 *     inventory-invariant test is green over the live inventory.
 *   - "No Unqualified Applicants" — DELETED (P2 #16). Anyone can click
 *     Apply here too; it was an unenforceable guarantee.
 *   - "First Post Free" — competitor cells are 'partial', not false:
 *     both Indeed and LinkedIn offer free listings.
 *   - Listing duration — competitor cells never assert "Others: 30
 *     days" (unverifiable, plan-dependent); the note discloses that the
 *     FREE first post runs config.freeDurationDays.
 *
 * Rule for future edits: the {brand.name} column must describe
 * behaviour that ships (with its limits in the note); competitor
 * columns must not assert anything more specific than "offered /
 * limited or paid / not offered", because their packaging changes
 * without notice — see the dated footnote rendered under the table on
 * /for-employers.
 *
 * Note copy must never hand-write an English article ("a"/"an") in
 * front of a brand.niche.* token: brand.niche.long is 'Nurse
 * Practitioner' here, so `an ${brand.niche.long}` would ship as "an
 * Nurse Practitioner". Phrase around the article so a row survives a
 * niche-token change (rendered-English guard in
 * tests/regressions/p2-trust-surfaces-point-of-sale.test.ts).
 */
import { brand } from '@/config/brand';
import { config } from '@/lib/config';

export interface ComparisonRow {
    feature: string;
    us: true | false | 'partial';
    indeed: true | false | 'partial';
    linkedin: true | false | 'partial';
    note?: string;
}

export const EMPLOYER_COMPARISON_ROWS: ComparisonRow[] = [
    { feature: `${brand.niche.medium}-Focused Job Inventory`, us: true, indeed: false, linkedin: false, note: `Built exclusively for ${brand.niche.long} and ${brand.niche.adjective} nursing roles — listings are screened at ingest and removed when flagged out of scope` },
    { feature: `First Post Free (No Card)`, us: true, indeed: 'partial', linkedin: 'partial', note: 'Others offer limited free listings; ours includes every paid feature' },
    { feature: `Flat $${config.postingPrice}/Post — No Bidding`, us: true, indeed: false, linkedin: false, note: 'Others bill per click or per day' },
    { feature: `${config.durationDays}-Day Listing Duration`, us: true, indeed: 'partial', linkedin: 'partial', note: `Paid posts run ${config.durationDays} days; the free first post runs ${config.freeDurationDays} days. Competitor durations vary by plan` },
    { feature: 'Direct Candidate Messaging', us: true, indeed: 'partial', linkedin: 'partial', note: `${config.limits.inmailsPerPosting} InMails included per posting; a paid add-on elsewhere` },
    { feature: 'Candidate Profile Unlocks', us: true, indeed: 'partial', linkedin: 'partial', note: `${config.limits.candidateUnlocksPerPosting} included per posting; a paid add-on elsewhere` },
    { feature: 'Built-In Screening Questions', us: true, indeed: true, linkedin: true, note: 'Up to 5 questions, with knockout answers' },
    { feature: 'Daily Niche Job Alerts', us: true, indeed: 'partial', linkedin: 'partial', note: 'Others send broader cross-industry alerts' },
    { feature: 'Applications in a Built-In Dashboard', us: true, indeed: true, linkedin: true },
    { feature: 'Instant Apply Notifications', us: true, indeed: true, linkedin: true },
];
