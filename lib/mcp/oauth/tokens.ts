import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  GRANT_LAST_USED_THROTTLE_SECONDS,
  REFRESH_REUSE_GRACE_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  SPENT_REFRESH_RETENTION_SECONDS,
  TOKEN_PREFIX,
  parseScope,
  resourceForUrl,
} from './config';
import type { StoredClient } from './clients';
import { generateSecret, hashSecret, verifyPkceS256 } from './crypto';

/**
 * Token issuance, rotation, revocation and verification.
 *
 * Tokens are opaque random strings whose SHA-256 is the database key, rather
 * than JWTs. Verification costs one indexed read, and in exchange revoking a
 * connection in settings takes effect on the very next MCP request instead
 * of whenever a self-contained token would have expired.
 */

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface TokenError {
  status: 400 | 401;
  error: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type' | 'invalid_target' | 'invalid_scope';
  error_description: string;
}

export function isTokenError(value: TokenResponse | TokenError): value is TokenError {
  return 'error' in value;
}

const invalidGrant = (description: string): TokenError => ({
  status: 400,
  error: 'invalid_grant',
  error_description: description,
});

function sameResource(a: string, b: string): boolean {
  return a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '');
}

async function issueTokenPair(grantId: string, scope: string): Promise<TokenResponse> {
  const accessToken = generateSecret(TOKEN_PREFIX.access);
  const refreshToken = generateSecret(TOKEN_PREFIX.refresh);
  const now = Date.now();
  await prisma.oAuthToken.createMany({
    data: [
      {
        tokenHash: hashSecret(accessToken),
        grantId,
        kind: 'access',
        expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
      },
      {
        tokenHash: hashSecret(refreshToken),
        grantId,
        kind: 'refresh',
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    ],
  });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope,
  };
}

