import { describe, it, expect } from 'vitest';
import { sanitizeForDiscord } from '@/lib/sanitize-for-discord';

describe('sanitizeForDiscord', () => {
    it('returns empty string for null/undefined', () => {
        expect(sanitizeForDiscord(null)).toBe('');
        expect(sanitizeForDiscord(undefined)).toBe('');
    });

    it('passes through clean text untouched', () => {
        const msg = 'Failed to connect to source after 3 retries';
        expect(sanitizeForDiscord(msg)).toBe(msg);
    });

    it('redacts postgres connection URLs with credentials', () => {
        const msg = 'connect to postgres://admin:s3cret@db.aws.com:5432/prod failed';
        const out = sanitizeForDiscord(msg);
        expect(out).not.toContain('s3cret');
        expect(out).not.toContain('admin:');
        expect(out).toContain('[REDACTED_DB_URL]');
    });

    it('redacts mongodb+srv URLs', () => {
        const msg = 'auth: mongodb+srv://user:pwd@cluster.mongodb.net/app';
        expect(sanitizeForDiscord(msg)).toContain('[REDACTED_DB_URL]');
        expect(sanitizeForDiscord(msg)).not.toContain('pwd');
    });

    it('redacts redis:// URLs with creds', () => {
        const msg = 'redis://default:abc123@redis.upstash.io:6379';
        expect(sanitizeForDiscord(msg)).not.toContain('abc123');
    });

    it('redacts Bearer tokens', () => {
        const msg = 'request failed with Authorization: Bearer abc123def456ghi789';
        const out = sanitizeForDiscord(msg);
        expect(out).toContain('Bearer [REDACTED]');
        expect(out).not.toContain('abc123def456');
    });

    it('redacts Stripe / OpenAI key prefixes', () => {
        // Test fixtures contain underscores after the prefix so they
        // match the sanitizer's `[A-Za-z0-9_\-]{16,}` group but DO
        // NOT match GitHub's stricter base62-only secret scanner
        // pattern — otherwise the push fails on GH13 push protection.
        expect(sanitizeForDiscord('OpenAI: sk-proj-FAKE_KEY_FOR_TEST_ONLY')).toContain('[REDACTED_API_KEY]');
        expect(sanitizeForDiscord('Stripe: sk_live_FAKE_KEY_FOR_TEST_ONLY')).toContain('[REDACTED_API_KEY]');
        expect(sanitizeForDiscord('Anthropic: sk-ant-FAKE_KEY_FOR_TEST_ONLY')).toContain('[REDACTED_API_KEY]');
    });

    it('redacts JWT tokens', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        expect(sanitizeForDiscord(`token=${jwt}`)).toContain('[REDACTED_JWT]');
        expect(sanitizeForDiscord(`token=${jwt}`)).not.toContain('eyJhbGciOi');
    });

    it('redacts email addresses (PII)', () => {
        const msg = 'user not found: alice@company.com';
        const out = sanitizeForDiscord(msg);
        expect(out).toContain('[REDACTED_EMAIL]');
        expect(out).not.toContain('alice@company.com');
    });

    it('redacts long base64-ish blobs as fallback', () => {
        // 50-char random-looking blob, no other pattern matches
        const msg = 'unknown header value: AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKl';
        const out = sanitizeForDiscord(msg);
        expect(out).toContain('[REDACTED_TOKEN]');
    });

    it('does NOT redact short alphanumeric IDs', () => {
        const msg = 'job ID abc123 not found';
        expect(sanitizeForDiscord(msg)).toContain('abc123');
    });

    it('does NOT redact ordinary words or sentences', () => {
        const msg = 'The quick brown fox jumps over the lazy dog';
        expect(sanitizeForDiscord(msg)).toBe(msg);
    });

    it('handles multiple secrets in one string', () => {
        const msg = 'connect postgres://u:p@h/db then send to alice@x.com with Bearer abc123def456';
        const out = sanitizeForDiscord(msg);
        expect(out).toContain('[REDACTED_DB_URL]');
        expect(out).toContain('[REDACTED_EMAIL]');
        expect(out).toContain('Bearer [REDACTED]');
        expect(out).not.toContain('alice');
    });

    it('handles non-string input by coercing', () => {
        expect(sanitizeForDiscord(12345 as unknown as string)).toBe('12345');
    });
});

