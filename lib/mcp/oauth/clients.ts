import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { TOKEN_PREFIX, getIssuer, parseScope, type OAuthScope } from './config';
import { generateSecret, hashSecret, safeEqual } from './crypto';

/**
 * OAuth clients: Dynamic Client Registration (RFC 7591) and lookup.
 *
 * Registration is open by design. That is how MCP hosts introduce
 * themselves, and it is what both ChatGPT and Claude do on first connect.
 * Open registration means a client's name, and even its claim to be Claude,
 * prove nothing, so the defences live elsewhere:
 *
 *  - redirect URIs are restricted to shapes that cannot run script or land
 *    on another page of ours (see isAcceptableRedirectUri);
 *  - the consent screen shows the host the person is about to be sent to,
 *    and marks an app "verified" only when every address it registered is
 *    one of Claude's or ChatGPT's exact callbacks, never from its name;
 *  - the employer connector refuses apps that would send the code to an
 *    unverified web address (see authorize.ts);
 *  - every code is PKCE-bound, so a code intercepted on the way back is
 *    useless without the verifier the real client holds.
 */

export const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 2000;
/** All redirect URIs together. Real clients register one or two short ones. */
const MAX_REDIRECT_URIS_TOTAL_LENGTH = 2048;
const MAX_CLIENT_NAME_LENGTH = 120;
const DEFAULT_CLIENT_NAME = 'Unnamed app';

export type TokenEndpointAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';
const AUTH_METHODS: readonly TokenEndpointAuthMethod[] = ['none', 'client_secret_post', 'client_secret_basic'];
const GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;

/** Loopback hosts may use plain http (RFC 8252 section 7.3). */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** This site's own domain. No client has a reason to come back to one of our pages. */
const OWN_DOMAIN = brand.domain.toLowerCase();

/**
 * Whether a redirect would land on this site: the board's own domain, any of its
 * subdomains, or the host this deployment serves from (a preview or a local
 * run, port included, so a local MCP client's own loopback port still
 * passes). A trailing dot names the same host to a browser, so it is ignored.
 */
function isOwnHost(url: URL): boolean {
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (hostname === OWN_DOMAIN || hostname.endsWith(`.${OWN_DOMAIN}`)) return true;
  try {
    const issuer = new URL(getIssuer());
    return issuer.hostname.toLowerCase() === hostname && issuer.port === url.port;
  } catch {
    return false;
  }
}

/**
 * Private-use URI schemes of desktop MCP clients (RFC 8252 section 7.1).
 * An allow-list rather than "any scheme", because the consent screen sends
 * the browser to this URI with location.assign, and `javascript:` or
 * `data:` there would run in our origin.
 */
const PRIVATE_USE_SCHEMES: ReadonlySet<string> = new Set([
  'cursor',
  'vscode',
  'vscode-insiders',
  'windsurf',
  'zed',
]);

export function isAcceptableRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_REDIRECT_URI_LENGTH) return false;
  if (/[\x00-\x20\x7f]/.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // RFC 6749 section 3.1.2: a redirection endpoint MUST NOT include a fragment.
  if (url.hash || raw.includes('#')) return false;
  if (url.username || url.password) return false;
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  // No client has a reason to come back to our own pages, and a code landing
  // on one would sit in a URL that analytics and referrers can see.
  if (isOwnHost(url)) return false;
  if (scheme === 'https') return url.hostname.length > 0;
  if (scheme === 'http') return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  return PRIVATE_USE_SCHEMES.has(scheme);
}

/**
 * The exact callback addresses of the two assistants this server is built
 * for, from their docs (checked 2026-10-25). Host and path must both match:
 * chatgpt.com also serves custom GPT action callbacks, whose tokens go to
 * whoever wrote that GPT, and those must not read as "ChatGPT".
 */
