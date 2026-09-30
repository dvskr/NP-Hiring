/**
 * Indexing audit 2026-09, job page package: what the job detail page shows.
 *
 *   GFJ-03  owner decision 2026-09 (reverses the earlier "apply without an
 *           account"): every Apply needs an account. A signed-out visitor
 *           gets the sign-up or log-in gate, external and Easy Apply alike;
 *           the employer link is rendered only for a signed-in candidate,
 *           and the description stays readable without an account.
 *   CQ-11   the About card prints the employer's facts on this board, never
 *           boilerplate; the site-wide Career Pulse card is gone; tips come
 *           from the posting's own facts.
 *   GFJ-01  the work-mode chip reads the verified mode.
 *   GFJ-16  the visible posted date reads the same field as datePosted.
 *   CS-06   "Last updated" is contentChangedAt; dead-link jobs read closed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));
vi.mock('@/lib/hooks/useAppliedJobs', () => ({
  default: () => ({ isApplied: () => false, markApplied: vi.fn(), getAppliedDate: () => null }),
}));
vi.mock('@/components/InPlatformApplyForm', () => ({ default: () => null }));
vi.mock('@/lib/analytics', () => ({ trackJobApply: vi.fn() }));
vi.mock('@/components/analytics/ViewTrackers', () => ({ buildTrackedJobItem: (job: unknown) => job }));

import { prisma } from '@/lib/prisma';
import ApplyButton from '@/components/ApplyButton';
import AboutEmployer, { buildEmployerFactSentences } from '@/components/AboutEmployer';
import { ApplicationTipsCard, getApplicationTips } from '@/components/jobs/SidebarVisualCards';
import { safeApplyHref, safeExternalHref } from '@/components/jobs/safe-external-href';
import { getEmployerFacts, summarizeEmployerRows, type EmployerFacts } from '@/app/jobs/[slug]/employer-facts';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PAGE = read('app/jobs/[slug]/page.tsx');
const APPLY_BUTTON = read('components/ApplyButton.tsx');

/* ─── GFJ-03: every Apply needs an account (owner decision 2026-09) ──────── */

const GREENHOUSE = 'https://job-boards.greenhouse.io/acme/jobs/5408840008';

function renderApply(props: Partial<React.ComponentProps<typeof ApplyButton>>): string {
  return renderToStaticMarkup(React.createElement(ApplyButton, {
    jobId: 'job-1', applyLink: GREENHOUSE, jobTitle: 'PMHNP', applyOnPlatform: false, sourceType: 'external',
    ...props,
  }));
}