// A Checkout Session id (cs_live_ or cs_test_ plus about 58 characters) is long
// enough for the long_token fallback, which masked the sessionId in every
// Stripe webhook alert. Stripe object ids stay readable; secrets do not.
describe('sanitizeForDiscord: Stripe object ids', () => {
    // Real-length bodies, letters and digits only, as Stripe issues them.
    const SESSION_BODY = 'a1B2c3D4e5F6g7H8i9J0'.repeat(3).slice(0, 58);
    const LONG_BODY = 'Ab12Cd34Ef'.repeat(4);

    it.each(['cs_live_', 'cs_test_'])('keeps a real-length %s Checkout Session id intact', (prefix) => {
        const line = `sessionId=${prefix}${SESSION_BODY} · jobId=job-1`;
        expect(`${prefix}${SESSION_BODY}`.length).toBeGreaterThanOrEqual(60);
        expect(sanitizeForDiscord(line)).toBe(line);
    });

    it.each(['pi', 'ch', 'in', 'sub', 'cus', 'evt', 're', 'dp', 'price', 'prod', 'plink', 'seti', 'py'])(
        'keeps a %s_ id intact even when it is long enough for the token fallback',
        (prefix) => {
            const id = `${prefix}_${LONG_BODY}`;
            expect(id.length).toBeGreaterThanOrEqual(40);
            expect(sanitizeForDiscord(`No such object: '${id}'`)).toBe(`No such object: '${id}'`);
        },
    );

    it('keeps several ids in one alert line, the way the renewal alert joins them', () => {
        const line = `otherSessionIds=cs_live_${SESSION_BODY}, cs_test_${SESSION_BODY} · otherPaymentIntentIds=pi_${LONG_BODY}`;
        expect(sanitizeForDiscord(line)).toBe(line);
    });

    // Fixtures for secrets carry underscores after the prefix, like the key
    // fixtures above, so they never match GitHub's push protection patterns.
    it.each([
        ['a secret key', 'sk_live_FAKE_KEY_FOR_TEST_ONLY_0123456789'],
        ['a test mode secret key', 'sk_test_FAKE_KEY_FOR_TEST_ONLY_0123456789'],
        ['a restricted key', 'rk_live_FAKE_KEY_FOR_TEST_ONLY_0123456789'],
        ['a webhook signing secret, shorter than the token fallback', 'whsec_FAKE_SECRET_FOR_TEST_ONLY_01'],
    ])('still masks %s', (_label, secret) => {
        const out = sanitizeForDiscord(`Stripe rejected ${secret} for cs_live_${SESSION_BODY}`);
        expect(out).not.toContain(secret);
        expect(out).toContain('[REDACTED_API_KEY]');
        // The id beside it is still readable.
        expect(out).toContain(`cs_live_${SESSION_BODY}`);
    });

    // Stripe's signing secrets are letters and digits, but the Resend webhook
    // (Svix) uses the same whsec_ prefix with a base64 body, which can hold
    // + / and =. The fixtures also carry an underscore so no secret scanner
    // reads them as real.
    it.each([
        ['with + and / after a long run', 'whsec_FAKE_KEY_FOR_TEST_ONLY+FAKEFAKE/Fk'],
        ['with / inside the first 16 characters', 'whsec_FAKE_ONLY/FAKEFAKEFAKE+FAKEFAKEFk'],
        ['with + early and = padding', 'whsec_FAKE_ONLY+FAKE/FAKEFAKEFAKEFAKEFA=='],
    ])('masks a base64 webhook signing secret %s in full', (_label, secret) => {
        expect(sanitizeForDiscord(`svix: no matching signature for ${secret} (resend)`))
            .toBe('svix: no matching signature for [REDACTED_API_KEY] (resend)');
    });

    it.each([
        ['a PaymentIntent client secret', `pi_${LONG_BODY}_secret_${LONG_BODY}`],
        ['a SetupIntent client secret', `seti_${LONG_BODY}_secret_${LONG_BODY}`],
        ['a secret key joined to an id by an underscore', `cs_live_${SESSION_BODY}_sk_live_FAKE_KEY_FOR_TEST_ONLY`],
        ['a long token that only starts like a refund id (the shape of another vendor key)', 're_FAKE_KEY_FOR_TEST_ONLY_0123456789_abcdef'],
        ['a long token with a prefix Stripe ids do not use', `tok_${LONG_BODY}`],
    ])('still masks %s as a long token', (_label, token) => {
        const out = sanitizeForDiscord(`value: ${token} end`);
        expect(out).not.toContain(token);
        expect(out).toBe('value: [REDACTED_TOKEN] end');
    });
});
