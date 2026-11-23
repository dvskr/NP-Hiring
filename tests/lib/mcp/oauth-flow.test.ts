/**
 * The OAuth server end to end: register, authorize, consent, exchange,
 * verify, rotate and revoke, against an in-memory copy of the five tables.
 *
 * What these pin, in the order an attacker would try them:
 *  - a request is single use, and the employer connector cannot be approved
 *    by a job seeker account;
 *  - a code needs its PKCE verifier, its redirect URI and its client, and a
 *    replayed code revokes the connection it came from;
 *  - a token works only on the endpoint it was issued for;
 *  - a spent refresh token gets one retry inside the grace window, and any
 *    other replay revokes everything;
 *  - the employer connector refuses an app that would send the code to an
 *    unverified website;
 *  - disconnecting in settings is immediate and only works on your own grant;
 *  - registrations nobody uses are cleaned up, and nothing in use is.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeOAuthDb } from '../../helpers/oauth-fake-db';
import { brand } from '@/config/brand';


vi.mock('@/lib/prisma', async () => {
  const { fakeOAuthDb: db } = await import('../../helpers/oauth-fake-db');
  return { prisma: db.prisma };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { findClient, isRegistrationError, registerClient, validateRegistration } from '@/lib/mcp/oauth/clients';
import { handleAuthorizeRequest } from '@/lib/mcp/oauth/authorize';
import { decideAuthorization } from '@/lib/mcp/oauth/consent';
import {
  exchangeAuthorizationCode,
  isTokenError,
  refreshAccessToken,
  revokeToken,
  verifyAccessToken,
  type TokenResponse,
} from '@/lib/mcp/oauth/tokens';
import { disconnectApp, listConnectedApps, purgeSpentOAuthRows } from '@/lib/mcp/oauth/grants';
import { getIssuer, resourceUrl, REFRESH_REUSE_GRACE_SECONDS, SPENT_REFRESH_RETENTION_SECONDS, TOKEN_PREFIX } from '@/lib/mcp/oauth/config';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const SEEKER = { supabaseId: 'seeker-fic-1', email: 'seeker@example.test', role: 'job_seeker', deletedAt: null };
const EMPLOYER = { supabaseId: 'employer-fic-1', email: 'hr@clinic.example.test', role: 'employer', deletedAt: null };

async function registered(redirectUris: string[] = [REDIRECT]) {
  const validated = validateRegistration({
    client_name: 'Claude',
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
  });
  if (isRegistrationError(validated)) throw new Error('registration failed');
  const response = await registerClient(validated);
  return (await findClient(response.client_id))!;
}

function authorizeParams(clientId: string, overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'state-fic-1',
    resource: resourceUrl('candidate'),
    ...overrides,
  });
}

async function parkRequest(clientId: string, overrides: Record<string, string> = {}): Promise<string> {
  const outcome = await handleAuthorizeRequest(authorizeParams(clientId, overrides));
  if (outcome.kind !== 'redirect') throw new Error(`authorize failed: ${outcome.message}`);
  const requestId = new URL(outcome.location, 'https://fic.example').searchParams.get('req');
  if (!requestId) throw new Error('no request id');
  return requestId;
}

async function connect(user = SEEKER, overrides: Record<string, string> = {}) {
  const client = await registered();
  const requestId = await parkRequest(client.clientId, overrides);
  const decision = await decideAuthorization({ requestId, approve: true, user });
  if (decision.kind !== 'redirect') throw new Error(`decision failed: ${decision.message}`);
  const code = new URL(decision.location).searchParams.get('code')!;
  const tokens = await exchangeAuthorizationCode({
    client,
    code,
    redirectUri: REDIRECT,
    codeVerifier: VERIFIER,
    resource: overrides.resource ?? resourceUrl('candidate'),
  });
  if (isTokenError(tokens)) throw new Error(`exchange failed: ${tokens.error_description}`);
  return { client, tokens, code };
}

beforeEach(() => {
  fakeOAuthDb.reset();
  fakeOAuthDb.state.users.set(SEEKER.supabaseId, { ...SEEKER });
  fakeOAuthDb.state.users.set(EMPLOYER.supabaseId, { ...EMPLOYER });
});

describe('authorization endpoint', () => {
  it('never redirects for an unknown client or an unregistered redirect URI', async () => {
    const unknown = await handleAuthorizeRequest(authorizeParams(`${TOKEN_PREFIX.clientId}nope`));
    expect(unknown.kind).toBe('error_page');
    const client = await registered();
    const foreign = await handleAuthorizeRequest(authorizeParams(client.clientId, { redirect_uri: 'https://evil.example/cb' }));
    expect(foreign.kind).toBe('error_page');
  });

  it.each([
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ code_challenge: '' }, 'invalid_request'],
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ resource: 'https://evil.example/mcp' }, 'invalid_target'],
  ])('reports %j to the client with state and iss', async (overrides, error) => {
    const client = await registered();
    const params = authorizeParams(client.clientId, overrides as Record<string, string>);
    if ((overrides as Record<string, string>).code_challenge === '') params.delete('code_challenge');
    const outcome = await handleAuthorizeRequest(params);
    expect(outcome.kind).toBe('redirect');
    const location = new URL((outcome as { location: string }).location);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get('error')).toBe(error);
    expect(location.searchParams.get('state')).toBe('state-fic-1');
    expect(location.searchParams.get('iss')).toBe(getIssuer());
  });

  it('parks a valid request and sends the browser to consent with only an opaque id', async () => {
    const client = await registered();
    const outcome = await handleAuthorizeRequest(authorizeParams(client.clientId));
    expect(outcome.kind).toBe('redirect');
    expect((outcome as { location: string }).location).toMatch(new RegExp(`^/oauth/consent\\?req=${TOKEN_PREFIX.request}[A-Za-z0-9_-]+$`));
  });

  it('refuses the employer connector while the engine does not serve it, and still connects job seekers', async () => {
    // The employer phase brings back the reference rule here: the employer
    // connector connects only from a verified assistant or this computer.
    const employer = { resource: resourceUrl('employer') };
    const claude = await registered();
    const refused = await handleAuthorizeRequest(authorizeParams(claude.clientId, employer));
    // A standard OAuth error back to the app, and nothing parked.
    expect(refused.kind).toBe('redirect');
    expect(new URL((refused as { location: string }).location).searchParams.get('error')).toBe('invalid_target');
    expect(fakeOAuthDb.state.requests.size).toBe(0);
    const seeker = await handleAuthorizeRequest(authorizeParams(claude.clientId));
    expect(seeker.kind).toBe('redirect');
    expect(fakeOAuthDb.state.requests.size).toBe(1);
  });

  it('tells an app with a deleted registration how to recover', async () => {
    const outcome = await handleAuthorizeRequest(authorizeParams(`${TOKEN_PREFIX.clientId}purged`));
    expect(outcome).toMatchObject({ kind: 'error_page' });
    expect((outcome as { message: string }).message).toMatch(/add it again/);
  });
});

describe('consent', () => {
  it('returns code, state and iss to the registered redirect URI', async () => {
    const client = await registered();
    const requestId = await parkRequest(client.clientId);
    const decision = await decideAuthorization({ requestId, approve: true, user: SEEKER });
    expect(decision.kind).toBe('redirect');
    const location = new URL((decision as { location: string }).location);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get('code')).toMatch(new RegExp(`^${TOKEN_PREFIX.code}`));
    expect(location.searchParams.get('state')).toBe('state-fic-1');
    expect(location.searchParams.get('iss')).toBe(getIssuer());
  });

  it('is single use', async () => {
    const client = await registered();
    const requestId = await parkRequest(client.clientId);
    await decideAuthorization({ requestId, approve: true, user: SEEKER });
    const second = await decideAuthorization({ requestId, approve: true, user: SEEKER });
    expect(second.kind).toBe('error');
  });

  it('a denial goes back as access_denied and issues nothing', async () => {
    const client = await registered();
    const requestId = await parkRequest(client.clientId);
    const decision = await decideAuthorization({ requestId, approve: false, user: SEEKER });
    expect(new URL((decision as { location: string }).location).searchParams.get('error')).toBe('access_denied');
    expect(fakeOAuthDb.state.codes.size).toBe(0);
  });

  it('refuses a parked employer request for every account while the engine does not serve the employer connector', async () => {
    // /oauth/authorize never parks one, so this parks a job seeker request
    // and points it at the employer connector, as a request that arrived
    // some other way would be. The employer phase brings back the reference
    // rule here: a job seeker cannot approve it, an employer can.
    const client = await registered();
    const requestId = await parkRequest(client.clientId);
    const row = fakeOAuthDb.state.requests.get(requestId) as { resource: string };
    row.resource = resourceUrl('employer');
    for (const user of [SEEKER, EMPLOYER]) {
      const refused = await decideAuthorization({ requestId, approve: true, user });
      expect(refused.kind).toBe('error');
      expect((refused as { code: string }).code).toBe('expired');
    }
    expect(fakeOAuthDb.state.grants.size).toBe(0);
  });

  it('refuses an account scheduled for deletion', async () => {
    const client = await registered();
    const requestId = await parkRequest(client.clientId);
    const decision = await decideAuthorization({ requestId, approve: true, user: { ...SEEKER, deletedAt: new Date() } });
    expect(decision.kind).toBe('error');
  });
});

describe('token endpoint and verification', () => {
  it('issues a token pair that works on its own endpoint only', async () => {
    const { tokens } = await connect();
    expect(tokens.access_token).toMatch(new RegExp(`^${TOKEN_PREFIX.access}`));
    expect(tokens.refresh_token).toMatch(new RegExp(`^${TOKEN_PREFIX.refresh}`));
    expect(tokens.scope).toBe('candidate');

    const ok = await verifyAccessToken(tokens.access_token, resourceUrl('candidate'), 'candidate');
    expect(ok.ok && ok.access.userId).toBe(SEEKER.supabaseId);

    const elsewhere = await verifyAccessToken(tokens.access_token, resourceUrl('employer'), 'employer');
    expect(elsewhere).toEqual({ ok: false, reason: 'wrong_resource' });
    // A refresh token is not an access token.
    expect((await verifyAccessToken(tokens.refresh_token, resourceUrl('candidate'), 'candidate')).ok).toBe(false);
  });

  it('refuses a wrong verifier, a wrong redirect URI and another client', async () => {
    const client = await registered();
    const other = await registered();
    const requestId = await parkRequest(client.clientId);
    const decision = await decideAuthorization({ requestId, approve: true, user: SEEKER });
    const code = new URL((decision as { location: string }).location).searchParams.get('code')!;
    const base = { client, code, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: null };

    expect(await exchangeAuthorizationCode({ ...base, codeVerifier: 'a'.repeat(43) })).toMatchObject({ error: 'invalid_grant' });
    expect(await exchangeAuthorizationCode({ ...base, redirectUri: 'https://claude.ai/other' })).toMatchObject({ error: 'invalid_grant' });
    expect(await exchangeAuthorizationCode({ ...base, client: other })).toMatchObject({ error: 'invalid_grant' });
    // Still unused, so the right request succeeds.
    expect(isTokenError(await exchangeAuthorizationCode(base))).toBe(false);
  });

  it('may omit redirect_uri only when the client registered exactly one', async () => {
    const single = await registered();
    const decision = await decideAuthorization({ requestId: await parkRequest(single.clientId), approve: true, user: SEEKER });
    const code = new URL((decision as { location: string }).location).searchParams.get('code')!;
    expect(isTokenError(await exchangeAuthorizationCode({ client: single, code, redirectUri: null, codeVerifier: VERIFIER, resource: null }))).toBe(false);

    const two = await registered([REDIRECT, 'http://localhost/callback']);
    const second = await decideAuthorization({ requestId: await parkRequest(two.clientId), approve: true, user: SEEKER });
    const secondCode = new URL((second as { location: string }).location).searchParams.get('code')!;
    expect(
      await exchangeAuthorizationCode({ client: two, code: secondCode, redirectUri: null, codeVerifier: VERIFIER, resource: null }),
    ).toMatchObject({ error: 'invalid_grant' });
  });

  it('a replayed code is refused and revokes what it issued', async () => {
    const { client, code, tokens } = await connect();
    const replay = await exchangeAuthorizationCode({ client, code, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: null });
    expect(replay).toMatchObject({ error: 'invalid_grant' });
    expect((await verifyAccessToken(tokens.access_token, resourceUrl('candidate'), 'candidate')).ok).toBe(false);
  });

  it('an expired code is refused', async () => {
    const client = await registered();
    const requestId = await parkRequest(client.clientId);
    const decision = await decideAuthorization({ requestId, approve: true, user: SEEKER });
    const code = new URL((decision as { location: string }).location).searchParams.get('code')!;
    for (const row of fakeOAuthDb.state.codes.values()) row.expiresAt = new Date(Date.now() - 1000);
    expect(await exchangeAuthorizationCode({ client, code, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: null })).toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('reports an expired access token as expired, so hosts refresh', async () => {
    const { tokens } = await connect();
    for (const row of fakeOAuthDb.state.tokens.values()) if (row.kind === 'access') row.expiresAt = new Date(Date.now() - 1000);
    expect(await verifyAccessToken(tokens.access_token, resourceUrl('candidate'), 'candidate')).toEqual({ ok: false, reason: 'expired' });
  });

  it('stops working the moment the account is scheduled for deletion', async () => {
    const { tokens } = await connect();
    fakeOAuthDb.state.users.get(SEEKER.supabaseId)!.deletedAt = new Date();
    expect((await verifyAccessToken(tokens.access_token, resourceUrl('candidate'), 'candidate')).ok).toBe(false);
  });
});

describe('refresh token rotation', () => {
  it('rotates, and gives one retry inside the grace window a pair', async () => {
    const { client, tokens } = await connect();
    const first = await refreshAccessToken({ client, refreshToken: tokens.refresh_token, resource: null, scope: null });
    expect(isTokenError(first)).toBe(false);
    expect((first as TokenResponse).refresh_token).not.toBe(tokens.refresh_token);
    const retry = await refreshAccessToken({ client, refreshToken: tokens.refresh_token, resource: null, scope: null });
    expect(isTokenError(retry)).toBe(false);
  });

  it('a second reuse, however soon, is a copy, and the whole connection goes', async () => {
    const { client, tokens } = await connect();
    const first = (await refreshAccessToken({ client, refreshToken: tokens.refresh_token, resource: null, scope: null })) as TokenResponse;
    await refreshAccessToken({ client, refreshToken: tokens.refresh_token, resource: null, scope: null });
    const third = await refreshAccessToken({ client, refreshToken: tokens.refresh_token, resource: null, scope: null });
    expect(third).toMatchObject({ error: 'invalid_grant' });
    expect((await verifyAccessToken(first.access_token, resourceUrl('candidate'), 'candidate')).ok).toBe(false);
  });

  it('keeps a spent token only as long as reuse detection needs it', async () => {
    const { client, tokens } = await connect();
    await refreshAccessToken({ client, refreshToken: tokens.refresh_token, resource: null, scope: null });
    const spent = [...fakeOAuthDb.state.tokens.values()].find((t) => t.kind === 'refresh' && t.rotatedAt);
    const keptFor = (spent!.expiresAt as Date).getTime() - Date.now();
    expect(keptFor).toBeLessThanOrEqual(SPENT_REFRESH_RETENTION_SECONDS * 1000);
    expect(keptFor).toBeGreaterThan((SPENT_REFRESH_RETENTION_SECONDS - 60) * 1000);
  });

  it('a replay after the grace window revokes the whole connection', async () => {
    const { client, tokens } = await connect();
    const next = (await refreshAccessToken({ client, refreshToken: tokens.refresh_token, resource: null, scope: null })) as TokenResponse;
    for (const row of fakeOAuthDb.state.tokens.values()) {
      if (row.rotatedAt) row.rotatedAt = new Date(Date.now() - (REFRESH_REUSE_GRACE_SECONDS + 5) * 1000);
    }
    const replay = await refreshAccessToken({ client, refreshToken: tokens.refresh_token, resource: null, scope: null });
    expect(replay).toMatchObject({ error: 'invalid_grant' });
    expect((await verifyAccessToken(next.access_token, resourceUrl('candidate'), 'candidate')).ok).toBe(false);
    expect(await refreshAccessToken({ client, refreshToken: next.refresh_token, resource: null, scope: null })).toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('cannot widen scope or move to another endpoint', async () => {
    const { client, tokens } = await connect();
    expect(await refreshAccessToken({ client, refreshToken: tokens.refresh_token, resource: null, scope: 'candidate employer' })).toMatchObject({
      error: 'invalid_scope',
    });
    expect(
      await refreshAccessToken({ client, refreshToken: tokens.refresh_token, resource: resourceUrl('employer'), scope: null }),
    ).toMatchObject({ error: 'invalid_target' });
  });
});

describe('revocation and Connected apps', () => {
  it('revoking a refresh token ends the connection', async () => {
    const { client, tokens } = await connect();
    await revokeToken(client, tokens.refresh_token);
    expect((await verifyAccessToken(tokens.access_token, resourceUrl('candidate'), 'candidate')).ok).toBe(false);
  });

  it('another client cannot revoke a token it does not own', async () => {
    const { tokens } = await connect();
    const other = await registered();
    await revokeToken(other, tokens.refresh_token);
    expect((await verifyAccessToken(tokens.access_token, resourceUrl('candidate'), 'candidate')).ok).toBe(true);
  });

  it('lists the connection and disconnects it for its owner only', async () => {
    const { tokens } = await connect();
    const apps = await listConnectedApps(SEEKER.supabaseId);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ clientName: 'Claude', verifiedAs: 'Claude', connector: brand.name });

    expect(await disconnectApp(EMPLOYER.supabaseId, apps[0].grantId)).toBe(false);
    expect((await verifyAccessToken(tokens.access_token, resourceUrl('candidate'), 'candidate')).ok).toBe(true);

    expect(await disconnectApp(SEEKER.supabaseId, apps[0].grantId)).toBe(true);
    expect((await verifyAccessToken(tokens.access_token, resourceUrl('candidate'), 'candidate')).ok).toBe(false);
    expect(await listConnectedApps(SEEKER.supabaseId)).toHaveLength(0);
  });

  it('does not vouch for an app that also registered an address of its own', async () => {
    const client = await registered([REDIRECT, 'https://evil.example/cb']);
    await decideAuthorization({ requestId: await parkRequest(client.clientId), approve: true, user: SEEKER });
    const [app] = await listConnectedApps(SEEKER.supabaseId);
    expect(app.verifiedAs).toBeNull();
  });

  it('approving the same app again after a disconnect does not revive the old tokens', async () => {
    const client = await registered();
    const approve = async () => {
      const requestId = await parkRequest(client.clientId);
      const decision = await decideAuthorization({ requestId, approve: true, user: SEEKER });
      const code = new URL((decision as { location: string }).location).searchParams.get('code')!;
      return (await exchangeAuthorizationCode({ client, code, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: null })) as TokenResponse;
    };
    const old = await approve();
    const [app] = await listConnectedApps(SEEKER.supabaseId);
    await disconnectApp(SEEKER.supabaseId, app.grantId);

    const fresh = await approve();
    // Same grant row, reused by the upsert.
    expect(fakeOAuthDb.state.grants.size).toBe(1);
    expect((await verifyAccessToken(old.access_token, resourceUrl('candidate'), 'candidate')).ok).toBe(false);
    expect((await verifyAccessToken(fresh.access_token, resourceUrl('candidate'), 'candidate')).ok).toBe(true);
  });
});

describe('cleanup', () => {
  it('deletes registrations nobody connected after 30 days, and nothing still in use', async () => {
    const unused = await registered();
    const recent = await registered();
    const { client: connected } = await connect();
    const pendingClient = await registered();
    await parkRequest(pendingClient.clientId);
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    for (const client of [unused, connected, pendingClient]) fakeOAuthDb.state.clients.get(client.clientId)!.createdAt = old;

    const deleted = await purgeSpentOAuthRows();
    expect(deleted.clients).toBe(1);
    expect(await findClient(unused.clientId)).toBeNull();
    expect(await findClient(recent.clientId)).not.toBeNull();
    expect(await findClient(connected.clientId)).not.toBeNull();
    expect(await findClient(pendingClient.clientId)).not.toBeNull();
  });

  it('a registration whose last connection was purged goes in the same run', async () => {
    const { client } = await connect();
    const [app] = await listConnectedApps(SEEKER.supabaseId);
    await disconnectApp(SEEKER.supabaseId, app.grantId);
    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    fakeOAuthDb.state.grants.get(app.grantId)!.revokedAt = longAgo;
    fakeOAuthDb.state.clients.get(client.clientId)!.createdAt = longAgo;

    const deleted = await purgeSpentOAuthRows();
    expect(deleted).toMatchObject({ grants: 1, clients: 1 });
    expect(fakeOAuthDb.state.tokens.size).toBe(0);
  });
});
