/**
 * Owner decision 2026-09 (package APPLY): applying requires an NP Hiring
 * account. It reverses the earlier "apply without an account" decision.
 *
 *   - Every Apply click by a signed-out visitor, on the job page or a job
 *     card, for an external ATS job or an Easy Apply job, opens the sign-up
 *     or log-in gate. Nothing reaches the employer's site or the Easy Apply
 *     form without an account. The job description stays readable.
 *   - The return trip (sign up, log in, the email confirmation, a resent
 *     confirmation) lands back on the same job with ?apply=1. There a
 *     signed-in candidate gets the Easy Apply form, or for an external job a
 *     "Continue to employer application" link. The link is real, so the new
 *     tab opens from their own click; nothing calls window.open.
 *   - An external ATS link is never labelled "Direct Apply". The wording says
 *     the application continues on the employer's site.
 *
 * The pure pieces (lib/apply-intent.ts) are covered in apply-intent.test.ts.
 * This file covers the surfaces that use them: the labels, the gate and the
 * continue panel, the job page's server fallback, the job card and the auth
 * pages.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt?: string }) => React.createElement('img', { alt: alt ?? '' }),
}));
vi.mock('@/lib/hooks/useAppliedJobs', () => ({
  default: () => ({ isApplied: () => false, markApplied: vi.fn(), getAppliedDate: () => null }),
}));
vi.mock('@/lib/hooks/useSavedJobs', () => ({
  default: () => ({ isSaved: () => false, saveJob: vi.fn(), removeJob: vi.fn() }),
}));
vi.mock('@/lib/hooks/useViewedJobs', () => ({
  useViewedJobs: () => ({ isViewed: () => false, markAsViewed: vi.fn(), isHydrated: true }),
}));
vi.mock('@/components/jobs/MessageEmployerModal', () => ({ default: () => null }));
vi.mock('@/components/InPlatformApplyForm', () => ({ default: () => null }));
vi.mock('@/lib/analytics', () => ({ trackJobApply: vi.fn(), trackJobClick: vi.fn() }));
vi.mock('@/components/analytics/ViewTrackers', () => ({ buildTrackedJobItem: (job: unknown) => job }));

import {
  APPLY_AGAIN_LABEL,
  APPLY_CTA_LABELS,
  CONTINUE_TO_EMPLOYER_LABEL,
  applyCtaLabel,
  cardApplyLabel,
  continueApplicationNote,
  resolveApplyRoute,
  type ApplyTarget,
} from '@/lib/direct-apply';
import * as directApply from '@/lib/direct-apply';
import { ApplyAuthGate, ApplyButtonPlaceholder, ContinueToEmployerPanel } from '@/components/ApplyButton';
import JobCard from '@/components/JobCard';
import type { Job } from '@/lib/types';
import { confirmLoginHref } from '@/app/auth/confirm/confirm-state';
import { renderJobCardHtml, type JobCardData } from '@/lib/utils/render-job-card';
import HowItWorksSidebar from '@/components/dashboard/HowItWorksSidebar';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const GREENHOUSE = 'https://job-boards.greenhouse.io/acme/jobs/5408840008';
const UNKNOWN_HOST = 'https://www.example-feed.com/click/123';
/** House style: no em dash, no en dash, no spaced hyphen in visible copy. */
const DASH_RE = /[–—]| - /;
const noop = (): void => undefined;

const target = (overrides: Partial<ApplyTarget>): ApplyTarget => ({
  applyLink: GREENHOUSE,
  sourceType: 'external',
  applyOnPlatform: false,
  ...overrides,
});

/* ─── Labels (lib/direct-apply.ts) ──────────────────────────────────────── */

