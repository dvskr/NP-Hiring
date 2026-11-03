/**
 * OAuth clients (design 2.4). Two kinds, told apart by the client_id alone:
 *   - an https URL: a Client ID Metadata Document (lib/oauth/cimd.ts),
 *     fetched and cached, never stored;
 *   - "dcr_" and 32 base64url characters: a client registered through
 *     POST /oauth/register and stored in oauth_clients.
 * Every client is public (token_endpoint_auth_method "none"): PKCE, the
 * redirect URI match and the code's single use carry the security.
 */
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
    DCR_DEFAULT_CLIENT_NAME,
    DCR_MAX_REDIRECT_URIS,
    MAX_CLIENT_ID_LENGTH,
    MAX_CLIENT_NAME_LENGTH,
    dcrRedirectHosts,
} from '@/lib/oauth/config';
import { fetchClientMetadata, isCimdClientId, parseCimdUrl, type CimdOptions } from '@/lib/oauth/cimd';
import { cleanClientName } from '@/lib/oauth/client-name';
import { isAllowedDcrRedirectUri, redirectHostLabel } from '@/lib/oauth/redirect-uri';

export type ClientKind = 'cimd' | 'dcr';

export interface OAuthClientInfo {
    clientId: string;
    clientName: string;
    redirectUris: string[];
    kind: ClientKind;
}

export type ClientResolution = { ok: true; client: OAuthClientInfo } | { ok: false };

/** "dcr_" and 24 random bytes in base64url (design 2.4). */
const DCR_CLIENT_ID = /^dcr_[A-Za-z0-9_-]{32}$/;

/** Which kind of client a client_id names by its shape, or null when it can name none. */
export function clientIdKind(clientId: string): ClientKind | null {
    if (isCimdClientId(clientId)) return clientId.length <= MAX_CLIENT_ID_LENGTH ? 'cimd' : null;
    return DCR_CLIENT_ID.test(clientId) ? 'dcr' : null;
}

/**
 * What a log line may say about a client: the metadata document's host, or
 * "dcr" for a registered client (design: log the client by host only).
 */
export function clientLogLabel(clientId: string): string {
    const kind = clientIdKind(clientId);
    if (kind === 'cimd') return parseCimdUrl(clientId)?.hostname ?? 'cimd';
    return kind ?? 'unknown';
}

/** The client a client_id names (design 2.5 step 1), or { ok: false }. */
export async function resolveClient(clientId: string, options: CimdOptions = {}): Promise<ClientResolution> {
    const kind = clientIdKind(clientId);
    if (kind === 'cimd') {
        const result = await fetchClientMetadata(clientId, options);
        if (!result.ok) {
            logger.info('[oauth] client metadata document refused', { client: clientLogLabel(clientId), reason: result.reason });
            return { ok: false };
        }
        const { document } = result;
        return { ok: true, client: { clientId, clientName: document.clientName, redirectUris: document.redirectUris, kind } };
    }
    if (kind === 'dcr') {
        const row = await prisma.oauthClient.findUnique({
            where: { id: clientId },
            select: { id: true, clientName: true, redirectUris: true },
        });
        if (!row) return { ok: false };
        return { ok: true, client: { clientId: row.id, clientName: row.clientName, redirectUris: row.redirectUris, kind } };
    }
    return { ok: false };
}

/**
 * Records that a registered client was just used (a candidate allowed it),
 * so registrations nobody uses can be told apart later. Best effort: a
 * failure is logged and never fails the caller.
 */
export async function markClientUsed(client: OAuthClientInfo, now: Date): Promise<void> {
    if (client.kind !== 'dcr') return;
    try {
        await prisma.oauthClient.updateMany({ where: { id: client.clientId }, data: { lastUsedAt: now } });
    } catch (error) {
        logger.warn('[oauth] could not record client use', { client: 'dcr' }, error);
    }
}

// ── Dynamic Client Registration (RFC 7591, design 2.4) ────────────────────

export interface RegistrationInput {
    clientName: string;
    redirectUris: string[];
}

export type RegistrationCheck =
    | { ok: true; value: RegistrationInput }
    | { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string };

export interface RegistrationResponse {
    client_id: string;
    client_id_issued_at: number;
    client_name: string;
    redirect_uris: string[];
    grant_types: ['authorization_code', 'refresh_token'];
    response_types: ['code'];
    token_endpoint_auth_method: 'none';
}

const RedirectUrisSchema = z.array(z.string()).min(1).max(DCR_MAX_REDIRECT_URIS);

/** Unknown metadata is ignored (RFC 7591 section 2); these are the fields with rules. */
const ClientMetadataSchema = z.object({
    token_endpoint_auth_method: z.literal('none').optional(),
    grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(),
    response_types: z.array(z.literal('code')).optional(),
    client_name: z.string().optional(),
});

/**
 * A registration body checked against design 2.4. Redirect URI problems
 * answer invalid_redirect_uri; every other problem invalid_client_metadata.
 * tests/oauth/register.test.ts
 */
export function checkRegistration(body: Record<string, unknown>): RegistrationCheck {
    const uris = RedirectUrisSchema.safeParse(body.redirect_uris);
    if (!uris.success) {
        return {
            ok: false,
            error: 'invalid_redirect_uri',
            description: `redirect_uris must list 1 to ${DCR_MAX_REDIRECT_URIS} URIs.`,
        };
    }
    const allowedHosts = dcrRedirectHosts();
    if (!uris.data.every((uri) => isAllowedDcrRedirectUri(uri, allowedHosts))) {
        return {
            ok: false,
            error: 'invalid_redirect_uri',
            description: 'Each redirect URI must be https on an allowed host or http on a loopback address, with no fragment, in at most 512 characters.',
        };
    }
    const metadata = ClientMetadataSchema.safeParse(body);
    if (!metadata.success) {
        return {
            ok: false,
            error: 'invalid_client_metadata',
            description: 'token_endpoint_auth_method must be none, grant_types may list only authorization_code and refresh_token, response_types only code, and client_name must be a string.',
        };
    }
    const name = metadata.data.client_name === undefined ? null : cleanClientName(metadata.data.client_name);
    if (name !== null && name.length > MAX_CLIENT_NAME_LENGTH) {
        return { ok: false, error: 'invalid_client_metadata', description: `client_name must be at most ${MAX_CLIENT_NAME_LENGTH} characters.` };
    }
    return { ok: true, value: { clientName: name ?? DCR_DEFAULT_CLIENT_NAME, redirectUris: [...new Set(uris.data)] } };
}

/** Stores a checked registration and answers the RFC 7591 response (design 2.4). */
export async function registerClient(input: RegistrationInput, now: Date = new Date()): Promise<RegistrationResponse> {
    const clientId = `dcr_${randomBytes(24).toString('base64url')}`;
    await prisma.oauthClient.create({
        data: { id: clientId, clientName: input.clientName, redirectUris: input.redirectUris, createdAt: now },
    });
    logger.info('[oauth] client registered', {
        client: 'dcr',
        redirectHosts: [...new Set(input.redirectUris.map(redirectHostLabel))],
    });
    return {
        client_id: clientId,
        client_id_issued_at: Math.floor(now.getTime() / 1000),
        client_name: input.clientName,
        redirect_uris: input.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
    };
}
