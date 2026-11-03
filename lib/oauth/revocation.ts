/**
 * Token revocation (RFC 7009, design 2.8): an app disconnecting itself. A
 * refresh token (found by its SHA-256, in any state) or an unexpired access
 * token this server signed revokes the whole grant (client_revoke) with its
 * refresh tokens. Anything else is ignored: the endpoint answers 200 either
 * way, so it reveals nothing about which tokens exist.
 * tests/oauth/revoke-route.test.ts
 */
import { prisma } from '@/lib/prisma';
import { grantIdFromAccessToken } from '@/lib/oauth/access-token';
import { sha256Hex } from '@/lib/oauth/crypto';
import { revokeGrant } from '@/lib/oauth/grants';

/** Our refresh tokens are 43 base64url characters; a JWT has two dots. */
function looksLikeJwt(token: string): boolean {
    return token.split('.').length === 3;
}

/** Revokes the grant `token` belongs to, if it belongs to one. True when a grant was found. */
export async function revokeByToken(token: string, now: Date = new Date()): Promise<boolean> {
    if (looksLikeJwt(token)) {
        const grantId = await grantIdFromAccessToken(token);
        if (!grantId) return false;
        await revokeGrant(grantId, 'client_revoke', now);
        return true;
    }
    const row = await prisma.oauthRefreshToken.findUnique({
        where: { tokenHash: sha256Hex(token) },
        select: { grantId: true },
    });
    if (!row) return false;
    await revokeGrant(row.grantId, 'client_revoke', now);
    return true;
}
