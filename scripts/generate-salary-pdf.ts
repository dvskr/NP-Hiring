#!/usr/bin/env node
/**
 * Generates the NP Salary Guide lead-magnet PDF (content audit P1 #4).
 *
 * Renders a print-optimized HTML document with the board's real salary
 * content and prints it to the local file behind
 * `brand.assets.salaryGuidePdf` (public/downloads/…) via Playwright
 * Chromium — the same PDF the /api/salary-guide email funnel delivers.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register --project scripts/tsconfig.json \
 *     scripts/generate-salary-pdf.ts [--debug-html <path>]
 *
 * `--debug-html` additionally writes the intermediate HTML to <path> for
 * visual QA in a browser (the PDF itself has no inspectable DOM).
 *
 * TRUTH RULES (non-negotiable — see the content audit):
 *   - Every national statistic derives from lib/stats-sources.ts.
 *   - The only posting-derived figures printed are EXACT COUNTS (how many
 *     postings, employers, states), read live via the same `where` shape
 *     app/salary-guide/page.tsx uses, so they match the hub page. The PDF
 *     deliberately does NOT freeze a per-state wage aggregate — see the
 *     long note above fetchLiveInventory for the validated reasons.
 *   - Salary bands come from config/niche/salary.ts and are labeled as
 *     the board's published validation bands, not as a survey.
 *   - Experience bands / setting ranges / specialty premiums / factor
 *     copy MIRROR the published /salary-guide page verbatim (that copy
 *     survived the P0 fabrication sweep). Drift between this script and
 *     the page is blocked by tests/regressions/p1-salary-pdf-deliverable.test.ts.
 *   - Nothing here invents a number, a person, or a quote.
 *
 * After regenerating, re-run:
 *   npx vitest run tests/regressions/p1-salary-pdf-deliverable.test.ts
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from 'playwright';
import { brand } from '@/config/brand';
import { SALARY_GUIDE_EDITION_YEAR } from '@/app/api/salary-guide/pdf-availability';
import { STAT_SOURCES, STATS_LAST_REVIEWED } from '@/lib/stats-sources';
import { salaryConfig } from '@/config/niche/salary';
import { V2, SERIF, SANS } from '@/lib/email-templates-v2';

// ── Edition constants ───────────────────────────────────────────────────
// The edition year is pinned (like LAST_REVIEWED_DATE on the hub page),
// not derived from the clock — regenerating in January must not silently
// re-label last year's figures as a new edition. It is parsed from the
// published asset filename in app/api/salary-guide/pdf-availability.ts,
// which is also what the hub card, the /resources card and the delivery
// email render — so the cover of this PDF and every surface describing it
// cannot disagree about which edition the funnel hands over.
const GUIDE_YEAR = SALARY_GUIDE_EDITION_YEAR;

/** Output path derives from the published asset URL — single source of truth. */
const OUTPUT_PATH = path.join(
    process.cwd(),
    'public',
    new URL(brand.assets.salaryGuidePdf).pathname.replace(/^\//, ''),
);

// ── Cited figures (all from lib/stats-sources.ts — never hardcoded) ─────
const NATIONAL_SALARY = STAT_SOURCES.averageSalary;
const NP_GROWTH = STAT_SOURCES.blsGrowth2034;
// P2 #22 follow-up: the Full Practice Authority card in buildHtml() used to
// assert a "+12-15%" FPA salary premium in its prose and again as a bullet.
// It was cited to nothing here or in lib/stats-sources.ts, the repo's own
// p0 suite already lists that figure as an unsourced invention, and it had
// already been deleted from /resources/fpa-guide — so the same claim was
// still shipping in the downloadable PDF. It is replaced with what practice
// authority actually controls. This card mirrors app/salary-guide/page.tsx;
// edit both together, and note that a NOTE LIKE THIS ONE MUST STAY A JS
// COMMENT — an HTML comment inside the template literal is emitted into the
// generated document. tests/regressions/p1-salary-pdf-deliverable.test.ts
// enforces the hub/PDF parity.
const FPA_STATES = STAT_SOURCES.fullPracticeStates;
const SHORTAGE_POP = STAT_SOURCES.hrsaShortagePopulation;

// ── Copy mirrored VERBATIM from app/salary-guide/page.tsx ───────────────
// The hub page is the sanctioned home of this copy (it survived the P0
// fabrication sweep). Do not edit these strings here — edit the page,
// then regenerate. The p1-salary-pdf drift test asserts both files carry
// identical literals.
//
// P2 #22 follow-up (second pass): "survived the P0 fabrication sweep" is
// NOT the same as "is sourced". Every range and premium in the three tables
// and the factor cards below is an uncited editorial estimate. A PDF is the
// worse of the two surfaces for that, because it gets saved and cited for
// years with no way to correct it in place — so the label below is printed
// in the document itself, mirroring app/salary-guide/page.tsx verbatim.
const SALARY_FIGURE_PROVENANCE = `Every salary range and percentage premium in this guide other than the cited national median is ${brand.name}'s own editorial estimate, compiled from the roles posted on ${brand.domain}. Treat them as a starting point for negotiation, not as survey data.`;

const experienceData = [
    { exp: 'New Grad (0-1 yr)', range: '$95,000 - $115,000', roles: `Staff ${brand.niche.short}, Outpatient Clinic` },
    { exp: 'Early Career (1-3 yrs)', range: '$110,000 - $130,000', roles: `Staff ${brand.niche.short}, Telehealth Provider` },
    { exp: 'Mid-Career (3-7 yrs)', range: '$125,000 - $150,000', roles: `Senior ${brand.niche.short}, Team Lead` },
    { exp: 'Experienced (7-15 yrs)', range: '$150,000 - $180,000', roles: 'Clinical Director, Supervisor' },
    { exp: 'Expert (15+ yrs)', range: '$180,000 - $250,000+', roles: 'Director, Consultant, Private Practice' },
];

const settingData = [
    { setting: 'Private Practice (Owner)', range: '$180,000 - $300,000+', notes: 'Highest earning potential, requires business skills' },
    { setting: 'Travel / Locum Tenens', range: '$150,000 - $250,000', notes: 'Includes housing, travel, higher hourly rates' },
    { setting: 'Telehealth / Remote', range: '$130,000 - $180,000', notes: 'Growing rapidly, flexible schedules' },
    { setting: 'Outpatient Clinic', range: '$120,000 - $160,000', notes: 'Most common setting, steady patient load' },
    { setting: 'Hospital / Inpatient', range: '$115,000 - $150,000', notes: 'Often includes shift differentials, benefits' },
    { setting: 'Community Health (FQHC)', range: '$100,000 - $130,000', notes: 'May qualify for loan forgiveness programs' },
];

const specialtyData = [
    { specialty: 'Acute Care / Hospitalist', premium: '+10-20%', notes: 'AGACNP certification, hospital demand' },
    { specialty: 'Psychiatric-Mental Health', premium: '+10-20%', notes: 'PMHNP-BC certification, provider shortage' },
    { specialty: 'Emergency / Urgent Care', premium: '+10-20%', notes: 'Dynamic environment, flexible scheduling' },
    { specialty: 'Dermatology / Aesthetics', premium: '+10-25%', notes: 'Procedure-driven, cash-pay revenue' },
    { specialty: 'Gerontology / Palliative', premium: '+5-10%', notes: 'Growing aging population' },
    { specialty: 'Private Practice (Owner)', premium: '+20-40%', notes: 'Higher risk, no benefits' },
    { specialty: 'Rural / Underserved', premium: '+10-15%', notes: 'Often includes loan repayment' },
];

const factorCards = [
    { img: 'factor-location', title: 'Geographic Location', desc: 'States with higher cost of living and greater demand (CA, NY, MA) typically offer 20-40% higher salaries than rural areas.' },
    { img: 'factor-experience', title: 'Experience Level', desc: `Entry-level ${brand.niche.short}s start around $95-115k. With 5+ years experience, salaries can reach $150-180k or more.` },
    { img: 'factor-setting', title: 'Practice Setting', desc: 'Private practice and telehealth positions often pay more than hospital or community health settings.' },
    { img: 'factor-employment', title: 'Employment Type', desc: `1099 contractors and travel ${brand.niche.short}s often earn 20-50% more than W2 employees, though without traditional benefits.` },
    { img: 'factor-specialty', title: 'Specialization', desc: 'Subspecialties like acute care, emergency, psychiatric-mental health, or dermatology can command premium pay (+10-25%).' },
    { img: 'factor-negotiate', title: 'Negotiation', desc: `${brand.niche.short}s who negotiate can often secure 5-15% higher starting salaries plus signing bonuses ($5,000-$30,000).` },
];

/**
 * ── WHY THIS PDF DOES NOT FREEZE A STATE-BY-STATE WAGE TABLE ────────────
 *
 * The first cut of this generator mirrored the /salary-guide hub's live
 * per-state aggregate (mean of posted range midpoints). Validating the
 * rendered output against the live database showed that aggregate is not
 * publishable as a wage statistic in a permanent, citable document:
 *
 *   - Annualized contract/locum HOURLY rates land in the same column as
 *     W-2 salaries (the contractor ceiling × 2,080 h is well over
 *     $700k), so top states read $250k–$380k against the federal
 *     national median cited on page 1 — roughly triple it.
 *   - Physician postings (psychiatrist listings at $300k–$389k) sit in
 *     the same pool and drive several states' figures single-handedly.
 *   - The disclosed-salary pool is employer-concentrated — a few dozen
 *     employers produce most postings, and several states' "average" is
 *     one employer's duplicated listing.
 *
 * Medians, the published $60k–$400k validation band, and per-employer
 * dedupe each reduce but do not remove the distortion, because the
 * underlying pool is small and mixed. A web table that updates daily can
 * carry that caveat; an emailed PDF that gets cited for years cannot.
 *
 * So the PDF publishes what it can stand behind: the BLS national wage
 * figures, the board's own published salary-validation bands
 * (config/niche/salary.ts), the market bands mirrored from
 * /salary-guide, and EXACT live inventory counts (how many postings,
 * employers, and states) — then points readers at the daily-updated
 * state table on the site instead of freezing a snapshot of it.
 *
 * Counts are facts. Derived per-state wages from this pool are not.
 * The upstream data-quality fixes are reported in the audit package
 * notes (they live in ingestion + app/salary-guide/page.tsx, outside
 * this script's ownership).
 */

/** Exact, defensible live inventory facts — counts only, no derived wages. */
interface LiveInventory {
    /** Published postings carrying a disclosed salary (hub's `jobsWithSalary`). */
    postingsWithSalary: number;
    /** Distinct hiring employers behind those postings. */
    employers: number;
    /** Distinct states those postings cover. */
    statesCovered: number;
    /** All published postings, salary disclosed or not. */
    totalPublished: number;
    snapshotDate: string;
}

const DB_TIMEOUT_MS = 30_000;

/**
 * Live inventory counts. The disclosed-salary filter is the exact `where`
 * shape app/salary-guide/page.tsx's getOverallStats uses, so the count
 * printed here always matches the figure shown on the hub page.
 *
 * Returns null when the database is unreachable; the caller then renders
 * the same section minus the count sentence (the bands are static config).
 */
async function fetchLiveInventory(): Promise<LiveInventory | null> {
    try {
        const { prisma } = await import('@/lib/prisma');
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`database timeout after ${DB_TIMEOUT_MS}ms`)), DB_TIMEOUT_MS));

        const withSalary = { isPublished: true, normalizedMinSalary: { not: null } };

        const [salaryStats, employerGroups, stateGroups, totalPublished] = await Promise.race([
            Promise.all([
                prisma.job.aggregate({ where: withSalary, _count: { id: true } }),
                prisma.job.groupBy({ by: ['employer'], where: withSalary, _count: { id: true } }),
                prisma.job.groupBy({
                    by: ['state'],
                    where: { ...withSalary, state: { not: null } },
                    _count: { id: true },
                }),
                prisma.job.count({ where: { isPublished: true } }),
            ]),
            timeout,
        ]);

        await prisma.$disconnect();

        if (salaryStats._count.id === 0) return null;

        return {
            postingsWithSalary: salaryStats._count.id,
            employers: employerGroups.length,
            statesCovered: stateGroups.length,
            totalPublished,
            snapshotDate: new Date().toISOString().slice(0, 10),
        };
    } catch (error) {
        console.warn('[salary-pdf] live DB unavailable — rendering the edition without live inventory counts:',
            error instanceof Error ? error.message : error);
        return null;
    }
}

