/**
 * PKCE (RFC 7636), S256 only: the authorization request carries
 * code_challenge = base64url(SHA-256(code_verifier)) and the token request
 * proves possession with the verifier. "plain" is never accepted.
 */
import { createHash } from 'node:crypto';
import { constantTimeEqual } from '@/lib/oauth/crypto';

/** 43 to 128 unreserved characters (RFC 7636 section 4.1): the verifier, and the challenge per the design. */
const PKCE_VALUE = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isPkceValue(value: unknown): value is string {
    return typeof value === 'string' && PKCE_VALUE.test(value);
}

/** base64url(SHA-256(verifier)), no padding. */
export function s256Challenge(verifier: string): string {
    return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** True when the verifier is well formed and hashes to the stored challenge (constant-time compare). */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
    if (!isPkceValue(verifier) || !isPkceValue(challenge)) return false;
    return constantTimeEqual(s256Challenge(verifier), challenge);
}
