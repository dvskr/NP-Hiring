import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Secrets for the OAuth server: generation, hashing and comparison.
 *
 * Every credential this server hands out (codes, access and refresh tokens,
 * client secrets) is 256 bits from the CSPRNG, and only its SHA-256 is
 * stored. A fast hash is the right tool here, unlike for passwords: the
 * input already has full entropy, so there is nothing for a slow hash to
 * protect against, and verification runs on every MCP request.
 */

/** A prefixed, URL-safe random credential. 32 bytes is 256 bits. */
export function generateSecret(prefix: string, bytes = 32): string {
  return `${prefix}${randomBytes(bytes).toString('base64url')}`;
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time string comparison. Unequal lengths short-circuit, which leaks only the length. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** RFC 7636 section 4.1: 43 to 128 characters from the unreserved set. */
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
/** An S256 challenge is the base64url of a SHA-256 digest: exactly 43 characters. */
const S256_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeChallenge(challenge: string): boolean {
  return S256_CHALLENGE_PATTERN.test(challenge);
}

/**
 * PKCE verification. Only S256 exists here: OAuth 2.1 lets a server refuse
 * `plain`, and this one refuses it at the authorization endpoint, so a code
 * can never carry anything else.
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!CODE_VERIFIER_PATTERN.test(codeVerifier)) return false;
  const computed = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  return safeEqual(computed, codeChallenge);
}
