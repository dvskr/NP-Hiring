/**
 * Access tokens (design 2.9): HS256 JWTs of type at+jwt (RFC 9068), one
 * hour, bound to one MCP endpoint by their audience.
 *
 * SECURITY: verifyAccessToken is what the MCP routes trust, so it accepts a
 * token only when every check passes:
 *   - HS256 only (alg none and every other algorithm are refused), typ
 *     at+jwt, this server as issuer, the caller's own endpoint as audience
 *     (a token for /mcp/chatgpt does not work on /mcp), not expired;
 *   - its grant exists, is not revoked, and belongs to the token's subject
 *     and client, so revoking a grant ends its access tokens at once;
 *   - the candidate's profile exists, is not soft-deleted, and is still a
 *     candidate account.
 * It never throws for a bad token and logs only a reason code, never a
 * token. tests/oauth/access-token.test.ts
 */
import { randomUUID } from 'node:crypto';
import { SignJWT, errors, jwtVerify, type JWTPayload } from 'jose';
import { allMcpHostProfiles, oauthIssuer, type McpScope } from '@/lib/mcp/config';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ACCESS_TOKEN_TTL_SECONDS, GRANT_LAST_USED_INTERVAL_MS, MAX_TOKEN_LENGTH, oauthSigningSecret } from '@/lib/oauth/config';
import { GRANT_WITH_ACCOUNT_INCLUDE, accountAllowsApps, type GrantWithAccount } from '@/lib/oauth/grants';
import { parseScopeTokens } from '@/lib/oauth/scopes';

export interface VerifiedAccessToken {
    token: string;
    /** Supabase auth id (JWT sub). */
    userId: string;
    clientId: string;
    grantId: string;
    scopes: McpScope[];
    /** The audience, equal to expectedResource. */
    resource: string;
    /** Seconds since epoch. */
    expiresAt: number;
}

export type AccessTokenFailure = 'malformed' | 'invalid' | 'expired' | 'wrong_audience' | 'revoked' | 'account' | 'unconfigured';

export type AccessTokenCheck = { ok: true; token: VerifiedAccessToken } | { ok: false; reason: AccessTokenFailure };

export interface AccessTokenInput {
    userId: string;
    clientId: string;
    grantId: string;
    scopes: readonly McpScope[];
    resource: string;
}

const TOKEN_TYPE = 'at+jwt';
/** Three base64url segments. An empty signature passes the shape and is refused by jose (alg none). */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

function signingKey(secret: string): Uint8Array {
    return new TextEncoder().encode(secret);
}

/** A signed access token for a grant. Throws without a signing secret (every caller checks first). */
export async function signAccessToken(input: AccessTokenInput, now: number = Date.now()): Promise<string> {
    const secret = oauthSigningSecret();
    if (!secret) throw new Error('MCP_OAUTH_SIGNING_SECRET is missing or shorter than 32 characters');
    const issuedAt = Math.floor(now / 1000);
    return new SignJWT({ client_id: input.clientId, scope: input.scopes.join(' '), gid: input.grantId })
        .setProtectedHeader({ alg: 'HS256', typ: TOKEN_TYPE })
        .setIssuer(oauthIssuer())
        .setSubject(input.userId)
        .setAudience(input.resource)
        .setJti(randomUUID())
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
        .sign(signingKey(secret));
}

interface SignedClaims {
    userId: string;
    clientId: string;
    grantId: string;
    scopes: McpScope[];
    resource: string;
    expiresAt: number;
}

type SignatureCheck = { ok: true; claims: SignedClaims } | { ok: false; reason: AccessTokenFailure };

function failureFromJose(error: unknown): AccessTokenFailure {
    if (error instanceof errors.JWTExpired) return 'expired';
    if (error instanceof errors.JWTClaimValidationFailed) return error.claim === 'aud' ? 'wrong_audience' : 'invalid';
    if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) return 'malformed';
    return 'invalid';
}

