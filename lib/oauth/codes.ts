/**
 * Redeeming an authorization code at the token endpoint (design 2.7,
 * grant_type=authorization_code).
 *
 * SECURITY:
 *   - single use, atomically: the code is marked consumed by one conditional
 *     update (consumedAt null and not expired), so two concurrent requests
 *     cannot both redeem it;
 *   - a code presented again after it was redeemed means it leaked: the
 *     grant is revoked (code_reuse) with its refresh tokens, so the tokens
 *     the first redemption issued stop working (OAuth 2.1 section 4.1.3);
 *   - the code is bound to the client, the exact redirect URI and the PKCE
 *     challenge it was issued for.
 * tests/oauth/token-route.test.ts
 */
import { canonicalResource } from '@/lib/mcp/config';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { clientLogLabel } from '@/lib/oauth/clients';
import { sha256Hex } from '@/lib/oauth/crypto';
import { oauthFailure, type OAuthFailure } from '@/lib/oauth/errors';
import { GRANT_WITH_ACCOUNT_INCLUDE, accountAllowsApps, revokeGrant, type GrantWithAccount } from '@/lib/oauth/grants';
import { verifyPkceS256 } from '@/lib/oauth/pkce';

export interface CodeExchange {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    resource?: string;
}

export type CodeRedemption = { ok: true; grant: GrantWithAccount } | OAuthFailure;

const INVALID_CODE = 'The authorization code is invalid, expired or already used.';

export async function redeemAuthorizationCode(input: CodeExchange, now: Date = new Date()): Promise<CodeRedemption> {
    const codeHash = sha256Hex(input.code);
    const row = await prisma.oauthAuthorizationCode.findUnique({
        where: { codeHash },
        include: { grant: { include: GRANT_WITH_ACCOUNT_INCLUDE } },
    });
    if (!row) return oauthFailure('invalid_grant', INVALID_CODE);

    const { count } = await prisma.oauthAuthorizationCode.updateMany({
        where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
    });
    if (count === 0) {
        // Not consumed and past its expiry: an ordinary expired code. Anything
        // else that loses the conditional update was redeemed already, here
        // or by a concurrent request: a replay.
        const expiredUnused = row.consumedAt === null && row.expiresAt.getTime() <= now.getTime();
        if (!expiredUnused) {
            await revokeGrant(row.grantId, 'code_reuse', now);
            logger.warn('[oauth] authorization code replayed; grant revoked', {
                client: clientLogLabel(row.grant.clientId),
                grantId: row.grantId,
                userId: row.grant.userId,
            });
        }
        return oauthFailure('invalid_grant', INVALID_CODE);
    }

    const { grant } = row;
    if (input.clientId !== grant.clientId) return oauthFailure('invalid_grant', 'The authorization code was issued to another client.');
    if (input.redirectUri !== grant.redirectUri) return oauthFailure('invalid_grant', 'The redirect_uri does not match the authorization request.');
    if (!verifyPkceS256(input.codeVerifier, row.codeChallenge)) return oauthFailure('invalid_grant', 'The code_verifier does not match the code_challenge.');
    if (input.resource !== undefined && canonicalResource(input.resource) !== grant.resource) {
        return oauthFailure('invalid_target', 'The resource does not match the authorization request.');
    }
    if (grant.revokedAt) return oauthFailure('invalid_grant', 'The grant has been revoked.');
    if (!accountAllowsApps(grant.user)) return oauthFailure('invalid_grant', 'Only active candidate accounts can use the apps.');
    return { ok: true, grant };
}
