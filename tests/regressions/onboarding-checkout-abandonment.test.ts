/**
 * Regressions for B78 — checkout abandonment recovery:
 *
 *   1. POST /api/create-checkout accepts { resumeJobId } and mints a fresh
 *      Stripe session for the EXISTING Job/EmployerJob rows instead of
 *      creating duplicates.
 *   2. The resume path enforces ownership + resumable payment states and
 *      revives sweep-expired rows back to 'pending' (guarded) so the shared
 *      activation claim (pending→paid) still works.
 *   3. The employer dashboard shows a "Complete payment" action on Unpaid
 *      rows wired to the resume endpoint.
 *   4. The reconciliation sweep ages abandonment on the NEWEST session so a
 *      just-resumed checkout is not re-expired mid-payment.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CHECKOUT_ROUTE = 'app/api/create-checkout/route.ts';
const DASHBOARD_CLIENT = 'components/employer/EmployerDashboardClient.tsx';
const SWEEP = 'lib/inngest/functions/payment-reconciliation.ts';

describe('B78 — create-checkout resume mode', () => {
  const src = read(CHECKOUT_ROUTE);

  it('branches into resumeAbandonedCheckout when resumeJobId is supplied', () => {
    expect(src).toMatch(/resumeJobId\?: string/);
    expect(src).toMatch(/typeof rawBody\.resumeJobId === 'string'/);
    expect(src).toMatch(/return resumeAbandonedCheckout\(stripe, rawBody\.resumeJobId\.trim\(\), userId, profileEmail\)/);
    // The branch sits AFTER the auth block — anonymous callers never reach it.
    const authGate = src.indexOf("return NextResponse.json({ error: 'Authentication required' }, { status: 401 })");
    const resumeBranch = src.indexOf('return resumeAbandonedCheckout(');
    expect(authGate).toBeGreaterThan(-1);
    expect(resumeBranch).toBeGreaterThan(authGate);
  });

  it('enforces ownership and only resumes pending/expired rows', () => {
    expect(src).toMatch(/employerJob\.userId === userId/);
    expect(src).toMatch(/employerJob\.contactEmail\.toLowerCase\(\) === userEmail\.toLowerCase\(\)/);
    expect(src).toMatch(/paymentStatus !== 'pending' && employerJob\.paymentStatus !== 'expired'/);
    expect(src).toContain("code: 'NOT_RESUMABLE'");
  });

  it('revives sweep-expired rows to pending with a guarded update', () => {
    expect(src).toMatch(/where:\s*\{\s*id:\s*employerJob\.id,\s*paymentStatus:\s*'expired'\s*\}/);
    expect(src).toMatch(/data:\s*\{\s*paymentStatus:\s*'pending'\s*\}/);
  });

  it('reuses the original metadata contract and browser-binding cookie', () => {
    // Metadata must match what the webhook / verify / sweep activation reads.
    const resumeSection = src.slice(src.indexOf('async function resumeAbandonedCheckout'));
    expect(resumeSection).toMatch(/metadata:\s*\{\s*jobId:\s*employerJob\.job\.id,\s*pricing,\s*dashboardToken:\s*employerJob\.dashboardToken,?\s*\}/);
    expect(resumeSection).toContain("response.cookies.set('pmhnp_checkout_session', session.id");
  });
});

describe('B78 — dashboard Complete-payment action', () => {
  const src = read(DASHBOARD_CLIENT);

  it('posts resumeJobId to /api/create-checkout and redirects into the session', () => {
    expect(src).toMatch(/const handleResumePayment = async \(job: Job\)/);
    expect(src).toContain("fetch('/api/create-checkout'");
    expect(src).toContain('JSON.stringify({ resumeJobId: job.id })');
    expect(src).toContain('window.location.href = result.url');
  });

  it('renders the action only for unarchived unpaid-pending rows', () => {
    expect(src).toMatch(/!job\.isPublished && job\.paymentStatus === 'pending' && !job\.archivedAt && \(/);
    expect(src).toContain('Complete payment');
  });
});

describe('B78 — reconciliation sweep is resume-safe', () => {
  it('ages the abandonment window on the newest matched session when one exists', () => {
    const src = read(SWEEP);
    expect(src).toMatch(/const abandonedSinceMs = match \? match\.createdMs : row\.createdAtMs/);
    expect(src).toMatch(/Date\.now\(\) - abandonedSinceMs > ABANDON_AFTER_MS/);
    // The old row-age-only condition must not come back.
    expect(src).not.toMatch(/else if \(Date\.now\(\) - row\.createdAtMs > ABANDON_AFTER_MS\)/);
  });
});