describe('apply labels say where the application continues', () => {
  it('routes each job to one of four apply routes', () => {
    expect(resolveApplyRoute(target({ applyOnPlatform: true, applyLink: null }))).toBe('easy-apply');
    expect(resolveApplyRoute(target({}))).toBe('employer-site');
    expect(resolveApplyRoute(target({ applyLink: 'https://careers.acme.org/jobs/1' }))).toBe('employer-site');
    expect(resolveApplyRoute(target({ applyLink: UNKNOWN_HOST, sourceType: 'employer' }))).toBe('employer-site');
    expect(resolveApplyRoute(target({ applyLink: UNKNOWN_HOST }))).toBe('external');
    expect(resolveApplyRoute(target({ applyLink: null }))).toBe('none');
  });

  it('labels an ATS link "Apply on employer site", never "Direct Apply"', () => {
    expect(applyCtaLabel(target({}))).toBe('Apply on employer site');
    expect(applyCtaLabel(target({ applyLink: UNKNOWN_HOST }))).toBe('Apply Now');
    expect(applyCtaLabel(target({ applyOnPlatform: true, applyLink: null }))).toBe('Easy Apply');
    expect(applyCtaLabel(target({ applyLink: null }))).toBe('Apply link unavailable');
    expect(applyCtaLabel(target({}), { applied: true })).toBe(APPLY_AGAIN_LABEL);
    expect(applyCtaLabel(target({ applyLink: null }), { applied: true })).toBe('Apply link unavailable');
    for (const label of Object.values(APPLY_CTA_LABELS)) {
      expect(label).not.toMatch(/direct apply/i);
    }
    expect(read('lib/direct-apply.ts')).not.toMatch(/'Direct Apply'/);
    // The helpers that fed the old "Direct Apply" labels are gone.
    expect('isDirectApplyUrl' in directApply).toBe(false);
    expect('shouldLabelDirectApply' in directApply).toBe(false);
  });

  it('the card button is compact: "Easy Apply", "Apply", or nothing', () => {
    expect(cardApplyLabel(target({ applyOnPlatform: true, applyLink: null }))).toBe('Easy Apply');
    expect(cardApplyLabel(target({}))).toBe('Apply');
    expect(cardApplyLabel(target({ applyLink: UNKNOWN_HOST }))).toBe('Apply');
    expect(cardApplyLabel(target({ applyLink: null }))).toBeNull();
  });

  it('the continue note names the next step, and all of this copy follows the house style', () => {
    expect(CONTINUE_TO_EMPLOYER_LABEL).toBe('Continue to employer application');
    expect(continueApplicationNote('employer-site', false)).toBe("Your application continues on the employer's site, in a new tab.");
    expect(continueApplicationNote('external', false)).toBe('Your application continues on the site that listed this job, in a new tab.');
    expect(continueApplicationNote('employer-site', true)).toMatch(/opens your email app/);
    const copy = [
      ...Object.values(APPLY_CTA_LABELS),
      APPLY_AGAIN_LABEL,
      CONTINUE_TO_EMPLOYER_LABEL,
      continueApplicationNote('employer-site', false),
      continueApplicationNote('external', false),
      continueApplicationNote('external', true),
    ];
    for (const text of copy) expect(text, text).not.toMatch(DASH_RE);
  });
});

describe('no surface labels an external job "Direct Apply"', () => {
  const SURFACES = [
    'app/widget/route.ts',
    'lib/utils/render-job-card.ts',
    'app/api/email-preview/v2-templates.ts',
    'lib/inngest/functions/recommendation-digest.ts',
    'components/dashboard/HowItWorksSidebar.tsx',
    'app/for-job-seekers/page.tsx',
    'app/companies/page.tsx',
    'app/companies/[slug]/page.tsx',
  ];
  it.each(SURFACES)('%s has no Direct Apply or apply directly copy', (rel) => {
    expect(read(rel)).not.toMatch(/direct apply|apply directly/i);
  });

  it('the widget labels a non Easy Apply row "Apply on employer site" and keeps its class', () => {
    expect(read('app/widget/route.ts')).toContain('<span class="pd-btn pd-btn--direct">Apply on employer site</span>');
  });

  it('the digest badge for the direct_apply tier reads "Apply on employer site"', () => {
    const src = read('lib/inngest/functions/recommendation-digest.ts');
    expect(src).toContain("if (tier === 'direct_apply')");
    expect(src).toContain('↗ Apply on employer site</span>');
  });

  it('the preview catalog labels the employer sample the same way', () => {
    expect(read('app/api/email-preview/v2-templates.ts')).toContain("t === 'direct' ? 'Apply on employer site'");
  });
});

