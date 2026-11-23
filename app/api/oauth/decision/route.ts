import { NextRequest, NextResponse } from 'next/server';
import { brand } from '@/config/brand';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { verifyCsrf } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { readJsonObject } from '@/lib/request-body';
import { ensureProfileFromAuth } from '@/lib/auth/ensure-profile';
import { decideAuthorization, type DecidingUser } from '@/lib/mcp/oauth/consent';
import { logger } from '@/lib/logger';

/**
 * POST /api/oauth/decision
 * Body: { requestId: string, decision: 'approve' | 'deny', expectedUserId: string }
 *
 * The consent page's Allow / Cancel. Authenticated by the session cookie,
 * which is ambient authority, so this route is stricter than the site-wide
 * origin check: the request must be JSON (a cross-site form or a text/plain
 * fetch cannot be) from this exact host, not merely a first-party one, and
 * it must come from the account the page was shown to, so a tab left open
 * while someone signed in as another account cannot approve for the wrong
 * one. Answers { redirectTo } for the page to navigate to.
 */

/** Same host, JSON body. Unforgeable from another site, and stricter than the first-party allowlist. */
function isOwnOriginJson(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host || !/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;
  if (!isOwnOriginJson(request)) {
    return NextResponse.json({ error: `Forbidden: send this from the ${brand.name} consent page.` }, { status: 403 });
  }

  const limited = await rateLimit(request, 'oauth-decision', { limit: 30, windowSeconds: 60 });
  if (limited) return limited;

  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const { requestId, decision, expectedUserId } = body as {
    requestId?: unknown;
    decision?: unknown;
    expectedUserId?: unknown;
  };
  if (typeof requestId !== 'string' || typeof expectedUserId !== 'string' || (decision !== 'approve' && decision !== 'deny')) {
    return NextResponse.json({ error: 'requestId, expectedUserId and a decision of approve or deny are required.' }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Your session ended. Sign in again to continue.' }, { status: 401 });
    }
    if (user.id !== expectedUserId) {
      return NextResponse.json(
        { error: 'You are now signed in as a different account. Reload this page to continue as that account.', code: 'account_changed' },
        { status: 409 },
      );
    }

    const deciding = await decidingUser(user);
    if (!deciding) {
      return NextResponse.json({ error: 'This account cannot be connected right now.' }, { status: 403 });
    }

    const outcome = await decideAuthorization({ requestId, approve: decision === 'approve', user: deciding });
    if (outcome.kind === 'error') {
      return NextResponse.json({ error: outcome.message, code: outcome.code }, { status: outcome.status });
    }
    return NextResponse.json({ redirectTo: outcome.location }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logger.error('OAuth consent decision failed', error);
    return NextResponse.json({ error: 'Something went wrong. Go back to the app and connect again.' }, { status: 500 });
  }
}

/**
 * The profile the decision is made for, read without side effects.
 *
 * Only an account made a minute ago in the middle of this flow can lack a
 * profile, and only then is the shared create path used. An existing
 * profile is read as is, so a soft-deleted one reaches the consent check
 * still marked deleted and is refused there, instead of being restored by a
 * click on Allow (an account is restored only by its owner's choice on
 * /auth/restore).
 */
async function decidingUser(user: Parameters<typeof ensureProfileFromAuth>[1]): Promise<DecidingUser | null> {
  const existing = await prisma.userProfile.findUnique({
    where: { supabaseId: user.id },
    select: { supabaseId: true, role: true, deletedAt: true },
  });
  if (existing) return { supabaseId: existing.supabaseId, role: existing.role, deletedAt: existing.deletedAt ?? null };

  const created = await ensureProfileFromAuth<{ id: string; supabaseId: string; email: string; role: string; deletedAt: Date | null }>(
    prisma,
    user,
    { logSource: 'oauth-decision' },
  );
  return created ? { supabaseId: created.supabaseId, role: created.role, deletedAt: created.deletedAt ?? null } : null;
}