// ── HTML helpers ────────────────────────────────────────────────────────
const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const usd = (n: number): string => `$${n.toLocaleString('en-US')}`;

/** Inline a local public/ asset as a data URI so the PDF is self-contained. */
function dataUri(relPublicPath: string, mime: string): string {
    const abs = path.join(process.cwd(), 'public', relPublicPath);
    return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
}

function statCard(value: string, label: string, source: string): string {
    return `<div class="stat-card">
      <div class="stat-value">${value}</div>
      <div class="stat-label">${label}</div>
      <div class="stat-source">${source}</div>
    </div>`;
}

/**
 * "Salary by location" section. Publishes the board's own salary-validation
 * bands (config/niche/salary.ts — static, always available) plus EXACT live
 * inventory counts when the database is reachable, and routes readers to the
 * daily-updated state table on the site rather than freezing a snapshot of a
 * pool that mixes annualized hourly contracts with W-2 salaries. See the
 * long note above fetchLiveInventory for the evidence behind that choice.
 */
function buildPayByLocationSection(live: LiveInventory | null): string {
    const n = salaryConfig.normalizer;

    const inventoryLine = live
        ? `<p class="section-note">As of ${live.snapshotDate}, ${brand.name} lists
             <strong>${live.postingsWithSalary.toLocaleString('en-US')}</strong> active ${brand.niche.short} postings
             with a disclosed salary, from <strong>${live.employers.toLocaleString('en-US')}</strong> hiring employers
             across <strong>${live.statesCovered}</strong> states, out of
             ${live.totalPublished.toLocaleString('en-US')} published openings in total.</p>`
        : `<p class="section-note">Live inventory counts were unavailable when this edition was generated.
             Current counts are shown on ${brand.domain}/salary-guide.</p>`;

    return `
    <section class="page-break">
      <p class="kicker">Salary by Location</p>
      <h2>Where ${brand.niche.short} Pay Comes From &mdash; and Where to Look It Up</h2>
      ${inventoryLine}

      <div class="callout warn">
        <strong>Why this guide does not print a state-by-state wage table.</strong>
        State pay on ${brand.name} is derived from live postings that change every day, and the disclosed-salary
        pool mixes W-2 salaries with annualized contract and locum hourly rates &mdash; so a snapshot frozen into a
        PDF would go stale and would overstate typical pay. The <strong>state-by-state table updates daily and is
        free</strong> at <strong>${brand.domain}/salary-guide</strong>, with a dedicated page per state. For an
        authoritative national wage benchmark, use the federal figure cited throughout this guide:
        <strong>${NATIONAL_SALARY.formatted}</strong> (${escapeHtml(NATIONAL_SALARY.source)}).
      </div>

      <h3 style="font-size:13px;margin:14px 0 6px;">${brand.name} Salary-Validation Bands</h3>
      <p class="section-note">These are the board&rsquo;s <strong>ingestion thresholds</strong>, not a measurement of
        ${brand.niche.short} pay. Every salary an employer posts is checked against them before the listing goes live:
        numbers outside the outer bounds are rejected as data-entry errors, and numbers outside the middle band are
        flagged for a human to look at. They are set deliberately wide so that legitimate edge cases are not thrown
        away, which means they describe what this board will <em>accept</em> &mdash; not what a typical
        ${brand.niche.short} earns. For a measured wage figure, use the federal benchmark above
        (<strong>${NATIONAL_SALARY.formatted}</strong>, ${escapeHtml(NATIONAL_SALARY.source)}); for market ranges, use
        the experience, setting and specialty tables in the next section.</p>
      <table class="data-table">
        <thead><tr><th>Band</th><th class="num">Range</th><th>How the board uses it</th></tr></thead>
        <tbody>
          <tr>
            <td>W-2 annual salary</td>
            <td class="num strong">${usd(n.annualMin)} &ndash; ${usd(n.annualMax)}</td>
            <td class="notes">Accept/reject bounds for a posted W-2 figure. The ceiling is set high enough to admit the
              best-paid advanced-practice listings (CRNA-level roles in high-cost markets), so it is an upper limit on
              accepted data &mdash; not the top of the ${brand.niche.short} market</td>
          </tr>
          <tr>
            <td>Outlier-review band</td>
            <td class="num strong">${usd(n.typical.min)} &ndash; ${usd(n.typical.max)}</td>
            <td class="notes">A posted salary outside this band is flagged for manual review before publishing. It is a
              screening threshold carried over from the board&rsquo;s configuration &mdash; not a survey, and not a
              claim about where most offers land</td>
          </tr>
          <tr>
            <td>Contract / 1099 hourly</td>
            <td class="num strong">$${n.contractorHourlyMin} &ndash; $${n.contractorHourlyMax} per hour</td>
            <td class="notes">Validated as an hourly rate &mdash; do not annualize it to compare against a W-2 offer</td>
          </tr>
        </tbody>
      </table>
      <p class="fine" style="margin-top:6px;">A $${n.contractorHourlyMax}/hour contract rate multiplies out to
        ${usd(n.contractorHourlyMax * salaryConfig.hoursPerYear)} on paper, but carries no benefits, no paid time off,
        no employer payroll-tax contribution, and no guaranteed hours. Compare contract rates to contract rates.</p>
    </section>`;
}