const VERIFIED_CALLBACKS: ReadonlyArray<{ host: string; path: RegExp; label: string }> = [
  { host: 'claude.ai', path: /^\/api\/mcp\/auth_callback$/, label: 'Claude' },
  // Where Anthropic says the callback may move.
  { host: 'claude.com', path: /^\/api\/mcp\/auth_callback$/, label: 'Claude' },
  { host: 'chatgpt.com', path: /^\/connector_platform_oauth_redirect$/, label: 'ChatGPT' },
  // ChatGPT's per-connection callback, for servers without RFC 9207 support.
  { host: 'chatgpt.com', path: /^\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/, label: 'ChatGPT' },
  { host: 'platform.openai.com', path: /^\/apps-manage\/oauth$/, label: 'ChatGPT' },
];

/** Claude or ChatGPT when the URL is one of their callbacks exactly, with nothing added. */
function verifiedCallbackLabel(url: URL): string | null {
  if (url.protocol !== 'https:' || url.port !== '' || url.search !== '' || url.hash !== '') return null;
  // The parser lowercases the host. A trailing dot is left in, so it matches nothing.
  return VERIFIED_CALLBACKS.find((c) => c.host === url.hostname && c.path.test(url.pathname))?.label ?? null;
}

export interface RedirectTarget {
  /** What the consent screen prints: a host, or the scheme for a desktop app. */
  display: string;
  /** Set only when the redirect is exactly one of Claude's or ChatGPT's callbacks. */
  verifiedAs: string | null;
  /**
   * The code would land on the person's own computer: a loopback address or
   * a desktop app's own scheme, which no remote site can receive.
   */
  local: boolean;
}

export function describeRedirectTarget(redirectUri: string): RedirectTarget {
  try {
    const url = new URL(redirectUri);
    const host = url.hostname.toLowerCase();
    const scheme = url.protocol.slice(0, -1).toLowerCase();
    if (scheme === 'https') return { display: host, verifiedAs: verifiedCallbackLabel(url), local: false };
    if (scheme === 'http') return { display: `${host} (this computer)`, verifiedAs: null, local: LOOPBACK_HOSTS.has(host) };
    return { display: `the ${scheme} app on this computer`, verifiedAs: null, local: PRIVATE_USE_SCHEMES.has(scheme) };
  } catch {
    return { display: 'an unknown address', verifiedAs: null, local: false };
  }
}

/**
 * The assistant a client is verified as, or null. Every redirect URI it
 * registered must be that assistant's callback: a client that also
 * registered some other address can have a code sent there instead, so
 * neither the consent screen nor Connected apps may vouch for it.
 */
export function verifiedClientLabel(redirectUris: readonly string[]): string | null {
  const labels = new Set(redirectUris.map((uri) => describeRedirectTarget(uri).verifiedAs));
  return labels.size === 1 ? ([...labels][0] ?? null) : null;
}

/** [from, to] code points a display name must not carry. */
const UNSAFE_DISPLAY_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f], // control characters
  [0x7f, 0x9f], // delete and C1 controls
  [0xad, 0xad], // soft hyphen
  [0x61c, 0x61c], // Arabic letter mark
  [0x180e, 0x180e], // Mongolian vowel separator
  [0x200b, 0x200f], // zero-width spaces and joiners, direction marks
  [0x2028, 0x202e], // line and paragraph separators, bidi embeddings and overrides
  [0x2060, 0x206f], // word joiner, invisible operators, bidi isolates
  [0xfe00, 0xfe0f], // variation selectors
  [0xfeff, 0xfeff], // byte order mark
];
const hex4 = (n: number) => n.toString(16).padStart(4, '0');
/**
 * Controls, markup, and the invisible characters that can make a name read
 * as something else on the consent screen (a bidi override can reverse the
 * end of a name). Built from code points so no invisible character has to
 * sit in this source file.
 */
const UNSAFE_DISPLAY_CHARS = new RegExp(
  `[<>${UNSAFE_DISPLAY_RANGES.map(([from, to]) => `\\u${hex4(from)}-\\u${hex4(to)}`).join('')}]`,
  'g',
);

/** A self-asserted display string, safe to show: no controls, markup or invisible characters. */
export function cleanDisplayString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(UNSAFE_DISPLAY_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return cleaned.length > 0 ? cleaned : null;
}

function optionalHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface RegistrationError {
  error: 'invalid_redirect_uri' | 'invalid_client_metadata';
  error_description: string;
}

