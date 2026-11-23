import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { resourceForUrl } from './config';
import { verifiedClientLabel } from './clients';
import { revokeGrant } from './tokens';

/**
 * Connected apps: what a person has approved, and how they take it back.
 */

export interface ConnectedApp {
  grantId: string;
  clientName: string;
  /** "Claude" or "ChatGPT" when every address the app registered is their own callback. */
  verifiedAs: string | null;
  /** Which connector: the candidate one or the employer one. */
  connector: string;
  connectedAt: string;
  lastUsedAt: string | null;
}

export async function listConnectedApps(userId: string): Promise<ConnectedApp[]> {
  const grants = await prisma.oAuthGrant.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      resource: true,
      createdAt: true,
      lastUsedAt: true,
      client: { select: { clientName: true, redirectUris: true } },
    },
  });
  return grants.map((g) => ({
    grantId: g.id,
    clientName: g.client.clientName,
    verifiedAs: verifiedClientLabel(g.client.redirectUris),
    connector: resourceForUrl(g.resource)?.displayName ?? brand.name,
    connectedAt: g.createdAt.toISOString(),
    lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
  }));
}

/** Ownership is part of the lookup, so one account can never revoke another's grant. */
export async function disconnectApp(userId: string, grantId: unknown): Promise<boolean> {
  if (typeof grantId !== 'string' || grantId.length === 0 || grantId.length > 100) return false;
  const grant = await prisma.oAuthGrant.findFirst({
    where: { id: grantId, userId, revokedAt: null },
    select: { id: true },
  });
  if (!grant) return false;
  await revokeGrant(grant.id, 'disconnected in settings');
  return true;
}

/**
 * Retention, as published in the privacy policy (section 11): spent codes
 * and tokens go after 7 days, disconnected connections after 30.
 */
const SPENT_ROW_RETENTION_DAYS = 7;
const REVOKED_GRANT_RETENTION_DAYS = 30;
/** A registration nobody has approved, or whose connections are all gone, after this long. */
const UNUSED_CLIENT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes parked requests, codes, tokens and disconnected grants that can
 * never be used again, then registrations with nothing left on them.
 *
 * Registration is open, so without that last step anyone could grow the
 * clients table without bound. A registration with a live connection, or
 * one made in the last 30 days, is never touched. An app that kept the id of
 * a deleted registration is told on the authorize page to add the connector
 * again, which registers it afresh.
 */
export async function purgeSpentOAuthRows(now: Date = new Date()): Promise<{
  requests: number;
  codes: number;
  tokens: number;
  grants: number;
  clients: number;
}> {
  const cutoff = new Date(now.getTime() - SPENT_ROW_RETENTION_DAYS * DAY_MS);
  const grantCutoff = new Date(now.getTime() - REVOKED_GRANT_RETENTION_DAYS * DAY_MS);
  const clientCutoff = new Date(now.getTime() - UNUSED_CLIENT_RETENTION_DAYS * DAY_MS);
  const [requests, codes, tokens, grants, clients] = await prisma.$transaction([
    prisma.oAuthAuthorizationRequest.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.oAuthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    prisma.oAuthToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    }),
    // Cascades to whatever codes and tokens the grant still has.
    prisma.oAuthGrant.deleteMany({ where: { revokedAt: { lt: grantCutoff } } }),
    // After the grants above, in the same transaction, so a registration
    // whose last connection was just purged goes too.
    prisma.oAuthClient.deleteMany({
      where: { createdAt: { lt: clientCutoff }, grants: { none: {} }, authorizationRequests: { none: {} } },
    }),
  ]);
  return {
    requests: requests.count,
    codes: codes.count,
    tokens: tokens.count,
    grants: grants.count,
    clients: clients.count,
  };
}
