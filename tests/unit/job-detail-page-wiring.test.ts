/**
 * Indexing audit 2026-09, job page package, fix round 3: how the job detail
 * page wires the verified facts into what it renders.
 *
 *   GFJ-01  InternalLinks offers "More Remote ... Jobs" only for a verified
 *           remote job and receives the verified mode, never job.mode.
 *   H-03    the tips, the internal links and the OG card read the resolved
 *           employment type, the one the chip and employmentType show.
 *   GFJ-03  owner decision 2026-09: applying requires an account. Before
 *           hydration the apply control is the shared sign-up form, never a
 *           link to the employer; the description needs no account.
 */
import { describe, it, expect, vi } from 'vitest';
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

import InternalLinks from '@/components/InternalLinks';
import { ApplyButtonPlaceholder } from '@/components/ApplyButton';
import { resolveWorkModeLabel, type JobPostingFactsInput } from '@/app/jobs/[slug]/job-posting-facts';

const PAGE = fs.readFileSync(path.join(process.cwd(), 'app/jobs/[slug]/page.tsx'), 'utf8');

/** The props the page passes to one JSX element, e.g. `<InternalLinks ... />`. */
function elementSource(tag: string): string {
  const start = PAGE.indexOf(`<${tag}`);
  expect(start, tag).toBeGreaterThan(-1);
  return PAGE.slice(start, PAGE.indexOf('/>', start));
}

/* ─── GFJ-01: internal links read the verified work mode ────────────────── */

describe('GFJ-01: InternalLinks never calls an on-site job remote', () => {
  const REMOTE_LINK = 'href="/jobs/remote"';

  it('a stale "Remote" mode without the verified flag offers no remote link', () => {
    const html = renderToStaticMarkup(React.createElement(InternalLinks, { state: 'Illinois', isRemote: false, mode: 'Remote' }));
    expect(html).not.toContain(REMOTE_LINK);
    expect(html).not.toContain('More Remote');
    expect(html).toContain('href="/jobs/state/illinois"');
  });

  it('a verified remote job offers the remote link', () => {
    const html = renderToStaticMarkup(React.createElement(InternalLinks, { isRemote: true, mode: 'Remote' }));
    expect(html).toContain(REMOTE_LINK);
  });

  it('the Compass on-site row with a stale remote flag resolves no remote mode, so the page passes no remote signal', () => {
    // Live GFJ-01 sample: an in-person Chicago job whose row still says
    // isRemote. The page passes isRemote={isVerifiedRemote} and
    // mode={workModeLabel}; neither says remote for it.
    const compass: JobPostingFactsInput = {
      title: 'Psychiatric Nurse Practitioner - Evenings',
      employer: 'Compass Health Center',
      description: 'Provide in-person psychiatric evaluation at our Chicago clinic. This role is on-site.',
      location: 'Chicago, Illinois, United States',
      mode: 'In-Person',
      isRemote: true,
      isHybrid: false,
      city: 'Chicago',
      state: 'Illinois',
      stateCode: 'IL',
      country: 'US',
    };
    const workModeLabel = resolveWorkModeLabel(compass);
    expect(workModeLabel).not.toBe('Remote');
    const html = renderToStaticMarkup(React.createElement(InternalLinks, {
      state: compass.state, isRemote: workModeLabel === 'Remote', mode: workModeLabel,
    }));
    expect(html).not.toContain(REMOTE_LINK);
  });

  it('the page wires the verified mode and flag, never job.mode or job.isRemote', () => {
    const links = elementSource('InternalLinks');
    expect(links).toContain('isRemote={isVerifiedRemote}');
    expect(links).toContain('mode={workModeLabel}');
    expect(links).not.toMatch(/mode=\{job\.mode\}|isRemote=\{job\.isRemote\}/);
    expect(PAGE).toContain("const isVerifiedRemote = workModeLabel === 'Remote';");
  });

  it('InternalLinks reads no mode string for the remote link', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/InternalLinks.tsx'), 'utf8');
    const remoteBlock = src.slice(src.indexOf('// Remote jobs link'), src.indexOf("href: '/jobs/remote'"));
    expect(remoteBlock).toContain('if (isRemote) {');
    expect(remoteBlock).not.toMatch(/mode\?/);
  });
});

