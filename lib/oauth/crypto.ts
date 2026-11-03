/**
 * The few primitives the OAuth server builds on. Codes and refresh tokens are
 * 32 random bytes in base64url, and only their SHA-256 (hex) is stored, so a
 * database read never yields a usable credential.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes, base64url: authorization codes and refresh tokens. */
export function randomToken(): string {
    return randomBytes(32).toString('base64url');
}

/** SHA-256 of a UTF-8 string, lowercase hex: the stored form of a code or refresh token. */
export function sha256Hex(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** HMAC-SHA256 of a UTF-8 message, base64url. */
export function hmacSha256(secret: string, message: string): string {
    return createHmac('sha256', secret).update(message, 'utf8').digest('base64url');
}

/**
 * Constant-time string equality. Values of different lengths are unequal
 * without a comparison; every caller compares fixed-length digests, so the
 * length says nothing a caller does not already know.
 */
export function constantTimeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
}
