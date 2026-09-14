/**
 * P10 employer-post-job regressions:
 *   - an empty step-2 submit showed raw zod copy ("Invalid option: expected
 *     one of ...", "Invalid input: expected number, received undefined")
 *   - a server draft restored on /post-job never raised the "Resumed your
 *     unfinished post" banner, and the first echo autosave would have
 *     dismissed it anyway
 *   - the /post-job/preview action bar relied on position: sticky, which the
 *     global body overflow-x: hidden disables, so it sat below the fold at 375px
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  jobPostingSchema,
  WORK_MODE_REQUIRED_MESSAGE,
  JOB_TYPE_REQUIRED_MESSAGE,
  EXPERIENCE_REQUIRED_MESSAGE,
} from '@/app/post-job/_lib/job-posting-schema';
import {
  hasMeaningfulDraftContent,
  isSameDraftContent,
  shouldDismissResumeBanner,
} from '@/app/post-job/_lib/draft-hydration';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const STEP2_FIELDS = ['location', 'mode', 'jobType', 'minYearsExperience'] as const;

function step2Messages(input: Record<string, unknown>): Record<string, string> {
  const result = jobPostingSchema.safeParse({ pricingTier: 'pro', ...input });
  if (result.success) return {};
  return result.error.issues.reduce<Record<string, string>>((acc, issue) => {
    const key = String(issue.path[0]);
    return STEP2_FIELDS.includes(key as (typeof STEP2_FIELDS)[number]) && !acc[key]
      ? { ...acc, [key]: issue.message }
      : acc;
  }, {});
}

describe('step 2 validation copy', () => {
  it('an empty submit gives human messages for every required step 2 field', () => {
    const messages = step2Messages({ location: '' });
    expect(messages).toEqual({
      location: 'Location is required',
      mode: WORK_MODE_REQUIRED_MESSAGE,
      jobType: JOB_TYPE_REQUIRED_MESSAGE,
      minYearsExperience: EXPERIENCE_REQUIRED_MESSAGE,
    });
    expect(EXPERIENCE_REQUIRED_MESSAGE).toBe('Please select an experience level');
  });

  it('an unpicked radio group arriving as null still reads as human copy', () => {
    const messages = step2Messages({ location: 'Austin, TX', mode: null, jobType: null, minYearsExperience: null });
    expect(messages.mode).toBe(WORK_MODE_REQUIRED_MESSAGE);
    expect(messages.jobType).toBe(JOB_TYPE_REQUIRED_MESSAGE);
    expect(messages.minYearsExperience).toBe(EXPERIENCE_REQUIRED_MESSAGE);
  });

  it('never surfaces zod default wording, off-registry values included', () => {
    const messages = step2Messages({ mode: 'Anywhere', jobType: 'Gig', minYearsExperience: 3 });
    for (const text of Object.values(messages)) {
      expect(text).not.toMatch(/invalid|expected|received/i);
      expect(text).not.toMatch(/[–—]/);
    }
    expect(messages.minYearsExperience).toBe(EXPERIENCE_REQUIRED_MESSAGE);
  });

  it('valid step 2 values raise no step 2 issues', () => {
    expect(step2Messages({ location: 'Austin, TX', mode: 'Remote', jobType: 'Full-Time', minYearsExperience: 2, maxYearsExperience: 4 }))
      .toEqual({});
  });

  it('the wizard page consumes the shared schema instead of an inline copy', () => {
    const page = read('app/post-job/page.tsx');
    expect(page).toContain("from './_lib/job-posting-schema'");
    expect(page).not.toMatch(/z\.object\(/);
  });
});

describe('resume banner hydration', () => {
  const restored = { title: 'Psychiatric NP opening draft', contactEmail: 'hiring@clinic.example', description: '' };

  it('treats typed content as a meaningful draft and bare defaults as not', () => {
    expect(hasMeaningfulDraftContent(restored)).toBe(true);
    expect(hasMeaningfulDraftContent({ description: '<p><br></p>', pricingTier: 'pro' })).toBe(false);
    expect(hasMeaningfulDraftContent(null)).toBe(false);
  });

  it('compares content independent of key order and undefined members', () => {
    expect(isSameDraftContent({ a: 1, b: 'x', c: undefined }, { b: 'x', a: 1 })).toBe(true);
    expect(isSameDraftContent({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('an autosave that echoes the restored draft keeps the banner', () => {
    const echo = { description: '<p><br></p>', contactEmail: 'hiring@clinic.example', title: 'Psychiatric NP opening draft' };
    expect(shouldDismissResumeBanner(restored, echo)).toBe(false);
  });

  it('an employer edit dismisses the banner; no restore means nothing to protect', () => {
    expect(shouldDismissResumeBanner(restored, { ...restored, title: 'Psychiatric NP opening draft v2' })).toBe(true);
    expect(shouldDismissResumeBanner(null, restored)).toBe(true);
  });

  it('every restore path (token, server draft, localStorage) marks the draft restored', () => {
    const page = read('app/post-job/page.tsx');
    expect(page.match(/markRestored\((formData|parsedData)\)/g)).toHaveLength(3);
    // The sign-in email must never overwrite a restored draft's contact email.
    expect(page).toMatch(/user\.email && !getValues\('contactEmail'\)/);
  });
});

describe('/post-job/preview action bar', () => {
  it('does not depend on position: sticky and is fixed above the BottomNav below md', () => {
    const preview = read('app/post-job/preview/page.tsx');
    expect(preview).not.toMatch(/position:\s*'sticky'/);
    expect(preview).toContain('className="preview-action-bar"');
    expect(preview).toMatch(/@media \(max-width: 767\.98px\)\s*\{[\s\S]*?\.preview-action-bar\s*\{[\s\S]*?position: fixed;/);
  });
});