/* ─── H-03: one resolved employment type everywhere ─────────────────────── */

describe('H-03: the page reads the resolved employment types, not the raw column', () => {
  it('computes them once and derives the chip label and the primary type from them', () => {
    expect(PAGE).toContain('const employmentTypes = resolveEmploymentTypes(job);');
    expect(PAGE).toContain('const jobTypeLabel = employmentTypeLabel(employmentTypes);');
    expect(PAGE).toContain('const primaryJobType = employmentTypes[0] ?? null;');
  });

  it('the tips and the internal links get the primary resolved type', () => {
    expect(elementSource('ApplicationTipsCard')).toContain('jobType={primaryJobType}');
    expect(elementSource('InternalLinks')).toContain('jobType={primaryJobType}');
  });

  it('the meta description and the OG card use the chip label', () => {
    expect(PAGE).toContain('jobType: jobTypeLabel,');
    expect(PAGE).toContain("if (jobTypeLabel) ogImageUrl.searchParams.set('jobType', jobTypeLabel);");
    expect(PAGE).not.toContain("ogImageUrl.searchParams.set('jobType', job.jobType)");
  });
});

/* ─── GFJ-03: the server-rendered apply control ─────────────────────────── */

const JOB_PATH = '/jobs/psychiatric-nurse-practitioner-11111111-2222-3333-4444-555555555555';
const GREENHOUSE = 'https://job-boards.greenhouse.io/acme/jobs/5408840008';

describe('GFJ-03: before hydration, Apply leads to sign-up, never to the employer', () => {
  it('an external job: a GET form to /signup that returns to this job with the apply intent', () => {
    const html = renderToStaticMarkup(React.createElement(ApplyButtonPlaceholder, {
      jobPath: JOB_PATH, applyLink: GREENHOUSE, applyOnPlatform: false, sourceType: 'external',
    }));
    expect(html).toContain('action="/signup"');
    expect(html).toContain(`value="${JOB_PATH}?apply=1"`);
    expect(html).not.toContain('greenhouse.io');
    expect(html).not.toContain('<a ');
  });

  it('an Easy Apply job: the same sign-up step', () => {
    const html = renderToStaticMarkup(React.createElement(ApplyButtonPlaceholder, {
      jobPath: JOB_PATH, applyLink: null, applyOnPlatform: true, sourceType: 'employer',
    }));
    expect(html).toContain('action="/signup"');
    expect(html).toContain('Easy Apply');
  });

  it('the page uses the shared placeholder in both Suspense boundaries and keeps no employer-link fallback', () => {
    expect(PAGE).toContain("import ApplyButton, { ApplyButtonPlaceholder } from '@/components/ApplyButton';");
    expect(PAGE).not.toContain('function ApplyButtonPlaceholder(');
    const fallbacks = PAGE.match(
      /<Suspense fallback=\{<ApplyButtonPlaceholder jobPath=\{canonicalJobPath\} applyLink=\{job\.applyLink\} applyOnPlatform=\{job\.applyOnPlatform\} sourceType=\{job\.sourceType\} \/>\}>/g,
    ) ?? [];
    expect(fallbacks).toHaveLength(2);
    expect(PAGE).not.toMatch(/externalApplyLinkProps|safeApplyHref\(|shouldLabelDirectApply/);
    expect(PAGE).toContain('const canonicalJobPath = new URL(canonicalJobUrl).pathname;');
  });

  it('the job description is rendered with no account check around it', () => {
    const description = PAGE.slice(PAGE.indexOf('About this role'), PAGE.indexOf('{/* Salary Comparison Widget'));
    expect(description).toContain('job.description');
    expect(description).not.toMatch(/authed|isAuthenticated|getCurrentUser|cookies\(\)/);
  });
});
