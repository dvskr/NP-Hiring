/**
 * The OAuth server's pure building blocks: PKCE, redirect URI policy,
 * registration validation and client credential parsing.
 *
 * The redirect URI rules carry real weight. The consent page sends the
 * browser to the registered URI with location.assign, so a javascript: or
 * data: URI accepted at registration would run script on our origin.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect } from 'vitest';
import { brand } from '@/config/brand';

import { generateSecret, hashSecret, isValidCodeChallenge, safeEqual, verifyPkceS256 } from '@/lib/mcp/oauth/crypto';
import {
  cleanDisplayString,
  describeRedirectTarget,
  isAcceptableRedirectUri,
  isRegisteredRedirectUri,
  isRegistrationError,
  readClientCredentials,
  validateRegistration,
  verifiedClientLabel,
} from '@/lib/mcp/oauth/clients';
import { TOKEN_PREFIX, parseScope, resolveResource, resourceUrl } from '@/lib/mcp/oauth/config';

describe('PKCE S256', () => {
  // RFC 7636 Appendix B.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('accepts the RFC 7636 test vector', () => {
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it('refuses a different verifier', () => {
    expect(verifyPkceS256(`${verifier.slice(0, -1)}A`, challenge)).toBe(false);
  });

  it('refuses verifiers outside the RFC length and alphabet', () => {
    expect(verifyPkceS256('short', challenge)).toBe(false);
    expect(verifyPkceS256(`${'a'.repeat(42)}!`, challenge)).toBe(false);
    expect(verifyPkceS256('a'.repeat(129), challenge)).toBe(false);
  });

  it('recognises only 43-character base64url challenges', () => {
    expect(isValidCodeChallenge(challenge)).toBe(true);
    expect(isValidCodeChallenge(`${challenge}=`)).toBe(false);
    expect(isValidCodeChallenge('plain-text-challenge')).toBe(false);
  });
});

describe('secrets', () => {
  it('are prefixed, unique and stored only as a hash', () => {
    const a = generateSecret(TOKEN_PREFIX.access);
    const b = generateSecret(TOKEN_PREFIX.access);
    expect(a).toMatch(new RegExp(`^${TOKEN_PREFIX.access}[A-Za-z0-9_-]{43}$`));
    expect(a).not.toBe(b);
    expect(hashSecret(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSecret(a)).not.toContain(a);
  });

  it('compare in constant time without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('redirect URI policy', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'http://localhost:6274/oauth/callback',
    'http://127.0.0.1/callback',
    'cursor://anysphere.cursor-retrieval/oauth/callback',
    'vscode://vscode.github-authentication/did-authenticate',
  ])('accepts %s', (uri) => {
    expect(isAcceptableRedirectUri(uri)).toBe(true);
  });

  it.each([
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'http://evil.example/callback',
    'https://claude.ai/callback#fragment',
    'https://user:pass@claude.ai/callback',
    'file:///etc/passwd',
    'ftp://example.com/cb',
    'https://claude.ai/ca llback',
    `https://${brand.domain}/jobs`,
    `https://www.${brand.domain}/oauth/consent`,
    '',
  ])('refuses %s', (uri) => {
    expect(isAcceptableRedirectUri(uri)).toBe(false);
  });

  it('matches registered URIs exactly, except loopback ports (RFC 8252)', () => {
    const client = { redirectUris: ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback'] };
    expect(isRegisteredRedirectUri(client, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isRegisteredRedirectUri(client, 'http://localhost:53682/callback')).toBe(true);
    expect(isRegisteredRedirectUri(client, 'http://localhost:53682/other')).toBe(false);
    expect(isRegisteredRedirectUri(client, 'https://claude.ai/api/mcp/auth_callback?x=1')).toBe(false);
    expect(isRegisteredRedirectUri(client, 'https://claude.ai:8443/api/mcp/auth_callback')).toBe(false);
    expect(isRegisteredRedirectUri(client, 'http://127.0.0.1:53682/callback')).toBe(false);
  });

  it('marks only the real Claude and ChatGPT callback hosts as verified', () => {
    expect(describeRedirectTarget('https://claude.ai/api/mcp/auth_callback').verifiedAs).toBe('Claude');
    expect(describeRedirectTarget('https://chatgpt.com/connector_platform_oauth_redirect').verifiedAs).toBe('ChatGPT');
    expect(describeRedirectTarget('https://claude.ai.evil.example/cb').verifiedAs).toBeNull();
    expect(describeRedirectTarget('http://localhost:3000/cb').verifiedAs).toBeNull();
  });

  it('verifies the exact callback paths, not the host alone', () => {
    expect(describeRedirectTarget('https://claude.com/api/mcp/auth_callback').verifiedAs).toBe('Claude');
    expect(describeRedirectTarget('https://chatgpt.com/connector/oauth/cb_fic123').verifiedAs).toBe('ChatGPT');
    expect(describeRedirectTarget('https://platform.openai.com/apps-manage/oauth').verifiedAs).toBe('ChatGPT');
    // A custom GPT's action callback: its token goes to whoever wrote the GPT.
    expect(describeRedirectTarget('https://chatgpt.com/aip/g-fic123/oauth/callback').verifiedAs).toBeNull();
    expect(describeRedirectTarget('https://claude.ai/somewhere/else').verifiedAs).toBeNull();
    expect(describeRedirectTarget('https://claude.ai/api/mcp/auth_callback?next=x').verifiedAs).toBeNull();
    expect(describeRedirectTarget('https://claude.ai:8443/api/mcp/auth_callback').verifiedAs).toBeNull();
    expect(describeRedirectTarget('https://claude.ai./api/mcp/auth_callback').verifiedAs).toBeNull();
  });

  it('tells a code bound for this computer from one bound for a website', () => {
    expect(describeRedirectTarget('http://localhost:6274/oauth/callback').local).toBe(true);
    expect(describeRedirectTarget('cursor://anysphere.cursor-retrieval/oauth/callback').local).toBe(true);
    expect(describeRedirectTarget('https://evil.example/cb').local).toBe(false);
    expect(describeRedirectTarget('https://claude.ai/api/mcp/auth_callback').local).toBe(false);
  });

  it('vouches for a client only when every address it registered is one assistant\'s callback', () => {
    expect(verifiedClientLabel(['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'])).toBe('Claude');
    expect(verifiedClientLabel(['https://claude.ai/api/mcp/auth_callback', 'https://evil.example/cb'])).toBeNull();
    expect(verifiedClientLabel(['https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect'])).toBeNull();
    expect(verifiedClientLabel(['http://localhost/callback'])).toBeNull();
    expect(verifiedClientLabel([])).toBeNull();
  });

  it('refuses every address of this site, however it is spelled', () => {
    for (const uri of [
      `https://${brand.domain}./oauth/callback`,
      `https://${brand.domain.toUpperCase()}/x`,
      `https://dev.${brand.domain}/x`,
      `https://anything.${brand.domain}/x`,
    ]) {
      expect(isAcceptableRedirectUri(uri), uri).toBe(false);
    }
    // Look-alikes that are someone else's host are still ordinary https URIs.
    expect(isAcceptableRedirectUri(`https://${brand.domain}.evil.example/cb`)).toBe(true);
    expect(isAcceptableRedirectUri(`https://not${brand.domain}/cb`)).toBe(true);
  });
});

describe('display names', () => {
  const invisible = (...codes: number[]) => String.fromCharCode(...codes);

  it('removes bidi overrides, zero-width characters and other invisible marks', () => {
    // "Claude" followed by a right-to-left override and reversed text would
    // render as something else on the consent screen.
    expect(cleanDisplayString(`Claude${invisible(0x202e)}evil`, 120)).toBe('Claudeevil');
    expect(cleanDisplayString(`Cl${invisible(0x200b)}a${invisible(0x200d)}ude`, 120)).toBe('Claude');
    expect(cleanDisplayString(`${invisible(0xfeff)}Claude${invisible(0x2066, 0x2069)}`, 120)).toBe('Claude');
    expect(cleanDisplayString(`My${invisible(0x2028)}App`, 120)).toBe('MyApp');
  });

  it('keeps ordinary names, accents included', () => {
    expect(cleanDisplayString('Zoë Desktop  Client', 120)).toBe('Zoë Desktop Client');
    expect(cleanDisplayString(invisible(0x200b), 120)).toBeNull();
  });
});

describe('dynamic client registration', () => {
  it('accepts a typical MCP host registration', () => {
    const result = validateRegistration({
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'candidate unknown',
    });
    expect(isRegistrationError(result)).toBe(false);
    if (!isRegistrationError(result)) {
      expect(result.authMethod).toBe('none');
      expect(result.scope).toEqual(['candidate']);
      expect(result.grantTypes).toEqual(['authorization_code', 'refresh_token']);
    }
  });

  it('defaults to client_secret_basic as RFC 7591 requires', () => {
    const result = validateRegistration({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    expect(!isRegistrationError(result) && result.authMethod).toBe('client_secret_basic');
  });

  it('strips markup and control characters from the self-asserted name', () => {
    const result = validateRegistration({
      client_name: `<img src=x onerror=alert(1)>Claude${String.fromCharCode(0)}`,
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    });
    expect(!isRegistrationError(result) && result.clientName).toBe('img src=x onerror=alert(1)Claude');
  });

  it.each([
    [{ redirect_uris: [] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['javascript:alert(1)'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['https://a.example/cb'], grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], response_types: ['token'] }, 'invalid_client_metadata'],
    [{ redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'private_key_jwt' }, 'invalid_client_metadata'],
    // Each one is allowed, but together they are over the total.
    [{ redirect_uris: [`https://a.example/${'a'.repeat(1100)}`, `https://b.example/${'b'.repeat(1100)}`] }, 'invalid_redirect_uri'],
  ])('refuses %j', (body, error) => {
    const result = validateRegistration(body as Record<string, unknown>);
    expect(isRegistrationError(result) && result.error).toBe(error);
  });
});

describe('client credentials', () => {
  it('reads HTTP Basic with form-encoded halves', () => {
    const header = `Basic ${Buffer.from(`${TOKEN_PREFIX.clientId}abc:s%3Acret`).toString('base64')}`;
    expect(readClientCredentials(header, new URLSearchParams())).toEqual({
      clientId: `${TOKEN_PREFIX.clientId}abc`,
      clientSecret: 's:cret',
      method: 'client_secret_basic',
    });
  });

  it('reads client_secret_post and public clients from the body', () => {
    expect(readClientCredentials(null, new URLSearchParams('client_id=a&client_secret=b')).method).toBe('client_secret_post');
    expect(readClientCredentials(null, new URLSearchParams('client_id=a'))).toEqual({ clientId: 'a', clientSecret: null, method: 'none' });
  });
});

describe('resources and scopes', () => {
  it('binds a resource indicator to one of our served endpoints exactly', () => {
    expect(resolveResource(resourceUrl('candidate'), null)?.id).toBe('candidate');
    // The employer connector is defined but not served on the engine yet
    // (isResourceServed): naming it is refused like a stranger's resource.
    // The employer phase brings back the reference expectation here.
    expect(resolveResource(`${resourceUrl('employer')}/`, null)).toBeNull();
    expect(resolveResource('https://evil.example/mcp', null)).toBeNull();
  });

  it('falls back to the scope, then to the candidate endpoint, and refuses the employer scope while it is not served', () => {
    expect(resolveResource(null, 'employer')).toBeNull();
    expect(resolveResource(null, null)?.id).toBe('candidate');
    expect(parseScope('candidate  candidate employer')).toEqual(['candidate', 'employer']);
  });
});