/** Revokes a grant and every token it ever issued. Idempotent. */
export async function revokeGrant(grantId: string, reason: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.oAuthGrant.updateMany({ where: { id: grantId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.oAuthToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  logger.info('MCP connector grant revoked', { grantId, reason });
}

/** Grant fields every token path needs to decide whether the grant is still usable. */
const GRANT_STATE_SELECT = {
  id: true,
  clientId: true,
  resource: true,
  scope: true,
  revokedAt: true,
  user: { select: { deletedAt: true } },
} as const;

/** authorization_code grant (OAuth 2.1 section 4.1.3). */
export async function exchangeAuthorizationCode(input: {
  client: StoredClient;
  code: string | null;
  redirectUri: string | null;
  codeVerifier: string | null;
  resource: string | null;
}): Promise<TokenResponse | TokenError> {
  if (!input.code || !input.codeVerifier) {
    return { status: 400, error: 'invalid_request', error_description: 'code and code_verifier are required.' };
  }

  const row = await prisma.oAuthAuthorizationCode.findUnique({
    where: { codeHash: hashSecret(input.code) },
    include: { grant: { select: GRANT_STATE_SELECT } },
  });
  if (!row) return invalidGrant('The authorization code is not valid.');

  if (row.consumedAt) {
    // A replayed code means someone else may hold it. OAuth 2.1 says revoke
    // what it produced; the grant is the unit here.
    await revokeGrant(row.grantId, 'authorization code replayed');
    return invalidGrant('The authorization code was already used.');
  }
  if (row.expiresAt.getTime() <= Date.now()) return invalidGrant('The authorization code has expired.');
  if (row.grant.clientId !== input.client.clientId) return invalidGrant('The authorization code was issued to another client.');
  // redirect_uri is required here only if the authorization request had to
  // carry it, which it did unless the client registered exactly one.
  const redirectMatches = input.redirectUri
    ? input.redirectUri === row.redirectUri
    : input.client.redirectUris.length === 1 && input.client.redirectUris[0] === row.redirectUri;
  if (!redirectMatches) {
    return invalidGrant('redirect_uri does not match the authorization request.');
  }
  if (!verifyPkceS256(input.codeVerifier, row.codeChallenge)) {
    return invalidGrant('code_verifier does not match the code challenge.');
  }
  if (input.resource && !sameResource(input.resource, row.grant.resource)) {
    return { status: 400, error: 'invalid_target', error_description: 'resource does not match the authorization request.' };
  }
  if (row.grant.revokedAt || row.grant.user.deletedAt) return invalidGrant('This connection is no longer active.');

  // The single-use lock. Two concurrent exchanges both pass the reads above;
  // only one of them flips consumedAt.
  const consumed = await prisma.oAuthAuthorizationCode.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) {
    await revokeGrant(row.grantId, 'authorization code raced');
    return invalidGrant('The authorization code was already used.');
  }

  return issueTokenPair(row.grantId, row.grant.scope);
}

/** refresh_token grant, with rotation (OAuth 2.1 section 4.3.1). */
export async function refreshAccessToken(input: {
  client: StoredClient;
  refreshToken: string | null;
  resource: string | null;
  scope: string | null;
}): Promise<TokenResponse | TokenError> {
  if (!input.refreshToken) {
    return { status: 400, error: 'invalid_request', error_description: 'refresh_token is required.' };
  }

  const row = await prisma.oAuthToken.findUnique({
    where: { tokenHash: hashSecret(input.refreshToken) },
    include: { grant: { select: GRANT_STATE_SELECT } },
  });
  if (!row || row.kind !== 'refresh') return invalidGrant('The refresh token is not valid.');
  if (row.grant.clientId !== input.client.clientId) return invalidGrant('The refresh token was issued to another client.');
  if (row.grant.revokedAt || row.grant.user.deletedAt) return invalidGrant('This connection is no longer active.');
  if (input.resource && !sameResource(input.resource, row.grant.resource)) {
    return { status: 400, error: 'invalid_target', error_description: 'resource does not match this connection.' };
  }
  // A refresh may narrow scope but never widen it (RFC 6749 section 6).
  const requestedScope = parseScope(input.scope);
  if (requestedScope.some((s) => !parseScope(row.grant.scope).includes(s))) {
    return { status: 400, error: 'invalid_scope', error_description: 'A refresh cannot add scope.' };
  }

  // A spent token is checked before its own revocation and expiry, because
  // presenting one is the signal that matters: it has a successor, so
  // whoever presents it may hold a copy.
  if (row.rotatedAt) {
    const withinGrace = Date.now() - row.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_SECONDS * 1000;
    if (withinGrace && (await claimGraceUse(row.id))) {
      logger.warn('MCP refresh token reused inside the grace window', { grantId: row.grantId });
      return issueTokenPair(row.grantId, row.grant.scope);
    }
    await revokeGrant(row.grantId, 'refresh token replayed');
    return invalidGrant('The refresh token was already used.');
  }
  if (row.revokedAt) return invalidGrant('This connection is no longer active.');
  if (row.expiresAt.getTime() <= Date.now()) return invalidGrant('The refresh token has expired.');

  // Conditional, so a worker racing this one does not move rotatedAt again.
  // The spent token is kept only long enough to catch a copy being replayed.
  const now = Date.now();
  const rotated = await prisma.oAuthToken.updateMany({
    where: { id: row.id, rotatedAt: null },
    data: {
      rotatedAt: new Date(now),
      expiresAt: new Date(Math.min(row.expiresAt.getTime(), now + SPENT_REFRESH_RETENTION_SECONDS * 1000)),
    },
  });
  // A worker racing this one rotated it first. The token was live a moment
  // ago, so this request is its one grace use, if that is still unclaimed.
  if (rotated.count === 0 && !(await claimGraceUse(row.id))) {
    await revokeGrant(row.grantId, 'refresh token replayed');
    return invalidGrant('The refresh token was already used.');
  }
  return issueTokenPair(row.grantId, row.grant.scope);
}

/**
 * Claims the single extra pair a spent refresh token may still produce.
 * revokedAt on a rotated token marks that use as taken, so a third
 * presentation, however soon, revokes the grant.
 */
async function claimGraceUse(tokenId: string): Promise<boolean> {
  const claimed = await prisma.oAuthToken.updateMany({
    where: { id: tokenId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return claimed.count === 1;
}

/**
 * RFC 7009 revocation. Revoking a refresh token ends the whole connection,
 * which section 2.1 encourages; revoking an access token ends that token.
 * Tokens that are unknown or belong to another client are ignored, and the
 * caller answers 200 either way, as section 2.2 requires.
 */
export async function revokeToken(client: StoredClient, token: string | null): Promise<void> {
  if (!token) return;
  const row = await prisma.oAuthToken.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: { grant: { select: { id: true, clientId: true } } },
  });
  if (!row || row.grant.clientId !== client.clientId) return;
  if (row.kind === 'refresh') {
    await revokeGrant(row.grantId, 'client revoked refresh token');
    return;
  }
  await prisma.oAuthToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
}

export interface VerifiedAccess {
  grantId: string;
  clientId: string;
  clientName: string;
  /** Supabase user id. */
  userId: string;
  email: string;
  role: string;
  scopes: string[];
  resource: string;
}

export type AccessVerification =
  | { ok: true; access: VerifiedAccess }
  | { ok: false; reason: 'invalid' | 'expired' | 'wrong_resource' | 'insufficient_scope' };

/**
 * Verifies a bearer token for one MCP endpoint: right kind, unexpired,
 * unrevoked, issued for this exact resource (RFC 8707 audience), carrying
 * the endpoint's scope, and belonging to an account that still exists.
 */
export async function verifyAccessToken(
  token: string | null | undefined,
  expectedResource: string,
  requiredScope: string,
): Promise<AccessVerification> {
  if (!token || !token.startsWith(TOKEN_PREFIX.access) || token.length > 200) return { ok: false, reason: 'invalid' };

  const row = await prisma.oAuthToken.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: {
      grant: {
        select: {
          id: true,
          clientId: true,
          resource: true,
          scope: true,
          revokedAt: true,
          lastUsedAt: true,
          client: { select: { clientName: true } },
          user: { select: { supabaseId: true, email: true, role: true, deletedAt: true } },
        },
      },
    },
  });
  if (!row || row.kind !== 'access' || row.revokedAt || row.grant.revokedAt || row.grant.user.deletedAt) {
    return { ok: false, reason: 'invalid' };
  }
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  if (!sameResource(row.grant.resource, expectedResource) || !resourceForUrl(row.grant.resource)) {
    return { ok: false, reason: 'wrong_resource' };
  }
  const scopes = parseScope(row.grant.scope);
  if (!scopes.includes(requiredScope)) return { ok: false, reason: 'insufficient_scope' };

  const lastUsed = row.grant.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - lastUsed > GRANT_LAST_USED_THROTTLE_SECONDS * 1000) {
    // Display-only bookkeeping for Connected apps. Never fails the request.
    prisma.oAuthGrant
      .update({ where: { id: row.grant.id }, data: { lastUsedAt: new Date() } })
      .catch((err: unknown) => logger.warn('Could not stamp grant lastUsedAt', { grantId: row.grant.id }, err));
  }

  return {
    ok: true,
    access: {
      grantId: row.grant.id,
      clientId: row.grant.clientId,
      clientName: row.grant.client.clientName,
      userId: row.grant.user.supabaseId,
      email: row.grant.user.email,
      role: row.grant.user.role,
      scopes,
      resource: row.grant.resource,
    },
  };
}
