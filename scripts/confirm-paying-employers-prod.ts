/**
 * One-off for the admin update's deploy (owner, 2026-11-26, option (b)): confirm every employer
 * identity that an account has live paid posts under, so the Verified employer check stays on
 * their posts when the first twin sync after the deploy decides it from confirmations.
 *
 * It applies the same rule as Admin, Verify Employers (lib/admin/employer-verification.ts): each
 * confirmation goes through setEmployerVerification, which refuses a name the account never posted
 * under, so an account with no provable domain (a free-mail sign-in) stays unconfirmed, as it
 * would by hand. Each confirmation writes the same audit entry the admin page writes, with the
 * actor recorded as the system.
 *
 * Run it after the deploy's migrations (they add user_profiles.verified_employer_org_keys) and
 * before the next hourly refresh-site-stats run, which applies the confirmations to the posts.
 *
 * Dry run by default. It prints counts only: no email, name or id. --apply writes, and only when
 * CONFIRM_PROD=yes is set.
 *
 *   npx tsx scripts/confirm-paying-employers-prod.ts
 *   CONFIRM_PROD=yes npx tsx scripts/confirm-paying-employers-prod.ts --apply
 */
import { createHash } from 'node:crypto';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.prod' });
if (process.env.PROD_DATABASE_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
if (process.env.PROD_DIRECT_DATABASE_URL && !process.env.DIRECT_URL) process.env.DIRECT_URL = process.env.PROD_DIRECT_DATABASE_URL;

// Required after the env is set: these modules open the database client when they load, and ESM
// imports would be hoisted above the dotenv call.
/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('@/lib/prisma') as typeof import('@/lib/prisma');
const { loadVerificationQueue, setEmployerVerification } = require('@/lib/admin/employer-verification') as typeof import('@/lib/admin/employer-verification');
const { logAudit } = require('@/lib/audit-log') as typeof import('@/lib/audit-log');
/* eslint-enable @typescript-eslint/no-require-imports */

const APPLY = process.argv.includes('--apply');

/** Names the database without printing it: a short hash of its user and host. */
function databaseTag(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    return createHash('sha256').update(`${url.username}@${url.hostname}`).digest('hex').slice(0, 8);
  } catch {
    return 'unreadable';
  }
}

async function main(): Promise<void> {
  console.log(`database ${databaseTag()}; ${APPLY ? 'APPLY' : 'dry run'}`);
  const queue = await loadVerificationQueue(new Date());
  const identities = queue.flatMap((account) => account.identities.map((identity) => ({ account, identity })));
  const paying = identities.filter(({ identity }) => identity.livePaidPosts > 0);
  const toConfirm = paying.filter(({ identity }) => !identity.verified);
  const accounts = new Set(toConfirm.map(({ account }) => account.supabaseId));
  console.log(`accounts in the queue: ${queue.length}; identities with live paid posts: ${paying.length}; already confirmed: ${paying.length - toConfirm.length}; to confirm: ${toConfirm.length} across ${accounts.size} account(s)`);

  if (!APPLY) {
    console.log('dry run: nothing written (pass --apply with CONFIRM_PROD=yes to write)');
    return;
  }
  if (process.env.CONFIRM_PROD !== 'yes') {
    console.log('refused: CONFIRM_PROD=yes is not set');
    process.exitCode = 1;
    return;
  }

  let confirmed = 0;
  let refused = 0;
  for (const { account, identity } of toConfirm) {
    const change = await setEmployerVerification(account.supabaseId, identity.orgKey, true);
    if (!change.ok) {
      refused += 1;
      continue;
    }
    confirmed += 1;
    await logAudit({
      action: 'admin.employer.verify',
      actorType: 'system',
      actorId: null,
      targetType: 'user_profile',
      targetId: account.supabaseId,
      metadata: { orgKey: identity.orgKey, reason: 'paying employer kept its Verified check at the admin update deploy' },
    });
  }
  console.log(`confirmed: ${confirmed}; refused: ${refused} (a name the account never posted under, or a removed account)`);
}

main()
  .catch((err: unknown) => {
    console.error('failed:', err instanceof Error ? err.message.split('\n')[0] : 'unknown error');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