export interface RegisteredClientResponse {
  client_id: string;
  client_id_issued_at: number;
  client_secret?: string;
  client_secret_expires_at?: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: TokenEndpointAuthMethod;
  scope?: string;
}

export interface ValidatedRegistration {
  clientName: string;
  clientUri: string | null;
  redirectUris: string[];
  grantTypes: string[];
  authMethod: TokenEndpointAuthMethod;
  scope: OAuthScope[];
  softwareId: string | null;
  softwareVersion: string | null;
}

/**
 * Validates an RFC 7591 registration body. Pure, so it is tested without a
 * database. Unknown fields are ignored, as section 2 requires.
 */
export function validateRegistration(body: Record<string, unknown>): ValidatedRegistration | RegistrationError {
  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be a non-empty array.' };
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    return { error: 'invalid_redirect_uri', error_description: `At most ${MAX_REDIRECT_URIS} redirect_uris are accepted.` };
  }
  for (const uri of redirectUris) {
    if (!isAcceptableRedirectUri(uri)) {
      return {
        error: 'invalid_redirect_uri',
        error_description: 'Each redirect URI must be https, http on a loopback address, or a known desktop app scheme, with no fragment.',
      };
    }
  }
  if ((redirectUris as string[]).reduce((total, uri) => total + uri.length, 0) > MAX_REDIRECT_URIS_TOTAL_LENGTH) {
    return {
      error: 'invalid_redirect_uri',
      error_description: `redirect_uris may total at most ${MAX_REDIRECT_URIS_TOTAL_LENGTH} characters.`,
    };
  }

  // RFC 7591 section 2: the default is client_secret_basic when omitted.
  const rawMethod = body.token_endpoint_auth_method ?? 'client_secret_basic';
  if (typeof rawMethod !== 'string' || !AUTH_METHODS.includes(rawMethod as TokenEndpointAuthMethod)) {
    return {
      error: 'invalid_client_metadata',
      error_description: 'token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.',
    };
  }

  const rawGrants = body.grant_types ?? ['authorization_code'];
  if (!Array.isArray(rawGrants) || rawGrants.length === 0 || rawGrants.some((g) => !GRANT_TYPES.includes(g as never))) {
    return {
      error: 'invalid_client_metadata',
      error_description: 'grant_types may contain only authorization_code and refresh_token.',
    };
  }
  if (!rawGrants.includes('authorization_code')) {
    return { error: 'invalid_client_metadata', error_description: 'grant_types must include authorization_code.' };
  }

  const rawResponseTypes = body.response_types ?? ['code'];
  if (!Array.isArray(rawResponseTypes) || rawResponseTypes.some((t) => t !== 'code')) {
    return { error: 'invalid_client_metadata', error_description: 'response_types may contain only code.' };
  }

  const scope = parseScope(typeof body.scope === 'string' ? body.scope : null).filter(
    (s): s is OAuthScope => s === 'candidate' || s === 'employer',
  );

  return {
    clientName: cleanDisplayString(body.client_name, MAX_CLIENT_NAME_LENGTH) ?? DEFAULT_CLIENT_NAME,
    clientUri: optionalHttpsUrl(body.client_uri),
    redirectUris: Array.from(new Set(redirectUris as string[])),
    // A client that can refresh should say so, but every host this is built
    // for refreshes, and refusing them refresh tokens would sign people out
    // hourly. Both grants are always issued.
    grantTypes: [...GRANT_TYPES],
    authMethod: rawMethod as TokenEndpointAuthMethod,
    scope,
    softwareId: cleanDisplayString(body.software_id, 200),
    softwareVersion: cleanDisplayString(body.software_version, 100),
  };
}

export function isRegistrationError(value: ValidatedRegistration | RegistrationError): value is RegistrationError {
  return 'error' in value;
}