describe('the email job card (lib/utils/render-job-card.ts)', () => {
  const baseCard: JobCardData = {
    title: 'Nurse Practitioner', employer: 'Acme Health', location: 'Austin, TX',
    jobUrl: 'https://example.com/jobs/np-austin-tx-1',
  };

  it('labels an employer post "Apply on employer site", never "Direct Apply"', () => {
    const html = renderJobCardHtml({ ...baseCard, applyOnPlatform: false, sourceType: 'employer' }, 0, true);
    expect(html).toContain('Apply on employer site');
    expect(html).not.toContain('Direct Apply');
  });

  it('keeps Easy Apply and the generic external label', () => {
    expect(renderJobCardHtml({ ...baseCard, applyOnPlatform: true, sourceType: 'employer' }, 0, true)).toContain('⚡ Easy Apply');
    expect(renderJobCardHtml({ ...baseCard, applyOnPlatform: false, sourceType: 'external' }, 0, true)).toContain('Apply Now ↗');
  });

  it("widens Outlook's fixed-width VML button so the longer label fits", () => {
    const vmlWidth = (html: string): number => Number(/v-text-anchor:middle;width:(\d+)px;/.exec(html)?.[1]);
    const employer = renderJobCardHtml({ ...baseCard, applyOnPlatform: false, sourceType: 'employer' }, 0, true);
    const external = renderJobCardHtml({ ...baseCard, applyOnPlatform: false, sourceType: 'external' }, 0, true);
    expect(vmlWidth(external)).toBe(140);
    expect(vmlWidth(employer)).toBeGreaterThanOrEqual(200);
  });
});

describe('the dashboard "How this platform works" sidebar', () => {
  it('names the employer site route, says an account comes first, and never says "Direct Apply"', () => {
    const html = renderToStaticMarkup(React.createElement(HowItWorksSidebar));
    expect(html).toContain('↗ Apply on employer site');
    expect(html).toContain('After you sign in, the application continues on the employer&#x27;s own careers site.');
    expect(html).toContain('Easy Apply and employer site listings');
    expect(html).not.toMatch(/direct apply/i);
    expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(DASH_RE);
  });
});

/* ─── The gate and the continue panel (components/ApplyButton.tsx) ──────── */

describe('the sign-up or log-in gate', () => {
  it('offers sign up and sign in for an external job, and says it returns to the job', () => {
    const html = renderToStaticMarkup(React.createElement(ApplyAuthGate, {
      applyOnPlatform: false, onSignUp: noop, onSignIn: noop, onBack: noop,
    }));
    expect(html).toContain('Sign in to apply');
    expect(html).toContain('Create Free Account');
    expect(html).toContain('Sign In');
    expect(html).toContain('continue to the employer&#x27;s application');
    expect(html).toContain('We will bring you straight back to this job.');
    expect(html).not.toContain('href=');
    expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(DASH_RE);
  });

  it('explains Easy Apply sends the profile and resume', () => {
    const html = renderToStaticMarkup(React.createElement(ApplyAuthGate, {
      applyOnPlatform: true, onSignUp: noop, onSignIn: noop, onBack: noop,
    }));
    expect(html).toContain('Easy Apply sends your');
    expect(html).toContain('Create a free account or sign in to apply.');
  });

  it('the gate buttons go to /signup and /login with this job and ?apply=1 as the return path', () => {
    const src = read('components/ApplyButton.tsx');
    expect(src).toContain("window.location.href = authGateHref('login', buildReturnUrl());");
    expect(src).toContain("window.location.href = authGateHref('signup', buildReturnUrl());");
    expect(src).toMatch(/const buildReturnUrl = \(\): string =>\s*withApplyIntent\(window\.location\.pathname, window\.location\.search\)/);
  });
});