function buildHtml(live: LiveInventory | null): string {
    const logo = dataUri('android-chrome-192x192.png', 'image/png');
    const icons = Object.fromEntries(
        factorCards.map((c) => [c.img, dataUri(`images/salary-guide/${c.img}-96.webp`, 'image/webp')]),
    );

    const postingsLine = live
        ? `Live inventory counts come from ${live.postingsWithSalary.toLocaleString('en-US')} active ${brand.niche.short} postings with a
           disclosed salary on ${brand.name} (snapshot ${live.snapshotDate}); posting data updates daily. This guide
           reports those counts and the board's published salary-validation bands rather than a frozen state-by-state
           wage table &mdash; see &ldquo;Salary by Location&rdquo;.`
        : `Live inventory counts were unavailable when this edition was generated; current counts are on
           ${brand.domain}/salary-guide.`;

    const methodologySources = [
        NATIONAL_SALARY, NP_GROWTH, FPA_STATES, SHORTAGE_POP,
    ].map((s) => `<li>${escapeHtml(s.source)} &mdash; <span class="mono">${escapeHtml(s.sourceUrl)}</span> (as of ${s.asOf})</li>`).join('');

    const factorGrid = factorCards.map((c) => `
      <div class="factor-card">
        <img src="${icons[c.img]}" alt="" width="40" height="40" />
        <div>
          <h4>${c.title}</h4>
          <p>${c.desc}</p>
        </div>
      </div>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${GUIDE_YEAR} ${brand.niche.short} Salary Guide — ${brand.name}</title>
<style>
  /* Palette + type mirror the email design system (lib/email-templates-v2.ts). */
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: ${SANS}; color: ${V2.textBody}; font-size: 10.5px; line-height: 1.55; }
  h1, h2, h3 { font-family: ${SERIF}; color: ${V2.textHeading}; }
  h2 { font-size: 19px; margin: 2px 0 6px; }
  section { margin-bottom: 22px; }
  .page-break { page-break-before: page; break-before: page; padding-top: 6px; }
  .kicker { font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: ${V2.teal}; }
  .section-note { font-size: 9.5px; color: ${V2.textMuted}; margin-bottom: 10px; max-width: 620px; }

  /* Cover band */
  .cover { background: linear-gradient(135deg, ${V2.bgPeach}, ${V2.bgPeachLight}); border-radius: 14px; padding: 26px 28px 22px; margin-bottom: 18px; }
  .cover .brand-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .cover .brand-row img { width: 34px; height: 34px; border-radius: 8px; }
  .cover .brand-name { font-family: ${SERIF}; font-size: 15px; font-weight: 700; color: ${V2.textPrimary}; }
  .cover h1 { font-size: 30px; line-height: 1.12; margin-bottom: 10px; }
  .cover .lede { font-size: 12px; color: ${V2.textLabel}; max-width: 520px; }
  .cover .stamp { margin-top: 12px; font-size: 9px; color: ${V2.textLabel}; }

  /* Stat cards */
  .stat-row { display: flex; gap: 10px; margin-bottom: 18px; }
  .stat-card { flex: 1; background: ${V2.bgElevated}; border: 1px solid ${V2.borderLight}; border-radius: 12px; padding: 12px 12px 10px; }
  .stat-value { font-size: 19px; font-weight: 800; color: ${V2.teal}; letter-spacing: -0.3px; }
  .stat-label { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: ${V2.textFaded}; margin: 4px 0 5px; }
  .stat-source { font-size: 8px; color: ${V2.textMuted}; line-height: 1.4; }

  /* Cards + callouts */
  .card { background: ${V2.bgCard}; border: 1px solid ${V2.borderLight}; border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; break-inside: avoid; }
  .card h3 { font-size: 13px; margin-bottom: 6px; }
  .callout { border-radius: 10px; padding: 10px 14px; font-size: 9.5px; margin-bottom: 12px; }
  .callout.warn { background: ${V2.bgAmberWarn}; border: 1px solid ${V2.borderAmber}; color: ${V2.amberDark}; }
  ul.sources { margin: 6px 0 0 16px; font-size: 9px; color: ${V2.textMuted}; }
  ul.sources li { margin-bottom: 3px; }
  .mono { font-family: Consolas, Menlo, monospace; font-size: 8.5px; }

  /* Tables */
  .data-table { width: 100%; border-collapse: collapse; background: ${V2.bgElevated}; border: 1px solid ${V2.borderLight}; border-radius: 10px; overflow: hidden; }
  .data-table th { background: ${V2.bgPeachLight}; color: ${V2.textHeading}; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.08em; text-align: left; padding: 7px 10px; }
  .data-table td { padding: 5.5px 10px; border-top: 1px solid ${V2.borderLight}; font-size: 9.5px; vertical-align: top; }
  .data-table tr { page-break-inside: avoid; break-inside: avoid; }
  .data-table .num { text-align: right; white-space: nowrap; }
  .data-table th.num { text-align: right; }
  .data-table .strong { font-weight: 700; color: ${V2.textHeading}; }
  .data-table .accent { font-weight: 700; color: ${V2.teal}; }
  .data-table .notes { color: ${V2.textMuted}; font-size: 8.8px; }

  /* Two-column layout */
  .cols { display: flex; gap: 14px; }
  .cols > div { flex: 1; }

  /* FPA panels */
  .fpa-grid { display: flex; gap: 10px; margin-top: 8px; }
  .fpa-panel { flex: 1; border-radius: 10px; padding: 10px 14px; font-size: 9.5px; }
  .fpa-panel.yes { background: #FDF2F8; border: 1px solid #FBCFE8; }
  .fpa-panel.no { background: ${V2.bgCardAlt}; border: 1px solid ${V2.borderMed}; }
  .fpa-panel h4 { font-family: ${SANS}; font-size: 10px; margin-bottom: 4px; }
  .fpa-panel.yes h4 { color: ${V2.teal}; }
  .fpa-panel.no h4 { color: ${V2.textMuted}; }
  .fpa-panel ul { margin-left: 14px; }

  /* Factor cards */
  .factor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .factor-card { display: flex; gap: 10px; background: ${V2.bgElevated}; border: 1px solid ${V2.borderLight}; border-radius: 12px; padding: 12px 14px; break-inside: avoid; }
  .factor-card img { border-radius: 10px; flex-shrink: 0; }
  .factor-card h4 { font-family: ${SANS}; font-size: 10.5px; color: ${V2.textHeading}; margin-bottom: 3px; }
  .factor-card p { font-size: 9.3px; color: ${V2.textMuted}; }

  .cite { font-family: ${SERIF}; font-style: italic; font-size: 9.5px; color: ${V2.textBody}; }
  .fine { font-size: 8.5px; color: ${V2.textMuted}; }
  .cta { background: linear-gradient(135deg, ${V2.tealButton}, ${V2.teal}); color: #fff; border-radius: 12px; padding: 14px 18px; margin-top: 10px; }
  .cta h3 { color: #fff; font-size: 13px; margin-bottom: 3px; }
  .cta p { font-size: 9.5px; color: #FBE8D8; }
</style>
</head>
<body>

  <div class="cover">
    <div class="brand-row">
      <img src="${logo}" alt="${brand.name} logo" />
      <span class="brand-name">${brand.name}</span>
    </div>
    <p class="kicker">${GUIDE_YEAR} Salary Data</p>
    <h1>${brand.niche.long} Salary Guide</h1>
    <p class="lede">National median <strong>${NATIONAL_SALARY.formatted}</strong> per year
      (${escapeHtml(NATIONAL_SALARY.source)}). Pay by experience level, practice setting, and specialty premium,
      plus what to check before you negotiate &mdash; for ${brand.niche.descriptor}s. State-by-state figures
      update daily at ${brand.domain}/salary-guide.</p>
    <p class="stamp">Figures verified ${STATS_LAST_REVIEWED} &middot; Published by ${brand.name} (${brand.domain}) &middot; Free companion to ${brand.domain}/salary-guide</p>
  </div>

  <div class="stat-row">
    ${statCard(NATIONAL_SALARY.formatted, 'National Median', escapeHtml(NATIONAL_SALARY.source))}
    ${statCard(NP_GROWTH.formatted, 'Projected Job Growth', escapeHtml(NP_GROWTH.source))}
    ${statCard(FPA_STATES.formatted, 'Full Practice Authority', escapeHtml(FPA_STATES.source))}
    ${statCard(SHORTAGE_POP.formatted, 'In Primary-Care Shortage Areas', escapeHtml(SHORTAGE_POP.source))}
  </div>

  <div class="card">
    <h3>Quick Answer: ${brand.niche.short} Salary in ${GUIDE_YEAR}</h3>
    <p>The median ${brand.niche.short} salary is <strong>${NATIONAL_SALARY.formatted} per year</strong>
      (${escapeHtml(NATIONAL_SALARY.source)}). New graduates start at $95,000-$115,000, while experienced
      ${brand.niche.short}s (7-15 years) earn $150,000-$180,000. Private practice owners can earn
      $180,000-$300,000+. Pay runs highest in West Coast and Northeast markets, with California, Washington,
      and New Jersey near the top in federal wage data.</p>
    <p class="fine">${escapeHtml(SALARY_FIGURE_PROVENANCE)}</p>
  </div>

  <div class="card">
    <h3>Methodology &amp; Sources</h3>
    <p>Every national figure in this guide traces to a named public source; every posting-derived figure
      traces to live listings on ${brand.name}. ${postingsLine}</p>
    <ul class="sources">${methodologySources}</ul>
    <p class="fine" style="margin-top:6px;">${escapeHtml(SALARY_FIGURE_PROVENANCE)} Individual offers vary by
      employer, location, credentials, and experience. The previous wording here said these ranges &ldquo;reflect
      the published market bands on ${brand.domain}/salary-guide&rdquo;, which pointed at the page that prints the
      same numbers rather than at a source &mdash; circular, and it read as a citation.</p>
  </div>

  ${buildPayByLocationSection(live)}

  <section class="page-break">
    <p class="kicker">Salary Breakdown</p>
    <h2>What Impacts Your Earnings</h2>
    <p class="fine">${escapeHtml(SALARY_FIGURE_PROVENANCE)}</p>

    <h3 style="font-size:13px;margin-bottom:6px;">By Experience Level</h3>
    <table class="data-table" style="margin-bottom:14px;">
      <thead><tr><th>Experience</th><th class="num">Salary Range</th><th>Typical Roles</th></tr></thead>
      <tbody>
        ${experienceData.map((e) => `<tr><td>${e.exp}</td><td class="num accent">${e.range}</td><td class="notes">${e.roles}</td></tr>`).join('')}
      </tbody>
    </table>

    <h3 style="font-size:13px;margin-bottom:6px;">By Practice Setting</h3>
    <table class="data-table" style="margin-bottom:14px;">
      <thead><tr><th>Setting</th><th class="num">Salary Range</th><th>Notes</th></tr></thead>
      <tbody>
        ${settingData.map((s) => `<tr><td>${s.setting}</td><td class="num accent">${s.range}</td><td class="notes">${s.notes}</td></tr>`).join('')}
      </tbody>
    </table>

    <h3 style="font-size:13px;margin-bottom:6px;">Specialty Premiums</h3>
    <table class="data-table" style="margin-bottom:14px;">
      <thead><tr><th>Specialty</th><th class="num">Premium vs. Baseline</th><th>Notes</th></tr></thead>
      <tbody>
        ${specialtyData.map((s) => `<tr><td>${s.specialty}</td><td class="num accent">${s.premium}</td><td class="notes">${s.notes}</td></tr>`).join('')}
      </tbody>
    </table>

    <div class="card">
      <h3>Full Practice Authority</h3>
      <p><strong>${FPA_STATES.formatted}</strong> grant FPA (${escapeHtml(FPA_STATES.source)}).
        Practice authority is a legal classification, not a pay scale — it decides which ways of earning are open to you in that state.</p>
      <div class="fpa-grid">
        <div class="fpa-panel yes">
          <h4>&#10003; Full Practice Authority</h4>
          <ul>
            <li>Own and bill under your own practice</li>
            <li>Independent 1099 and telehealth work</li>
            <li>Full clinical independence</li>
          </ul>
        </div>
        <div class="fpa-panel no">
          <h4>Restricted / Reduced</h4>
          <ul>
            <li>Collaborating physician required first</li>
            <li>That agreement is usually a paid one</li>
            <li>Physician oversight where restricted</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section class="page-break">
    <p class="kicker">Maximize Your Pay</p>
    <h2>Factors Affecting ${brand.niche.short} Salary &mdash; and How to Negotiate</h2>
    <p class="section-note">Six levers that move ${brand.niche.short} compensation. Evergreen guidance &mdash;
      the same factor breakdown published on ${brand.domain}/salary-guide.</p>
    <div class="factor-grid">${factorGrid}</div>

    <div class="card" style="margin-top:14px;">
      <h3>Cite This Guide</h3>
      <p class="cite">${brand.name}. &ldquo;${GUIDE_YEAR} ${brand.niche.short} Salary Guide: ${brand.niche.long} Pay by State.&rdquo;
        ${brand.name}, ${GUIDE_YEAR}, ${brand.domain}/salary-guide.</p>
      <p class="fine" style="margin-top:5px;">Media inquiries and custom data requests: ${brand.email.press}</p>
    </div>

    <div class="cta">
      <h3>Find Your Next High-Paying ${brand.niche.short} Job</h3>
      <p>Browse current openings with disclosed salaries, filter by state, setting, and work type, and set free
        job alerts at <strong>${brand.domain}/jobs</strong>. The live salary guide &mdash; updated daily &mdash;
        is always free at <strong>${brand.domain}/salary-guide</strong>.</p>
    </div>
  </section>

</body>
</html>`;
}

async function renderPdf(html: string): Promise<void> {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        await page.pdf({
            path: OUTPUT_PATH,
            format: 'Letter',
            printBackground: true,
            margin: { top: '0.55in', bottom: '0.7in', left: '0.55in', right: '0.55in' },
            displayHeaderFooter: true,
            headerTemplate: '<span></span>',
            footerTemplate: `
              <div style="width:100%;font-size:8px;font-family:Helvetica,Arial,sans-serif;color:#718096;padding:0 0.55in;display:flex;justify-content:space-between;">
                <span>&copy; ${GUIDE_YEAR} ${brand.legal.entityName} &middot; ${brand.domain}/salary-guide</span>
                <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
              </div>`,
        });
    } finally {
        await browser.close();
    }
}