function readClaims(payload: JWTPayload): SignedClaims | null {
    const { sub, aud, exp } = payload;
    const clientId = payload.client_id;
    const grantId = payload.gid;
    const scope = payload.scope;
    if (typeof sub !== 'string' || sub === '' || typeof aud !== 'string' || typeof exp !== 'number') return null;
    if (typeof clientId !== 'string' || clientId === '' || typeof grantId !== 'string' || grantId === '') return null;
    if (typeof scope !== 'string') return null;
    const scopes = parseScopeTokens(scope);
    if (!scopes || scopes.length === 0) return null;
    return { userId: sub, clientId, grantId, scopes, resource: aud, expiresAt: exp };
}

/** The signature, header and registered claims of a token issued by this server for one of `audience`. */
async function checkSignedToken(token: unknown, audience: string | string[], secret: string): Promise<SignatureCheck> {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !JWT_SHAPE.test(token)) {
        return { ok: false, reason: 'malformed' };
    }
    let payload: JWTPayload;
    try {
        ({ payload } = await jwtVerify(token, signingKey(secret), {
            algorithms: ['HS256'],
            typ: TOKEN_TYPE,
            issuer: oauthIssuer(),
            audience,
            requiredClaims: ['sub', 'iat', 'exp', 'jti'],
        }));
    } catch (error) {
        return { ok: false, reason: failureFromJose(error) };
    }
    const claims = readClaims(payload);
    return claims ? { ok: true, claims } : { ok: false, reason: 'invalid' };
}

function refuse(reason: AccessTokenFailure, context: Record<string, string> = {}): AccessTokenCheck {
    if (reason === 'unconfigured') logger.warn('[oauth] access token refused: MCP_OAUTH_SIGNING_SECRET is not configured');
    else logger.info('[oauth] access token refused', { reason, ...context });
    return { ok: false, reason };
}

/** Moves grant.lastUsedAt at most once per 10 minutes. A failed write is logged; the request goes on. */
async function recordGrantUse(grant: GrantWithAccount, now: number): Promise<void> {
    const threshold = now - GRANT_LAST_USED_INTERVAL_MS;
    if (grant.lastUsedAt && grant.lastUsedAt.getTime() > threshold) return;
    try {
        await prisma.oauthGrant.updateMany({
            where: { id: grant.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: new Date(threshold) } }] },
            data: { lastUsedAt: new Date(now) },
        });
    } catch (error) {
        logger.warn('[oauth] could not record grant use', { grantId: grant.id }, error);
    }
}

/**
 * The access token, verified for the MCP endpoint `expectedResource` (its
 * canonical URL, McpHostProfile.resourceUrl). A database failure while
 * loading the grant is not a verdict on the token and is thrown.
 */
export async function verifyAccessToken(token: string, expectedResource: string): Promise<AccessTokenCheck> {
    const secret = oauthSigningSecret();
    if (!secret) return refuse('unconfigured');
    const signed = await checkSignedToken(token, expectedResource, secret);
    if (!signed.ok) return refuse(signed.reason);
    const { claims } = signed;

    const grant = await prisma.oauthGrant.findUnique({
        where: { id: claims.grantId },
        include: GRANT_WITH_ACCOUNT_INCLUDE,
    });
    if (!grant || grant.revokedAt || grant.userId !== claims.userId || grant.clientId !== claims.clientId) {
        return refuse('revoked', { grantId: claims.grantId });
    }
    if (!accountAllowsApps(grant.user)) return refuse('account', { grantId: grant.id, userId: grant.userId });

    await recordGrantUse(grant, Date.now());
    return { ok: true, token: { token, ...claims } };
}

/**
 * The grant id of an access token this server issued for either MCP
 * endpoint, still unexpired and correctly signed, else null: what
 * POST /oauth/revoke may act on (design 2.8).
 */
export async function grantIdFromAccessToken(token: string): Promise<string | null> {
    const secret = oauthSigningSecret();
    if (!secret) return null;
    const audiences = allMcpHostProfiles().map((profile) => profile.resourceUrl);
    const signed = await checkSignedToken(token, audiences, secret);
    return signed.ok ? signed.claims.grantId : null;
}
