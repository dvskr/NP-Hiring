import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import {
  AUTHORIZATION_REQUEST_TTL_SECONDS,
  OAUTH_ENDPOINTS,
  TOKEN_PREFIX,
  getIssuer,
  resolveResource,
  resourceUrl,
} from './config';
import { describeRedirectTarget, findClient, isRegisteredRedirectUri } from './clients';
import { generateSecret, isValidCodeChallenge } from './crypto';

/**
 * The authorization endpoint (OAuth 2.1 section 4.1.1).
 *
 * Errors split in two, exactly as the spec requires:
 *
 *  - Until the client and its redirect URI are proven, nothing is sent
 *    anywhere. An unknown client or an unregistered redirect gets an error
 *    page on our own origin, because redirecting to an unverified URI would
 *    make this endpoint an open redirector.
 *  - After that, every problem goes back to the client as `error=` on its
 *    redirect URI, with `state` and `iss` (RFC 9207) attached.
 *
 * A valid request is parked as an OAuthAuthorizationRequest and the browser
 * goes to the consent page carrying only the row's id.
 */

const MAX_STATE_LENGTH = 2048;

export type AuthorizeOutcome =
  | { kind: 'error_page'; status: number; message: string }
  | { kind: 'redirect'; location: string };

/** Builds a client redirect with `iss` always present (RFC 9207 section 2). */
export function buildClientRedirect(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  url.searchParams.set('iss', getIssuer());
  return url.toString();
}

export async function handleAuthorizeRequest(params: URLSearchParams): Promise<AuthorizeOutcome> {
  const clientId = params.get('client_id');
  const client = await findClient(clientId);
  if (!client) {
    return {
      kind: 'error_page',
      status: 400,
      // Unused registrations are deleted after 30 days, and some apps keep
      // the old id, so "connect again" alone may not be enough.
      message:
        `This connection request came from an app that is not registered with ${brand.name}, or whose registration has expired. Remove ${brand.name} from the app's connectors, add it again, then connect.`,
    };
  }

  // OAuth 2.1 requires redirect_uri whenever more than one is registered. With
  // exactly one on file it may be omitted.
  const requestedRedirect = params.get('redirect_uri');
  const redirectUri =
    requestedRedirect ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
  if (!redirectUri || !isRegisteredRedirectUri(client, redirectUri)) {
    return {
      kind: 'error_page',
      status: 400,
      message: 'This connection request points somewhere the app did not register. Go back to the app and connect again.',
    };
  }

  const rawState = params.get('state');
  const state = rawState && rawState.length <= MAX_STATE_LENGTH ? rawState : null;
  const fail = (error: string, description: string): AuthorizeOutcome => ({
    kind: 'redirect',
    location: buildClientRedirect(redirectUri, { error, error_description: description, state }),
  });

  if (rawState && rawState.length > MAX_STATE_LENGTH) {
    return fail('invalid_request', 'state is too long.');
  }
  if (params.get('response_type') !== 'code') {
    return fail('unsupported_response_type', 'Only response_type=code is supported.');
  }

  const codeChallenge = params.get('code_challenge');
  const method = params.get('code_challenge_method');
  if (!codeChallenge) {
    return fail('invalid_request', 'PKCE is required: send code_challenge with code_challenge_method=S256.');
  }
  if (method !== 'S256') {
    return fail('invalid_request', 'Only code_challenge_method=S256 is supported.');
  }
  if (!isValidCodeChallenge(codeChallenge)) {
    return fail('invalid_request', 'code_challenge is not a valid S256 challenge.');
  }

  // RFC 8707 allows several resource parameters; this server binds a token to
  // exactly one endpoint, so more than one is a request it cannot honour.
  const resources = params.getAll('resource');
  if (resources.length > 1) {
    return fail('invalid_target', 'Request one resource at a time.');
  }
  const resource = resolveResource(resources[0] ?? null, params.get('scope'));
  if (!resource) {
    return fail('invalid_target', 'The requested resource is not served by this authorization server.');
  }

  // The employer connector reaches applicants' details and can spend posting
  // credits. Registration is open, so it connects only where no stranger's
  // server can receive the code: Claude's or ChatGPT's own callback, or an
  // app on the person's own computer. Shown here rather than sent back to an
  // address we cannot vouch for.
  if (resource.id === 'employer') {
    const target = describeRedirectTarget(redirectUri);
    if (!target.verifiedAs && !target.local) {
      return {
        kind: 'error_page',
        status: 400,
        message:
          `${brand.name} for Employers connects from Claude, ChatGPT or an app on your own computer. This app would send you back to a website we cannot verify, so it cannot connect to an employer account.`,
      };
    }
  }

  const requestId = generateSecret(TOKEN_PREFIX.request, 24);
  await prisma.oAuthAuthorizationRequest.create({
    data: {
      id: requestId,
      clientId: client.clientId,
      redirectUri,
      resource: resourceUrl(resource.id),
      // One scope per endpoint. A request for something else (or nothing) is
      // answered with the endpoint's scope, which the token response reports,
      // as RFC 6749 section 3.3 allows.
      scope: resource.scope,
      state,
      codeChallenge,
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_SECONDS * 1000),
    },
  });

  return { kind: 'redirect', location: consentPath(requestId) };
}

/** The consent page for a parked request. Relative, so it stays on this origin. */
export function consentPath(requestId: string): string {
  return `${OAUTH_ENDPOINTS.consent}?req=${encodeURIComponent(requestId)}`;
}

export interface PendingAuthorization {
  id: string;
  clientId: string;
  clientName: string;
  /** Every redirect URI the client registered, which decides whether it is verified. */
  clientRedirectUris: string[];
  redirectUri: string;
  resource: string;
  scope: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: Date;
}

/** A parked request that has not expired, with its client's display name. */
export async function loadPendingAuthorization(requestId: unknown): Promise<PendingAuthorization | null> {
  if (typeof requestId !== 'string' || !requestId.startsWith(TOKEN_PREFIX.request) || requestId.length > 100) {
    return null;
  }
  const row = await prisma.oAuthAuthorizationRequest.findUnique({
    where: { id: requestId },
    include: { client: { select: { clientName: true, redirectUris: true } } },
  });
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.clientName,
    clientRedirectUris: row.client.redirectUris,
    redirectUri: row.redirectUri,
    resource: row.resource,
    scope: row.scope,
    state: row.state,
    codeChallenge: row.codeChallenge,
    codeChallengeMethod: row.codeChallengeMethod,
    expiresAt: row.expiresAt,
  };
}
