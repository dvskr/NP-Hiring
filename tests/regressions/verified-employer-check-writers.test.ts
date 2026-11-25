/**
 * The "Verified employer" check says an operator confirmed the account is the
 * employer it named (/admin/verify-employers), never only that it posted or
 * paid: a check given on payment also appeared on a post typed under a
 * rival's name. lib/paid-post-twins-sync.ts is the one writer for employer
 * posts, so no posting, checkout, activation or renewal path may set it.
 *
 * Comments are blanked before matching (tests/helpers/source.ts), so a note
 * explaining why a path leaves the check alone does not count as a write.
 */
import { describe, it, expect } from 'vitest';
import { readCode, sourceFilesUnder } from '../helpers/source';

const POSTING_AND_PAYMENT_PATHS = [
  'app/api/jobs/post-free/route.ts',
  'app/api/create-checkout/route.ts',
  'app/api/webhooks/stripe/activate-paid-job.ts',
  'app/api/webhooks/stripe/apply-renewal.ts',
];

describe('only the twin sync gives employer posts the Verified employer check', () => {
  it.each(POSTING_AND_PAYMENT_PATHS)('%s never touches isVerifiedEmployer', (file) => {
    expect(readCode(file)).not.toMatch(/\bisVerifiedEmployer\b/);
  });

  it('no raw SQL outside the sync writes is_verified_employer', () => {
    const writers = sourceFilesUnder(['app', 'lib'])
      .filter((file) => /\bis_verified_employer\s*=/.test(readCode(file)));
    expect(writers).toEqual(['lib/paid-post-twins-sync.ts']);
  });

  it('the post-job preview does not promise the check', () => {
    const preview = readCode('app/post-job/preview/page.tsx');
    expect(preview).not.toMatch(/isVerifiedEmployer:\s*true/);
    expect(preview).not.toContain('Verified Employer');
  });
});
