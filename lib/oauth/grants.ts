/**
 * Grants: one candidate's approval of one AI app (oauth_grants). Every code,
 * refresh token and access token hangs off a grant, so revoking the grant
 * ends all of them: a refresh is refused once revokedAt is set, and
 * verifyAccessToken checks revokedAt on every MCP request.
 */
import type { Prisma } from '@prisma/client';
import type { McpScope } from '@/lib/mcp/config';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { AUTHORIZATION_CODE_TTL_SECONDS } from '@/lib/oauth/config';
import { clientLogLabel, type OAuthClientInfo } from '@/lib/oauth/clients';
import { randomToken, sha256Hex } from '@/lib/oauth/crypto';
import { redirectHostLabel } from '@/lib/oauth/redirect-uri';

export type RevokeReason = 'user_revoke' | 'client_revoke' | 'code_reuse' | 'refresh_reuse';

/** The profile fields every OAuth step checks. */
export interface AccountState {
    role: string;
    deletedAt: Date | null;
}

/**
 * True when a profile may use the AI apps (design 2.5 step 10, 2.7 step 4,
 * 2.9): it exists, is not soft-deleted, and is a candidate account. Employer
 * and admin accounts are refused: the apps act on applications and saved
 * jobs only.
 */
export function accountAllowsApps<T extends AccountState>(profile: T | null | undefined): profile is T {
    return !!profile && !profile.deletedAt && profile.role === 'job_seeker';
}

/** A grant read with the account state of its candidate. */
export const GRANT_WITH_ACCOUNT_INCLUDE = {
    user: { select: { role: true, deletedAt: true } },
} as const satisfies Prisma.OauthGrantInclude;

export interface GrantWithAccount {
    id: string;
    userId: string;
    clientId: string;
    clientName: string;
    redirectUri: string;
    scopes: string[];
    resource: string;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    user: AccountState;
}

export interface NewGrant {
    userId: string;
    client: OAuthClientInfo;
    redirectUri: string;
    scopes: readonly McpScope[];
    resource: string;
    codeChallenge: string;
}

/**
 * Records an Allow (design 2.6): the grant and its single-use authorization
 * code in one write. Only the code's SHA-256 is stored; the code itself is
 * returned once, for the redirect.
 */
export async function createGrantWithCode(input: NewGrant, now: Date = new Date()): Promise<{ grantId: string; code: string }> {
    const code = randomToken();
    const grant = await prisma.oauthGrant.create({
        data: {
            userId: input.userId,
            clientId: input.client.clientId,
            clientName: input.client.clientName,
            redirectUri: input.redirectUri,
            scopes: [...input.scopes],
            resource: input.resource,
            createdAt: now,
            codes: {
                create: {
                    codeHash: sha256Hex(code),
                    codeChallenge: input.codeChallenge,
                    expiresAt: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
                    createdAt: now,
                },
            },
        },
        select: { id: true },
    });
    logger.info('[oauth] grant created', { client: clientLogLabel(input.client.clientId), grantId: grant.id, userId: input.userId });
    return { grantId: grant.id, code };
}

/**
 * Revokes a grant and deletes its refresh tokens. The first reason stays: a
 * grant already revoked is left as it is (its refresh tokens are still
 * cleared). True when this call revoked it.
 */
export async function revokeGrant(grantId: string, reason: Exclude<RevokeReason, 'user_revoke'>, now: Date = new Date()): Promise<boolean> {
    const { count } = await prisma.oauthGrant.updateMany({
        where: { id: grantId, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
    });
    await prisma.oauthRefreshToken.deleteMany({ where: { grantId } });
    if (count > 0) logger.info('[oauth] grant revoked', { grantId, reason });
    return count > 0;
}

/**
 * The candidate removes an app in Settings (design 2.10): revokes the grant
 * only when it is theirs and still active, then deletes its refresh tokens.
 * False when no such grant exists, which the route answers with 404.
 */
export async function revokeGrantForUser(userId: string, grantId: string, now: Date = new Date()): Promise<boolean> {
    const { count } = await prisma.oauthGrant.updateMany({
        where: { id: grantId, userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'user_revoke' },
    });
    if (count === 0) return false;
    await prisma.oauthRefreshToken.deleteMany({ where: { grantId } });
    logger.info('[oauth] grant revoked', { grantId, userId, reason: 'user_revoke' });
    return true;
}

export const MAX_CONNECTED_APPS_LISTED = 50;

export interface ConnectedApp {
    id: string;
    clientName: string;
    /** Where the app's redirect URI points: its host, or "this computer" for a loopback client. */
    host: string;
    scopes: string[];
    createdAt: Date;
    lastUsedAt: Date | null;
}

/** The candidate's active grants, newest first, at most 50 (design 2.10). */
export async function listConnectedApps(userId: string): Promise<ConnectedApp[]> {
    const rows = await prisma.oauthGrant.findMany({
        where: { userId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        take: MAX_CONNECTED_APPS_LISTED,
        select: { id: true, clientName: true, redirectUri: true, scopes: true, createdAt: true, lastUsedAt: true },
    });
    return rows.map((row) => ({
        id: row.id,
        clientName: row.clientName,
        host: redirectHostLabel(row.redirectUri),
        scopes: row.scopes,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
    }));
}
