/**
 * GET /oauth/authorize (design 2.5): where Claude or ChatGPT sends a
 * candidate to connect their NP Hiring account.
 *
 * Order (lib/oauth/authorize-request.ts): an unknown client or redirect URI
 * gets our own error page; every later problem goes back to the app at its
 * verified redirect URI; then sign-in (a signed-out visitor goes to /login
 * and returns here); then the account, which must be an active candidate
 * account; then the consent card. Nothing is written until the candidate
 * presses Allow (app/oauth/authorize/decision/route.ts).
 *
 * noindex; the middleware CSP already sends frame-ancestors 'none', so the
 * page cannot be framed for clickjacking. tests/oauth/authorize-page.test.ts
 */
import type { Metadata } from 'next';
import type React from 'react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import AuthLayout from '@/components/auth/AuthLayout';
import ConsentForm from '@/components/oauth/ConsentForm';
import { brand } from '@/config/brand';
import { ensureProfileFromAuth } from '@/lib/auth/ensure-profile';
import { MCP_SCOPE_DESCRIPTIONS } from '@/lib/mcp/config';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { authorizePathAndQuery } from '@/lib/oauth/authorize-params';
import { authorizationErrorUrl, parseAuthorizeRequest } from '@/lib/oauth/authorize-request';
import { OAUTH_RATE_LIMITS, oauthSigningSecret } from '@/lib/oauth/config';
import { createConsentToken } from '@/lib/oauth/consent-csrf';
import { accountAllowsApps, type AccountState } from '@/lib/oauth/grants';
import { clientIp, rateLimitWait } from '@/lib/oauth/limits';
import { redirectHostLabel } from '@/lib/oauth/redirect-uri';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Connect an app',
    robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

interface ProfileRow extends AccountState {
    id: string;
    supabaseId: string;
    email: string;
}

const ILLUSTRATION = '/illustrations/auth-login.png';

/** The one sentence under "This app could not connect". */
const ERROR_SENTENCES = {
    invalidLink: "The app's sign-in link is not valid.",
    candidatesOnly: `${brand.name} apps work with candidate accounts.`,
    tooManyAttempts: 'There have been too many attempts. Try again in a minute.',
} as const;

function ConnectError({ sentence }: { sentence: string }): React.JSX.Element {
    return (
        <AuthLayout illustration={ILLUSTRATION}>
            <div style={{ background: '#FFFFFF', borderRadius: '20px', border: '1px solid #E2E8F0', padding: '28px 24px', textAlign: 'center' }}>
                <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#1A2E35', fontFamily: 'var(--font-lora), Georgia, serif', lineHeight: 1.3, margin: '0 0 10px' }}>
                    This app could not connect
                </h1>
                <p style={{ fontSize: '15px', color: '#4B5E68', lineHeight: 1.6, margin: '0 0 18px' }}>{sentence}</p>
                <Link href="/" style={{ display: 'inline-block', padding: '12px 4px', fontSize: '14px', fontWeight: 700, color: '#BE185D' }}>
                    Back to {brand.name}
                </Link>
            </div>
        </AuthLayout>
    );
}

async function sessionUser(): Promise<User | null> {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
}

/** Per signed-in user (design 2.11); per IP before sign-in. */
async function rateLimited(user: User | null): Promise<boolean> {
    const key = user ? `oauth:authorize:user:${user.id}` : `oauth:authorize:ip:${clientIp(await headers())}`;
    return (await rateLimitWait(key, OAUTH_RATE_LIMITS.authorizePerUser)) !== null;
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<React.JSX.Element> {
    const query = await searchParams;
    const user = await sessionUser();
    if (await rateLimited(user)) return <ConnectError sentence={ERROR_SENTENCES.tooManyAttempts} />;

    // Steps 1 to 8. The session is read above for the rate limit, but a
    // signed-out visitor is only sent to sign in once the request is valid.
    const pathAndQuery = authorizePathAndQuery(query);
    const parsed = await parseAuthorizeRequest(query, { pathAndQuery });
    if (parsed.kind === 'error_page') return <ConnectError sentence={ERROR_SENTENCES.invalidLink} />;
    if (parsed.kind === 'error_redirect') redirect(parsed.redirectTo);
    const authorization = parsed.request;

    if (!oauthSigningSecret()) {
        redirect(authorizationErrorUrl(authorization.redirectUri, 'temporarily_unavailable', 'The authorization server is not configured.', authorization.state));
    }

    // 9. Session
    if (!user) redirect(`/login?next=${encodeURIComponent(pathAndQuery)}`);

    // 10. An active candidate account, never a redirect with a code otherwise.
    const profile = await ensureProfileFromAuth<ProfileRow>(prisma, user, { logSource: 'oauth-authorize' });
    if (!accountAllowsApps(profile)) return <ConnectError sentence={ERROR_SENTENCES.candidatesOnly} />;

    // 11. Consent
    return (
        <AuthLayout illustration={ILLUSTRATION}>
            <ConsentForm
                clientName={authorization.client.clientName}
                redirectHost={redirectHostLabel(authorization.redirectUri)}
                email={user.email ?? profile.email}
                permissions={authorization.scopes.map((scope) => MCP_SCOPE_DESCRIPTIONS[scope])}
                params={authorization.params}
                csrf={createConsentToken(user.id, authorization.params)}
            />
        </AuthLayout>
    );
}