async function main(): Promise<void> {
    console.log('[salary-pdf] fetching live inventory counts…');
    const live = await fetchLiveInventory();
    if (live) {
        console.log(`[salary-pdf] live inventory: ${live.postingsWithSalary} postings with salary, `
            + `${live.employers} employers, ${live.statesCovered} states, ${live.totalPublished} published`);
    } else {
        console.log('[salary-pdf] rendering WITHOUT live inventory counts (bands are static config)');
    }

    const html = buildHtml(live);

    const debugFlagIdx = process.argv.indexOf('--debug-html');
    const debugHtmlPath = debugFlagIdx !== -1 ? process.argv[debugFlagIdx + 1] : undefined;
    if (debugHtmlPath) {
        fs.writeFileSync(debugHtmlPath, html, 'utf8');
        console.log(`[salary-pdf] debug HTML written to ${debugHtmlPath}`);
    }

    console.log('[salary-pdf] rendering PDF via Playwright Chromium…');
    await renderPdf(html);

    const bytes = fs.statSync(OUTPUT_PATH).size;
    console.log(`[salary-pdf] wrote ${path.relative(process.cwd(), OUTPUT_PATH)} (${(bytes / 1024).toFixed(0)} KB)`);
    console.log(`[salary-pdf] served at ${brand.assets.salaryGuidePdf}`);
}

main().catch((error) => {
    console.error('[salary-pdf] generation failed:', error);
    process.exit(1);
});
