/**
 * Salary-guide PDF lead-magnet availability flag (audit P0 #6).
 *
 * The PDF the email funnel promises (brand.assets.salaryGuidePdf /
 * SALARY_GUIDE_URL) has not been authored or uploaded yet — the storage
 * object 404s. Running an email-capture flow whose deliverable is a dead
 * link is dishonest, so every surface of the funnel gates on this flag:
 *
 *   - app/api/salary-guide/route.ts refuses (503) before capturing the
 *     lead or sending the email;
 *   - app/salary-guide/page.tsx hides the "Download Free PDF Guide" card;
 *   - components/ResourceDownloadGate.tsx swaps the email-capture form
 *     for a plain link to the live /salary-guide content (something
 *     real, no capture-for-nothing).
 *
 * Flip to `true` ONLY after the PDF is authored and uploaded to the
 * bucket behind brand.assets.salaryGuidePdf (see P1 #4 in the content
 * audit and docs/pilot-fork-runbook.md §2.9). Defaults off on purpose.
 *
 * This is a plain constant (no server-only imports) so both server
 * components and client components can share the single source of truth.
 * It lives beside the API route that delivers the PDF.
 */
export const SALARY_GUIDE_PDF_AVAILABLE = false;
