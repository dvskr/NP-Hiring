/**
 * POST /oauth/authorize/decision (design 2.6): the consent page's Allow or
 * Cancel. Answers `{ redirectTo }`, and the page navigates there itself: the
 * site CSP's form-action 'self' would block a form POST's redirect to the
 * app.
 *
 * SECURITY: this is the one request that creates a grant, so it takes all of
 *   - an Origin header equal to the site origin (a page on another site
 *     cannot send one; this path is outside the /api CSRF gate);
 *   - the signed-in Supabase user;
 *   - the consent token the page signed for that user and these exact
 *     parameters in the last 10 minutes;
 *   - the authorization request and the account checks run again in full.
 * tests/oauth/decision-route.test.ts
 */
import type { User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ensureProfileFromAuth } from '@/lib/auth/ensure-profile';
import { logger } from '@/lib/logger';
import { oauthIssuer } from '@/lib/mcp/config';
import { prisma } from '@/lib/prisma';
import { asJsonObject } from '@/lib/request-body';
import { createClient } from '@/lib/supabase/server';
import { authorizePathAndQuery, readAuthorizeParams } from '@/lib/oauth/authorize-params';
import { authorizationCodeUrl, authorizationErrorUrl, parseAuthorizeRequest } from '@/lib/oauth/authorize-request';
import { clientLogLabel, markClientUsed } from '@/lib/oauth/clients';
import { OAUTH_RATE_LIMITS, oauthSigningSecret } from '@/lib/oauth/config';
import { verifyConsentToken } from '@/lib/oauth/consent-csrf';
import { accountAllowsApps, createGrantWithCode, type AccountState } from '@/lib/oauth/grants';
import { readBodyText } from '@/lib/oauth/http';
import { rateLimitWait } from '@/lib/oauth/limits';

export const dynamic = 'force-dynamic';

const DecisionBodySchema = z.object({
    params: z.record(z.string(), z.string()),
    decision: z.enum(['allow', 'deny']),
    csrf: z.string().min(1).max(256),
});

interface ProfileRow extends AccountState {
    id: string;
    supabaseId: string;
    email: string;
}

function answer(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}): NextResponse {
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function sessionUser(): Promise<User | null> {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
}

async function readDecisionBody(request: Request): Promise<z.infer<typeof DecisionBodySchema> | null> {
    const body = await readBodyText(request);
    if (!body.ok) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(body.text);
    } catch {
        return null;
    }
    const result = DecisionBodySchema.safeParse(asJsonObject(parsed));
    return result.success ? result.data : null;
}

async function handleDecision(request: Request): Promise<NextResponse> {
    if (!oauthSigningSecret()) return answer({ error: 'temporarily_unavailable' }, 503);
    if (request.headers.get('origin') !== oauthIssuer()) return answer({ error: 'forbidden' }, 403);

    const user = await sessionUser();
    if (!user) return answer({ error: 'unauthorized' }, 401);
    const wait = await rateLimitWait(`oauth:decision:user:${user.id}`, OAUTH_RATE_LIMITS.authorizePerUser);
    if (wait !== null) return answer({ error: 'rate_limited' }, 429, { 'Retry-After': String(wait) });

    const body = await readDecisionBody(request);
    if (!body) return answer({ error: 'invalid_request' }, 400);
    const { params } = readAuthorizeParams(body.params);
    if (!verifyConsentToken(body.csrf, user.id, params)) {
        logger.info('[oauth] consent token refused', { userId: user.id });
        return answer({ error: 'invalid_csrf' }, 403);
    }

    const parsed = await parseAuthorizeRequest(params, { pathAndQuery: authorizePathAndQuery(params) });
    if (parsed.kind === 'error_page') return answer({ error: 'invalid_request' }, 400);
    if (parsed.kind === 'error_redirect') return answer({ redirectTo: parsed.redirectTo });
    const authorization = parsed.request;

    const profile = await ensureProfileFromAuth<ProfileRow>(prisma, user, { logSource: 'oauth-decision' });
    if (!accountAllowsApps(profile)) return answer({ error: 'account' }, 403);

    if (body.decision === 'deny') {
        logger.info('[oauth] consent declined', { client: clientLogLabel(authorization.client.clientId), userId: user.id });
        return answer({
            redirectTo: authorizationErrorUrl(authorization.redirectUri, 'access_denied', 'The user declined the request.', authorization.state),
        });
    }

    const now = new Date();
    const { code } = await createGrantWithCode(
        {
            userId: user.id,
            client: authorization.client,
            redirectUri: authorization.redirectUri,
            scopes: authorization.scopes,
            resource: authorization.resource,
            codeChallenge: authorization.codeChallenge,
        },
        now,
    );
    await markClientUsed(authorization.client, now);
    return answer({ redirectTo: authorizationCodeUrl(authorization.redirectUri, code, authorization.state) });
}

export async function POST(request: Request): Promise<NextResponse> {
    try {
        return await handleDecision(request);
    } catch (error) {
        logger.error('[oauth] consent decision failed', error);
        return answer({ error: 'server_error' }, 500);
    }
}
