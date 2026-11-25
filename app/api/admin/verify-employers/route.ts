/**
 * /api/admin/verify-employers
 *
 * Confirm or revoke that an employer account speaks for a business it posted
 * as (lib/admin/employer-verification.ts says what waits on this).
 *
 *   POST { supabaseId, orgKey, verified } -> 200 { success, verifiedEmployerOrgKeys, twins, syncFailed }
 *
 * The twin sync runs right after the change, so a confirmation hides the
 * copies and adds the Verified employer check (and a revocation undoes both)
 * now rather than at the next hourly run. A failed sync is reported, not
 * fatal: the change is saved and the hourly run applies it.
 *
 * Auth: requireApiAdminActor, which answers JSON 401/403/429 for fetch
 * callers and names the admin for the audit entry. CSRF: middleware.ts gates
 * every mutating /api route, and this route checks again.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAdminActor } from '@/lib/auth/require-api-admin';
import { verifyCsrf } from '@/lib/csrf';
import { logAudit } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { revalidateJobPage } from '@/lib/job-page-revalidation';
import { setEmployerVerification, type VerificationChange } from '@/lib/admin/employer-verification';
import { syncPaidPostTwins, type TwinSyncResult } from '@/lib/paid-post-twins-sync';

export const dynamic = 'force-dynamic';

const BODY = z.object({
  supabaseId: z.string().trim().min(1).max(64),
  orgKey: z.string().trim().regex(/^[a-z0-9]{1,120}$/, 'Invalid employer key'),
  verified: z.boolean(),
});

const LOG_CONTEXT = 'Admin Verify Employers';

function fail(error: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}

async function readBody(req: NextRequest): Promise<z.infer<typeof BODY> | string> {
  try {
    return BODY.parse(await req.json());
  } catch (err) {
    return err instanceof z.ZodError ? err.issues.map((issue) => issue.message).join('; ') : 'Invalid JSON body';
  }
}

/** Applies the change at once. A failure is logged and reported; the hourly sync applies it later. */
async function syncNow(): Promise<TwinSyncResult | null> {
  try {
    const twins = await syncPaidPostTwins();
    for (const slug of twins.changedPostSlugs) revalidateJobPage(slug, LOG_CONTEXT);
    return twins;
  } catch (err) {
    logger.error(`[${LOG_CONTEXT}] twin sync after a verification change failed`, err);
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { error: authError, actor } = await requireApiAdminActor(req);
  if (authError) return authError;

  const csrfError = verifyCsrf(req);
  if (csrfError) return csrfError;

  const input = await readBody(req);
  if (typeof input === 'string') return fail(input, 400);

  let change: VerificationChange;
  try {
    change = await setEmployerVerification(input.supabaseId, input.orgKey, input.verified);
  } catch (err) {
    logger.error(`[${LOG_CONTEXT}] could not save a verification`, err, { supabaseId: input.supabaseId });
    return fail('Could not save the change. Try again.', 500);
  }
  if (!change.ok) return fail(change.error, change.status);

  // Awaited so the entry is written before the response; logAudit never throws.
  await logAudit({
    action: input.verified ? 'admin.employer.verify' : 'admin.employer.unverify',
    actorType: 'admin',
    actorId: actor.profileId,
    targetType: 'user_profile',
    targetId: input.supabaseId,
    metadata: { orgKey: input.orgKey },
  });

  const twins = await syncNow();
  return NextResponse.json({
    success: true,
    verifiedEmployerOrgKeys: change.verifiedEmployerOrgKeys,
    twins: twins && { shadowed: twins.shadowed, newlyShadowed: twins.newlyShadowed, released: twins.released },
    syncFailed: twins === null,
  });
}