describe('the continue panel after the return trip', () => {
  it('is a real link to the employer application that opens in a new tab', () => {
    const html = renderToStaticMarkup(React.createElement(ContinueToEmployerPanel, {
      href: GREENHOUSE, note: continueApplicationNote('employer-site', false), onContinue: noop, onDismiss: noop,
    }));
    expect(html).toContain(`href="${GREENHOUSE}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="nofollow noopener"');
    expect(html).toContain('Continue to employer application');
    expect(html).toContain('Not now');
  });

  it('a mailto application opens the mail client instead', () => {
    const html = renderToStaticMarkup(React.createElement(ContinueToEmployerPanel, {
      href: 'mailto:jobs@acme.org', note: continueApplicationNote('employer-site', true), onContinue: noop, onDismiss: noop,
    }));
    expect(html).toContain('href="mailto:jobs@acme.org"');
    expect(html).not.toContain('target="_blank"');
  });

  it('?apply=1 shows the panel for a signed-in external job and opens Easy Apply otherwise; never window.open', () => {
    const src = read('components/ApplyButton.tsx');
    expect(src).toMatch(/if \(!hasApplyIntent\(searchParams\)\) return;/);
    expect(src).toMatch(/\} else if \(applyOnPlatform\) \{(?:\s*\/\/[^\n]*)*\s*postApplyClick\(jobId\);\s*setShowPlatformApply\(true\);\s*\} else \{\s*setShowContinuePanel\(true\);/);
    expect(src).toMatch(/<ContinueToEmployerPanel[\s\S]*?onContinue=\{handleExternalApplyClick\}/);
    expect(src).not.toContain('window.open(');
  });

  it('only the ApplyButton on screen acts on ?apply=1, so the click counts once and one modal opens', () => {
    // app/jobs/[slug]/page.tsx mounts two ApplyButtons (the desktop sidebar
    // and the mobile sticky bar) and CSS hides one; both read ?apply=1.
    const src = read('components/ApplyButton.tsx');
    expect(src).toContain('const rootRef = useRef<HTMLDivElement>(null);');
    expect(src).toContain('<div ref={rootRef} className="flex flex-col w-full">');
    // The check sits right after the latch and before the first branch, so
    // the hidden instance latches and then does nothing: no gate, no
    // postApplyClick, no Easy Apply modal, no continue panel.
    expect(src).toMatch(
      /const open = setTimeout\(\(\) => \{\s*autoOpened\.current = true;(?:\s*\/\/[^\n]*)*\s*if \(!isRenderedElement\(rootRef\.current\)\) return;(?:\s*\/\/[^\n]*)*\s*const clean = withoutApplyIntent\(window\.location\.pathname, window\.location\.search\);\s*if \(clean\) window\.history\.replaceState\(null, '', clean\);\s*if \(!authed\) \{/,
    );
    const start = src.indexOf('const open = setTimeout');
    const end = src.indexOf('return () => clearTimeout(open);', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const callback = src.slice(start, end);
    const check = callback.indexOf('if (!isRenderedElement(rootRef.current)) return;');
    expect(check).toBeGreaterThan(callback.indexOf('autoOpened.current = true;'));
    for (const action of ['setShowAuthModal(true);', 'postApplyClick(jobId);', 'setShowPlatformApply(true);', 'setShowContinuePanel(true);']) {
      expect(callback.indexOf(action), action).toBeGreaterThan(check);
    }
    // The check is used only there: a click is always on the visible one.
    expect(src.match(/isRenderedElement\(/g) ?? []).toHaveLength(1);
  });

  it('keeps apply click tracking: one helper, used by the click, the held click and the intent', () => {
    const src = read('components/ApplyButton.tsx');
    expect(src.match(/fetch\(`\/api\/jobs\/\$\{jobId\}\/track-apply`/g) ?? []).toHaveLength(1);
    expect(src).toContain('const fireApplyClick = () => postApplyClick(jobId);');
    // fireApplyClick (the Easy Apply button and the external link), the held
    // click resumed after the probe, and the ?apply=1 return: each counts
    // the click once.
    expect(src.match(/postApplyClick\(jobId\);/g) ?? []).toHaveLength(3);
    expect(src).toMatch(/\/\/ Platform apply: show inline form[\s\S]*?fireApplyClick\(\);\s*setShowPlatformApply\(true\);/);
  });
});

describe('the server fallback before hydration', () => {
  it('ApplyButtonPlaceholder is a GET form to /signup that returns to this job with ?apply=1', () => {
    const html = renderToStaticMarkup(React.createElement(ApplyButtonPlaceholder, {
      jobPath: '/jobs/pmhnp-austin-tx-1', applyLink: GREENHOUSE, applyOnPlatform: false, sourceType: 'external',
    }));
    expect(html).toContain('action="/signup"');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="redirectTo" value="/jobs/pmhnp-austin-tx-1?apply=1"');
    expect(html).toContain('Apply on employer site');
    expect(html).toContain('(create a free account or sign in to apply)');
    expect(html).not.toContain(GREENHOUSE);
    expect(html).not.toContain('Direct Apply');
  });

  it('labels Easy Apply the same way, and reserves the space when there is no way to apply', () => {
    const easy = renderToStaticMarkup(React.createElement(ApplyButtonPlaceholder, {
      jobPath: '/jobs/x', applyLink: null, applyOnPlatform: true, sourceType: 'employer',
    }));
    expect(easy).toContain('Easy Apply');
    expect(easy).toContain('value="/jobs/x?apply=1"');
    const none = renderToStaticMarkup(React.createElement(ApplyButtonPlaceholder, {
      jobPath: '/jobs/x', applyLink: 'javascript:alert(1)', applyOnPlatform: false, sourceType: null,
    }));
    expect(none).toBe('<div aria-hidden="true" style="min-height:52px;width:100%"></div>');
  });
});

/* ─── Job cards (components/JobCard.tsx) ────────────────────────────────── */

function makeJob(overrides: Partial<Job>): Job {
  const now = new Date('2026-09-20T12:00:00Z');
  return {
    id: 'job-1', title: 'Psychiatric Nurse Practitioner', slug: 'pmhnp-austin-tx-1', employer: 'Acme Health',
    location: 'Austin, TX', jobType: 'Full-Time', mode: 'On-site', experienceLevel: null,
    minYearsExperience: null, maxYearsExperience: null, newGradFriendly: false, experienceQualifier: null,
    experienceLabel: null, description: 'Role description.', descriptionSummary: 'Role summary.',
    salaryRange: null, minSalary: null, maxSalary: null, salaryPeriod: null, city: 'Austin', state: 'Texas',
    stateCode: 'TX', country: 'US', isRemote: false, isHybrid: false, normalizedMinSalary: null,
    normalizedMaxSalary: null, salaryIsEstimated: false, salaryConfidence: null, displaySalary: null,
    applyLink: GREENHOUSE, applyOnPlatform: false, isFeatured: false, isPublished: true,
    isVerifiedEmployer: false, sourceType: 'external', sourceProvider: 'greenhouse', sourceSite: null,
    externalId: null, originalPostedAt: now, viewCount: 0, applyClickCount: 0, createdAt: now,
    updatedAt: now, expiresAt: null, companyId: null,
    ...overrides,
  } as Job;
}

const renderCard = (job: Job, viewMode: 'grid' | 'list'): string =>
  renderToStaticMarkup(React.createElement(JobCard, { job, viewMode }));

describe('job cards send every Apply through the job page gate', () => {
  it('an external job shows "Apply" (full name "Apply on employer site") and never links to the employer', () => {
    for (const viewMode of ['grid', 'list'] as const) {
      const html = renderCard(makeJob({}), viewMode);
      expect(html, viewMode).toContain('aria-label="Apply on employer site"');
      expect(html, viewMode).toContain('>Apply</button>');
      expect(html, viewMode).not.toContain(`href="${GREENHOUSE}"`);
      expect(html, viewMode).not.toContain('Direct Apply');
      expect(html, viewMode).not.toContain('jc-direct-apply-btn');
    }
  });

  it('an Easy Apply job shows Easy Apply; a job with an unsafe link shows no Apply button', () => {
    const easy = renderCard(makeJob({ applyOnPlatform: true, applyLink: null, sourceType: 'employer' }), 'grid');
    expect(easy).toContain('jc-easy-apply-btn');
    expect(easy).toContain('Easy Apply');
    const unsafe = renderCard(makeJob({ applyLink: 'javascript:alert(1)' }), 'list');
    expect(unsafe).not.toContain('class="jc-apply-btn"');
    expect(unsafe).not.toContain('javascript:');
  });

  it('both Apply buttons, in both layouts, push the job page with ?apply=1 and never open a window', () => {
    const src = read('components/JobCard.tsx');
    expect(src).toContain('const applyIntentUrl = withApplyIntent(jobUrl) ?? jobUrl;');
    expect(src).toMatch(/const handleApplyClick = \(e: React\.MouseEvent\) => \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*markAsViewed\(jobSlug\);\s*trackListClick\(\);\s*router\.push\(applyIntentUrl\);/);
    expect(src.match(/onClick=\{handleApplyClick\}/g) ?? []).toHaveLength(4);
    expect(src).not.toContain('window.open(');
  });
});

/* ─── The return trip through the auth pages ────────────────────────────── */

describe('the return trip keeps the job', () => {
  it('a failed confirmation sends the visitor to log in with the explicit ?next= kept', () => {
    expect(confirmLoginHref('/jobs/x?apply=1', true)).toBe('/login?redirectTo=%2Fjobs%2Fx%3Fapply%3D1');
    expect(confirmLoginHref('/onboarding/professional', false)).toBe('/login');
  });

  it('/auth/confirm uses that login target on every fallback, and carries ?next= into a resend', () => {
    const src = read('app/auth/confirm/page.tsx');
    expect(src).toContain('loginHref = confirmLoginHref(nextPath, hasExplicitNext)');
    expect(src).not.toContain("router.push('/login')");
    expect(src.match(/router\.push\(loginHref\)/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(src).toContain('body: JSON.stringify({ email, next: explicitNextFromUrl() })');
    expect(src).toContain("authGateHref('login', explicitNextFromUrl())");
  });

  it('sign up stashes the return path in the auth metadata for a confirmation link without ?next=', () => {
    const src = read('components/auth/SignUpForm.tsx');
    expect(src).toContain('[SIGNUP_RETURN_METADATA_KEY]: redirectTo ?? null,');
    expect(src).toContain("authSwitchHref('login', { redirectTo, employer: role === 'employer' })");
    expect(src).toContain('body: JSON.stringify({ email, next: redirectTo })');
  });

  it('switching between log in and sign up keeps the job', () => {
    const src = read('components/auth/LoginContent.tsx');
    expect(src).toContain("authSwitchHref('signup', { redirectTo, employer: role === 'employer' })");
    expect(src).toContain('body: JSON.stringify({ email, next: redirectTo })');
  });

  it('a signed-in visitor sent to /signup or /login goes straight on to ?redirectTo= or ?next=', () => {
    for (const page of ['app/signup/page.tsx', 'app/login/page.tsx']) {
      expect(read(page), page).toContain("safeInternalPath(params.redirectTo || params.next, '/dashboard')");
    }
  });

  it('the apply wording on the auth forms follows the house style', () => {
    const copy = [
      'Applying takes a free account. We will bring you back to the job when you are done.',
      'Open the link in that email and we will take you back to the job you were applying for.',
    ];
    const signUp = read('components/auth/SignUpForm.tsx');
    for (const text of copy) {
      expect(signUp).toContain(text);
      expect(text).not.toMatch(DASH_RE);
    }
    const login = 'Sign in to continue your application. We will bring you back to the job.';
    expect(read('components/auth/LoginContent.tsx')).toContain(login);
    expect(login).not.toMatch(DASH_RE);
  });
});
