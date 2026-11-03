/**
 * Refresh tokens (design 2.7, grant_type=refresh_token): issued with every
 * token response, 30 days each, rotated on every use.
 *
 * SECURITY: these are public clients, so a refresh token is a bearer secret
 * with nothing else to bind it. Rotation makes a stolen copy detectable:
 * each token works once, and a token presented after it was rotated means
 * two parties hold it, so the whole grant is revoked (refresh_reuse) with
 * every refresh token under it (OAuth 2.1 section 4.3.1). The rotation is
 * one conditional update, so two concurrent refreshes cannot both win.
 * tests/oauth/token-route.test.ts
 */
import { canonicalResource, type McpScope } from '@/lib/mcp/config';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { REFRESH_TOKEN_TTL_SECONDS } from '@/lib/oauth/config';
import { clientLogLabel } from '@/lib/oauth/clients';
import { randomToken, sha256Hex } from '@/lib/oauth/crypto';
import { oauthFailure, type OAuthFailure } from '@/lib/oauth/errors';
import { GRANT_WITH_ACCOUNT_INCLUDE, accountAllowsApps, revokeGrant, type GrantWithAccount } from '@/lib/oauth/grants';
import { grantScopes, parseScopeTokens } from '@/lib/oauth/scopes';

/** Stores a new refresh token for the grant (only its SHA-256) and returns it. */
export async function issueRefreshToken(grantId: string, now: Date = new Date()): Promise<string> {
    const token = randomToken();
    await prisma.oauthRefreshToken.create({
        data: {
            tokenHash: sha256Hex(token),
            grantId,
            expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
            createdAt: now,
        },
    });
    return token;
}

export interface RefreshRequest {
    refreshToken: string;
    clientId: string;
    scope?: string;
    resource?: string;
}

export type RefreshResult =
    | { ok: true; grant: GrantWithAccount; scopes: McpScope[]; refreshToken: string }
    | OAuthFailure;

const INVALID_REFRESH = 'The refresh token is invalid, expired or revoked.';

async function revokeForReuse(grant: GrantWithAccount, now: Date): Promise<OAuthFailure> {
    await revokeGrant(grant.id, 'refresh_reuse', now);
    logger.warn('[oauth] refresh token reused; grant revoked', {
        client: clientLogLabel(grant.clientId),
        grantId: grant.id,
        userId: grant.userId,
    });
    return oauthFailure('invalid_grant', INVALID_REFRESH);
}

/**
 * The access token scopes for a refresh: the grant's, or the subset the
 * request names. Null when it names a scope outside the grant (or unknown).
 */
function refreshScopes(grant: GrantWithAccount, scope: string | undefined): McpScope[] | null {
    const granted = grantScopes(grant.scopes);
    const named = parseScopeTokens(scope);
    if (named === null) return null;
    if (named.length === 0) return granted;
    return named.every((value) => granted.includes(value)) ? named : null;
}

export async function rotateRefreshToken(input: RefreshRequest, now: Date = new Date()): Promise<RefreshResult> {
    const tokenHash = sha256Hex(input.refreshToken);
    const row = await prisma.oauthRefreshToken.findUnique({
        where: { tokenHash },
        include: { grant: { include: GRANT_WITH_ACCOUNT_INCLUDE } },
    });
    // 1. Missing or expired
    if (!row || row.expiresAt.getTime() <= now.getTime()) return oauthFailure('invalid_grant', INVALID_REFRESH);
    // 2. Already rotated: a second party holds it
    if (row.consumedAt) return revokeForReuse(row.grant, now);

    // 3. The client, the grant and the account
    const { grant } = row;
    if (input.clientId !== grant.clientId) return oauthFailure('invalid_grant', 'The refresh token was issued to another client.');
    if (grant.revokedAt) return oauthFailure('invalid_grant', INVALID_REFRESH);
    if (!accountAllowsApps(grant.user)) return oauthFailure('invalid_grant', 'Only active candidate accounts can use the apps.');

    // Checked before the rotation, so a refused request leaves the token usable.
    const scopes = refreshScopes(grant, input.scope);
    if (!scopes || scopes.length === 0) return oauthFailure('invalid_scope', 'The scope must be a subset of the scopes granted.');
    if (input.resource !== undefined && canonicalResource(input.resource) !== grant.resource) {
        return oauthFailure('invalid_target', 'The resource does not match the grant.');
    }

    // 4. Rotate: whoever loses the conditional update is replaying the token.
    const { count } = await prisma.oauthRefreshToken.updateMany({
        where: { tokenHash, consumedAt: null },
        data: { consumedAt: now },
    });
    if (count === 0) return revokeForReuse(grant, now);
    const refreshToken = await issueRefreshToken(grant.id, now);
    await prisma.oauthGrant.updateMany({ where: { id: grant.id }, data: { lastUsedAt: now } });
    return { ok: true, grant, scopes, refreshToken };
}
