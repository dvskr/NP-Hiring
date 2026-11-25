/**
 * /admin/verify-employers
 *
 * Confirm that an employer account speaks for the business it posted as.
 * Until it is confirmed, the account's posts carry no Verified employer check
 * and its paid post leaves that business's free listings up (see
 * lib/admin/employer-verification.ts). The refresh-site-stats cron posts a
 * daily Discord reminder while paid posts are waiting here.
 *
 * Separate from Profile Claims (/admin/company-claims), which verifies a
 * claim on a company profile.
 *
 * Auth: app/admin/layout.tsx's requireAdmin(), and again here, because a
 * client navigation between admin pages renders this page without
 * re-running the shared layout.
 */
import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/protect';
import { logger } from '@/lib/logger';
import { loadVerificationQueue, type VerificationAccount } from '@/lib/admin/employer-verification';
import VerifyEmployersClient from './VerifyEmployersClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verify Employers | Admin',
  robots: { index: false, follow: false },
};

const LOAD_ERROR = 'The verification queue could not be loaded. Reload the page to try again.';

async function readQueue(): Promise<{ accounts: VerificationAccount[]; loadError: string | null }> {
  try {
    return { accounts: await loadVerificationQueue(new Date()), loadError: null };
  } catch (error) {
    logger.error('[Admin Verify Employers] could not load the queue', error);
    return { accounts: [], loadError: LOAD_ERROR };
  }
}

export default async function VerifyEmployersPage() {
  await requireAdmin('/admin/verify-employers');
  const { accounts, loadError } = await readQueue();
  return <VerifyEmployersClient accounts={accounts} loadError={loadError} />;
}