export async function registerClient(input: ValidatedRegistration): Promise<RegisteredClientResponse> {
  const clientId = generateSecret(TOKEN_PREFIX.clientId, 16);
  const clientSecret = input.authMethod === 'none' ? null : generateSecret(TOKEN_PREFIX.clientSecret);
  const created = await prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecretHash: clientSecret ? hashSecret(clientSecret) : null,
      clientName: input.clientName,
      clientUri: input.clientUri,
      redirectUris: input.redirectUris,
      tokenEndpointAuthMethod: input.authMethod,
      grantTypes: input.grantTypes,
      softwareId: input.softwareId,
      softwareVersion: input.softwareVersion,
    },
    select: { createdAt: true },
  });

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(created.createdAt.getTime() / 1000),
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    client_name: input.clientName,
    redirect_uris: input.redirectUris,
    grant_types: input.grantTypes,
    response_types: ['code'],
    token_endpoint_auth_method: input.authMethod,
    ...(input.scope.length > 0 ? { scope: input.scope.join(' ') } : {}),
  };
}

export interface StoredClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
  clientSecretHash: string | null;
}

export async function findClient(clientId: unknown): Promise<StoredClient | null> {
  if (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > 200) return null;
  return prisma.oAuthClient.findUnique({
    where: { clientId },
    select: {
      clientId: true,
      clientName: true,
      redirectUris: true,
      tokenEndpointAuthMethod: true,
      clientSecretHash: true,
    },
  });
}

/**
 * Exact string match against the registered list (OAuth 2.1 section 2.3.1),
 * with the one exception RFC 8252 section 7.3 requires: a loopback redirect
 * matches on any port, because a native client binds whatever port is free
 * at sign-in time. Claude Code registers http://localhost/callback and comes
 * back on an ephemeral port. Scheme, host, path and query must still match.
 */
export function isRegisteredRedirectUri(client: Pick<StoredClient, 'redirectUris'>, redirectUri: string): boolean {
  if (client.redirectUris.includes(redirectUri)) return true;
  let requested: URL;
  try {
    requested = new URL(redirectUri);
  } catch {
    return false;
  }
  if (requested.protocol !== 'http:' || !LOOPBACK_HOSTS.has(requested.hostname.toLowerCase())) return false;
  return client.redirectUris.some((registered) => {
    try {
      const candidate = new URL(registered);
      return (
        candidate.protocol === 'http:' &&
        candidate.hostname.toLowerCase() === requested.hostname.toLowerCase() &&
        candidate.pathname === requested.pathname &&
        candidate.search === requested.search
      );
    } catch {
      return false;
    }
  });
}

export interface ClientCredentials {
  clientId: string | null;
  clientSecret: string | null;
  /** Which method the request actually used. */
  method: TokenEndpointAuthMethod;
}

/**
 * Reads client credentials from a token or revocation request: HTTP Basic
 * first (RFC 6749 section 2.3.1, where both halves are form-urlencoded),
 * then the body.
 */
export function readClientCredentials(
  authorizationHeader: string | null,
  params: URLSearchParams,
): ClientCredentials {
  if (authorizationHeader && /^basic\s+/i.test(authorizationHeader)) {
    try {
      const decoded = Buffer.from(authorizationHeader.replace(/^basic\s+/i, ''), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator > 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, separator)),
          clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
          method: 'client_secret_basic',
        };
      }
    } catch {
      // Malformed Basic credentials authenticate nobody.
      return { clientId: null, clientSecret: null, method: 'client_secret_basic' };
    }
  }
  const clientSecret = params.get('client_secret');
  return {
    clientId: params.get('client_id'),
    clientSecret,
    method: clientSecret ? 'client_secret_post' : 'none',
  };
}

/**
 * Authenticates the client on a token request. A public client presents
 * only its id; a confidential one must present the secret it was issued,
 * by any of the two secret methods (servers commonly accept both, and a
 * client that registered `client_secret_post` and then sends Basic has
 * still proven the secret).
 */
export async function authenticateClient(credentials: ClientCredentials): Promise<StoredClient | null> {
  const client = await findClient(credentials.clientId);
  if (!client) return null;
  if (client.tokenEndpointAuthMethod === 'none') {
    // A public client that sends a secret anyway is still only identified by
    // its id; there is no secret on file to check it against.
    return client;
  }
  if (!client.clientSecretHash || !credentials.clientSecret) return null;
  return safeEqual(hashSecret(credentials.clientSecret), client.clientSecretHash) ? client : null;
}
