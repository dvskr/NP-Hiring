import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { AUTHORIZATION_CODE_TTL_SECONDS, TOKEN_PREFIX, isResourceServed, resourceForUrl } from './config';
import { buildClientRedirect, loadPendingAuthorization } from './authorize';
import { generateSecret, hashSecret } from './crypto';

/**
 * The consent decision: the step where a signed-in person approves or
 * refuses a parked authorization request.
 *
 * Order matters. Every check that can be fixed by the person (wrong account,
 * an account type that cannot use this connector) runs BEFORE the request is
 * consumed, so they can switch accounts and approve the same request.
 * Consumption is a conditional delete, which is what makes a request single
 * use even when two tabs submit at once.
 */

export interface DecidingUser {
  supabaseId: string;
  role: string;
  deletedAt: Date | null;
}

export type DecisionOutcome =
  | { kind: 'redirect'; location: string }
  | { kind: 'error'; status: number; message: string; code: 'expired' | 'wrong_account_type' | 'account_unavailable' };

export async function decideAuthorization(input: {
  requestId: unknown;
  approve: boolean;
  user: DecidingUser;
}): Promise<DecisionOutcome> {
  const pending = await loadPendingAuthorization(input.requestId);
  if (!pending) {
    return {
      kind: 'error',
      status: 410,
      code: 'expired',
      message: 'This connection request has expired. Go back to the app and connect again.',
    };
  }

  const resource = resourceForUrl(pending.resource);
  // /oauth/authorize never parks a request for a connector this board does
  // not serve (the employer one, until its tools exist). One that got here
  // some other way is refused like an expired request.
  if (input.approve && resource && !isResourceServed(resource.id)) {
    return {
      kind: 'error',
      status: 410,
      code: 'expired',
      message: 'This connector is not available here. Go back to the app and connect again.',
    };
  }
  if (input.approve) {
    if (input.user.deletedAt) {
      return {
        kind: 'error',
        status: 403,
        code: 'account_unavailable',
        message: 'This account is scheduled for deletion, so it cannot be connected to an app.',
      };
    }
    if (!resource || !resource.allowedRoles.includes(input.user.role)) {
      return {
        kind: 'error',
        status: 403,
        code: 'wrong_account_type',
        message: 'This connector is for employer accounts. Sign in with the account you use to post jobs.',
      };
    }
  }

  // Single use. Losing this race means another submission already decided.
  const consumed = await prisma.oAuthAuthorizationRequest.deleteMany({
    where: { id: pending.id, expiresAt: { gt: new Date() } },
  });
  if (consumed.count === 0) {
    return {
      kind: 'error',
      status: 410,
      code: 'expired',
      message: 'This connection request was already used. Go back to the app and connect again.',
    };
  }

  if (!input.approve || !resource) {
    return {
      kind: 'redirect',
      location: buildClientRedirect(pending.redirectUri, {
        error: 'access_denied',
        error_description: 'The account holder declined the connection.',
        state: pending.state,
      }),
    };
  }

  const grant = await prisma.oAuthGrant.upsert({
    where: {
      clientId_userId_resource: {
        clientId: pending.clientId,
        userId: input.user.supabaseId,
        resource: pending.resource,
      },
    },
    // A re-approval of a revoked grant starts clean: revokeGrant already
    // revoked every token it had, so clearing revokedAt revives nothing.
    update: { scope: pending.scope, revokedAt: null },
    create: {
      clientId: pending.clientId,
      userId: input.user.supabaseId,
      resource: pending.resource,
      scope: pending.scope,
    },
    select: { id: true },
  });

  const code = generateSecret(TOKEN_PREFIX.code);
  await prisma.oAuthAuthorizationCode.create({
    data: {
      codeHash: hashSecret(code),
      grantId: grant.id,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
    },
  });

  logger.info('MCP connector approved', {
    grantId: grant.id,
    clientId: pending.clientId,
    resource: resource.id,
  });

  return {
    kind: 'redirect',
    location: buildClientRedirect(pending.redirectUri, { code, state: pending.state }),
  };
}