describe('GFJ-03: applying requires an account; the employer link is for signed-in candidates only', () => {
  it('a signed-out visitor gets a button that opens the gate, never a link to the employer', () => {
    const html = renderApply({ isAuthenticated: false });
    expect(html).toContain('<button');
    expect(html).not.toContain(GREENHOUSE);
    expect(html).not.toContain('target="_blank"');
    // The label says where the application continues; never "Direct Apply".
    expect(html).toContain('Apply on employer site');
    expect(html).not.toContain('Direct Apply');
  });

  it('while the sign-in probe is pending the control is the same gated button', () => {
    const html = renderApply({});
    expect(html).toContain('<button');
    expect(html).not.toContain(GREENHOUSE);
  });

  it('a signed-in candidate gets a real link to the employer application, opening in a new tab', () => {
    const html = renderApply({ isAuthenticated: true });
    expect(html).toContain(`href="${GREENHOUSE}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="nofollow noopener"');
    expect(html).toContain('Apply on employer site');
    expect(html).not.toContain('Sign in to apply');
  });

  it('a signed-in mailto apply link opens the mail client, not a new tab', () => {
    const html = renderApply({ isAuthenticated: true, applyLink: 'mailto:jobs@acme.org', sourceType: 'employer' });
    expect(html).toContain('href="mailto:jobs@acme.org"');
    expect(html).not.toContain('target="_blank"');
  });

  it('an unsafe stored link never becomes an href, signed in or not', () => {
    for (const isAuthenticated of [true, false]) {
      const html = renderApply({ isAuthenticated, applyLink: 'javascript:alert(1)', sourceType: null });
      expect(html).not.toContain('javascript:');
      expect(html).toContain('Apply link unavailable');
    }
    expect(safeApplyHref('javascript:alert(1)')).toBeNull();
    expect(safeApplyHref('data:text/html,x')).toBeNull();
    expect(safeApplyHref('mailto:jobs@acme.org')).toBe('mailto:jobs@acme.org');
    expect(safeExternalHref('https://acme.com')).toBe('https://acme.com/');
  });

  it('Easy Apply is a button for everyone (the form opens only after sign in)', () => {
    const html = renderApply({ applyLink: null, applyOnPlatform: true, isAuthenticated: false });
    expect(html).toContain('Easy Apply');
    expect(html).toContain('<button');
  });

  it('the Apply button routes through resolveApplyStep: gate when signed out, held while unknown', () => {
    const start = APPLY_BUTTON.indexOf('const handleApply = () => {');
    const end = APPLY_BUTTON.indexOf('\n  };', start);
    expect(start).toBeGreaterThan(-1);
    const body = APPLY_BUTTON.slice(start, end);
    expect(body).toContain('const step = resolveApplyStep(stepInput);');
    expect(body).toMatch(/if \(step === 'auth-gate'\) \{\s*setShowAuthModal\(true\);\s*return;/);
    // The old "external jobs skip the gate" shortcut is gone.
    expect(APPLY_BUTTON).not.toMatch(/if \(!applyOnPlatform\) return;/);
    // The employer link is rendered only when canLinkToEmployer says so.
    expect(APPLY_BUTTON).toContain('const employerLinkHref = canLinkToEmployer(stepInput) ? externalHref : null;');
  });

  it('the external click is tracked and follows the real link; nothing opens a window from script', () => {
    const start = APPLY_BUTTON.indexOf('const handleExternalApplyClick = () => {');
    const end = APPLY_BUTTON.indexOf('\n  };', start);
    expect(start).toBeGreaterThan(-1);
    const body = APPLY_BUTTON.slice(start, end);
    expect(body).toContain('fireApplyClick();');
    expect(body).toMatch(/trackJobApply\([^;]*'external'\);/);
    expect(body).not.toContain('preventDefault');
    // The "did you finish applying" prompt still follows the click.
    expect(body).toContain('setAwaitingApplyConfirm(true)');
    expect(APPLY_BUTTON).not.toContain('window.open(');
  });

  it('the page fallback never links to the employer before hydration', () => {
    expect(PAGE).toContain('<Suspense fallback={<ApplyButtonPlaceholder');
    expect(PAGE).not.toMatch(/<a\s+href=\{href\}\s+\{\.\.\.externalApplyLinkProps\(href\)\}/);
  });
});

/* ─── CQ-11: employer facts, not boilerplate ────────────────────────────── */

const BOILERPLATE_RE = /is hiring for this|play a critical role|actively seeking qualified candidates/i;

function employerFacts(overrides: Partial<EmployerFacts> = {}): EmployerFacts {
  return {
    openRoles: 105,
    stateCount: 18,
    topStates: [{ name: 'Ohio', count: 14 }, { name: 'Texas', count: 9 }, { name: 'Florida', count: 7 }],
    postedPay: { min: 120000, max: 220000, listings: 40 },
    companyPath: '/companies/lifestance-health',
    ...overrides,
  };
}

describe('CQ-11: the About card', () => {
  it('prints the employer facts and links, never the old boilerplate', () => {
    const html = renderToStaticMarkup(React.createElement(AboutEmployer, {
      employerName: 'LifeStance Health', company: null, otherJobsCount: 104, facts: employerFacts(),
    }));
    expect(html).toContain('LifeStance Health has 105 open roles listed on');
    expect(html).toContain('They span 18 states, led by Ohio (14), Texas (9) and Florida (7).');
    expect(html).toContain('Employer-stated pay on 40 of these listings runs from $120k to $220k a year.');
    expect(html).toContain('href="/companies/lifestance-health"');
    expect(html).not.toMatch(BOILERPLATE_RE);
    expect(read('components/AboutEmployer.tsx')).not.toMatch(BOILERPLATE_RE);
  });

  it('renders nothing when the board holds no facts about the employer', () => {
    const html = renderToStaticMarkup(React.createElement(AboutEmployer, {
      employerName: 'Solo Clinic', company: null, otherJobsCount: 0,
      facts: employerFacts({ openRoles: 1, stateCount: 1, topStates: [{ name: 'Iowa', count: 1 }], postedPay: null, companyPath: null }),
    }));
    expect(html).toBe('');
  });

  it('one listing, or pay on one listing, is not a fact worth a sentence', () => {
    expect(buildEmployerFactSentences('Solo', employerFacts({ openRoles: 1 }))).toEqual({ roles: null, states: null, pay: null });
    expect(buildEmployerFactSentences('Acme', employerFacts({ stateCount: 1, topStates: [{ name: 'Iowa', count: 3 }] })).states)
      .toBe('Its listings here are in Iowa.');
  });

  it('summarizes states and employer-stated pay only (estimates excluded)', () => {
    const row = (state: string | null, min: number | null, max: number | null, salaryIsEstimated = false) => ({
      state, stateCode: null, normalizedMinSalary: min, normalizedMaxSalary: max, salaryIsEstimated,
    });
    const summary = summarizeEmployerRows([
      row('Ohio', 120000, 150000),
      row('Ohio', 130000, null),
      row('TX', 400000, 500000, true),
      row(null, null, null),
    ]);
    expect(summary.stateCount).toBe(2);
    expect(summary.topStates[0]).toEqual({ name: 'Ohio', count: 2 });
    expect(summary.postedPay).toEqual({ min: 120000, max: 150000, listings: 2 });
    expect(summarizeEmployerRows([row('Ohio', 120000, 150000)]).postedPay).toBeNull();
  });
});

describe('CQ-11: getEmployerFacts reads the canonical pool', () => {
  const count = prisma.job.count as unknown as ReturnType<typeof vi.fn>;
  const findMany = prisma.job.findMany as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    count.mockResolvedValue(3);
    findMany.mockResolvedValue([]);
  });

  it('links the company profile only for a real Company row with a live job', async () => {
    const real = await getEmployerFacts(
      { employer: 'Acme', companyId: 'c1' },
      { id: 'c1', name: 'Acme Health', normalizedName: 'acme' },
    );
    // The display-name slug, not the normalizedName form (/companies/acme answers a 308).
    expect(real.companyPath).toBe('/companies/acme-health');
    expect(real.openRoles).toBe(3);
    const synthesized = await getEmployerFacts(
      { employer: 'Acme', companyId: null },
      { id: 'employer-job-1', name: 'Acme', normalizedName: 'acme' },
    );
    expect(synthesized.companyPath).toBeNull();
    count.mockResolvedValue(0);
    const emptyProfile = await getEmployerFacts(
      { employer: 'Acme', companyId: null },
      { id: 'c2', name: 'Acme', normalizedName: 'acme' },
    );
    expect(emptyProfile.companyPath).toBeNull();
  });

  it('links the canonical display-name slug when it differs from the dedup key', async () => {
    const lifeStance = await getEmployerFacts(
      { employer: 'LifeStance Health', companyId: 'c3' },
      { id: 'c3', name: 'LifeStance Health', normalizedName: 'life stance' },
    );
    expect(lifeStance.companyPath).toBe('/companies/lifestance-health');
    expect(lifeStance.companyPath).not.toBe('/companies/life-stance');

    const oneMedical = await getEmployerFacts(
      { employer: 'One Medical', companyId: 'c4' },
      { id: 'c4', name: 'One Medical', normalizedName: 'one' },
    );
    expect(oneMedical.companyPath).toBe('/companies/one-medical');
  });

  it('builds the link through lib/company-slug, the resolver the profile route uses', () => {
    const src = read('app/jobs/[slug]/employer-facts.ts');
    expect(src).toContain("import { companyProfilePath } from '@/lib/company-slug';");
    expect(src).not.toMatch(/companyProfilePath\(company\.normalizedName\)/);
  });
});

describe('CQ-11: tips come from the posting', () => {
  it('no generic defaults: a job with no applicable fact gets no card', () => {
    expect(getApplicationTips({})).toEqual([]);
    expect(renderToStaticMarkup(React.createElement(ApplicationTipsCard, {}))).toBe('');
  });

  it('tips follow the verified mode, type, experience and license states', () => {
    const tips = getApplicationTips({ workMode: 'Remote', jobType: 'Locum Tenens', remoteStates: ['Texas'] });
    expect(tips.map((t) => t.text)).toEqual([
      'This remote role is open to applicants in Texas. Confirm your license there before you apply.',
      'Describe your telehealth experience: the platforms you have used, your visit volume and any virtual prescribing workflow.',
      'State your malpractice coverage and how quickly you can credential with new payers.',
    ]);
    expect(getApplicationTips({ minYearsExperience: 2 })[0].text).toContain('2+ years of experience');
    expect(getApplicationTips({ newGradFriendly: true })[0].text).toContain('New graduates are welcome');
  });

  it('the site-wide Career Pulse card is gone from the job page', () => {
    expect(PAGE).not.toContain('CareerPulseCard');
    expect(read('components/jobs/SidebarVisualCards.tsx')).not.toContain('CareerPulseCard');
  });
});

/* ─── Page wiring ───────────────────────────────────────────────────────── */

describe('job page wiring', () => {
  it('GFJ-01: the chip, tips and internal links read the verified work mode', () => {
    expect(PAGE).toContain('const workModeLabel = resolveWorkModeLabel(job);');
    expect(PAGE).toMatch(/\{workModeLabel && \(\s*<Badge variant="outline" size="md">\s*<Monitor size=\{12\} \/> \{workModeLabel\}/);
    expect(PAGE).not.toMatch(/\{job\.mode && \(\s*<Badge/);
    expect(PAGE).toContain('isRemote={isVerifiedRemote}');
  });

  it('GFJ-16: the visible posted date reads jobPostedAt, the datePosted field', () => {
    expect(PAGE).toContain('const freshness = getJobFreshness(jobPostedAt(job));');
    expect(PAGE).not.toContain('getJobFreshness(job.createdAt)');
  });

  it('"Last updated" is contentChangedAt, not the updatedAt write timestamp', () => {
    expect(PAGE).toMatch(/\{contentChangedAt && \(\s*<p className="mt-1">\s*Last updated:/);
    expect(PAGE).not.toMatch(/job\.updatedAt && \(/);
  });

  it('reads contentChangedAt from the typed Job row, with no cast', () => {
    expect(PAGE).toContain('const contentChangedAt = job.contentChangedAt ?? null;');
    expect(PAGE).not.toMatch(/as Job & \{ contentChangedAt/);
    expect(fs.readFileSync(path.join(process.cwd(), 'lib/types.ts'), 'utf8')).toContain('contentChangedAt?: Date | null;');
  });

  it('GFJ-08: the markup gets the Company row website and logo when the posting has none', () => {
    expect(PAGE).toContain('companyWebsite: job.companyWebsite || companyInfo?.website || null,');
    expect(PAGE).toContain('companyLogoUrl: job.companyLogoUrl || companyInfo?.logoUrl || null,');
    expect(PAGE).toMatch(/<JobStructuredData\s+job=\{schemaJob\}/);
  });

  it('M-04 / M-09: title and description come from the builders, not raw cuts', () => {
    expect(PAGE).not.toContain('.slice(0, 65)');
    expect(PAGE).not.toContain('.slice(0, 158)');
    expect(PAGE).toContain('buildJobPageTitle({ roleTitle, employer: job.employer, location: titleLocation })');
    // An over-budget title (a role kept whole) drops the brand template suffix.
    expect(PAGE).toContain('title: jobPageTitleMetadata(titleWithLocation),');
    expect(PAGE).toContain('const description = buildJobMetaDescription({');
  });

  it('CS-06: a dead-link job renders the closed shell, not the live page', () => {
    expect(PAGE).toContain("const reason: ClosedReason = anyJob.isPublished && !dateExpired ? 'unlisted' : 'expired';");
    expect(PAGE).toContain("badge: 'Position Closed'");
  });

  it('the hero links the company profile only when it exists', () => {
    expect(PAGE).toContain('{companyPath ? (');
    expect(PAGE).not.toContain('href={`/companies/${companyInfo.normalizedName}`}');
  });
});
