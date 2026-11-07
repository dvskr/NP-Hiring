/**
 * Credentials in addresses stay out of Sentry and Google Analytics: guide
 * library tokens in the email link path, Stripe Checkout session ids in the
 * success page query. lib/private-url.ts masks them in every Sentry event
 * (the three Sentry configs wire scrubSentryEvent into beforeSend), and
 * lib/analytics.ts swaps the library token for its route name in GA page
 * views.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PRIVATE_QUERY_PARAMS, maskPrivateTokens, scrubSentryEvent, withoutPrivateQueryParams } from '@/lib/private-url';
import { sanitizeAnalyticsPath, sanitizeAnalyticsUrl } from '@/lib/analytics';

const TOKEN = 'f'.repeat(48);
const ROOT = path.resolve(__dirname, '../..');

describe('withoutPrivateQueryParams', () => {
    it('drops private parameters and keeps the rest', () => {
        expect(withoutPrivateQueryParams('/guides/success?session_id=cs_live_abc&utm_source=x')).toBe('/guides/success?utm_source=x');
        expect(withoutPrivateQueryParams('https://nphiring.com/success?session_id=cs_live_abc#top')).toBe('https://nphiring.com/success#top');
        expect(withoutPrivateQueryParams('/job-alerts/manage?Token=abc')).toBe('/job-alerts/manage');
        expect(withoutPrivateQueryParams('/signup?email=a%40b.com&code=1')).toBe('/signup');
    });

    it('leaves addresses without private parameters as they are', () => {
        expect(withoutPrivateQueryParams('/jobs?location=Denver')).toBe('/jobs?location=Denver');
        expect(withoutPrivateQueryParams('/guides')).toBe('/guides');
    });

    it('covers the credential parameters this site uses', () => {
        for (const name of ['token', 'session_id', 'email', 'code', 'access_token', 'refresh_token']) {
            expect(PRIVATE_QUERY_PARAMS).toContain(name);
        }
    });
});

describe('maskPrivateTokens', () => {
    it('masks library tokens and session ids wherever they appear', () => {
        const text = `GET https://nphiring.com/guides/library/${TOKEN} then /api/guides/verify?session_id=cs_test_a1B2c3&x=1`;
        const masked = maskPrivateTokens(text);
        expect(masked).not.toContain(TOKEN);
        expect(masked).not.toContain('cs_test_a1B2c3');
        expect(masked).toContain('/guides/library/[token]');
        expect(masked).toContain('session_id=[redacted]&x=1');
    });

    it('leaves the bare library page alone', () => {
        expect(maskPrivateTokens('/guides/library?error=link')).toBe('/guides/library?error=link');
    });

    it('masks the library cookie and a bare token in any other field', () => {
        const other = 'a'.repeat(48);
        const text = `cookie: np_guides=${TOKEN}.${other}; theme=dark {"accessToken":"${other}","id":"x"} token ${TOKEN.toUpperCase()}`;
        const masked = maskPrivateTokens(text);
        expect(masked).not.toMatch(new RegExp(`${TOKEN}|${other}`, 'i'));
        expect(masked).toContain('np_guides=[redacted]; theme=dark');
        expect(masked).toContain('"accessToken":"[token]"');
    });

    it('masks a token that follows a JSON escape in a serialised line', () => {
        const line = JSON.stringify({ message: `failed\n${TOKEN}\tthen\r${'c'.repeat(48)}` });
        const masked = maskPrivateTokens(line);
        expect(masked).not.toMatch(new RegExp(`${TOKEN}|${'c'.repeat(48)}`));
        expect(masked).toContain('failed\\n[token]\\tthen\\r[token]');
    });

    it('keeps hex ids of other lengths whole', () => {
        const sentryId = 'b'.repeat(32);
        const gitSha = 'c'.repeat(40);
        const sha256 = 'd'.repeat(64);
        const text = `${sentryId} ${gitSha} ${sha256} ${TOKEN}x`;
        expect(maskPrivateTokens(text)).toBe(text);
    });
});

describe('server log lines', () => {
    it('never carry a library token, the library cookie or a session id', async () => {
        const { logger } = await vi.importActual<typeof import('@/lib/logger')>('@/lib/logger');
        const lines: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation((line: unknown) => { lines.push(String(line)); });
        try {
            logger.warn(`Download refused for /guides/library/${TOKEN}`, {
                cookie: `np_guides=${TOKEN}`,
                purchase: { accessToken: TOKEN },
                url: '/api/guides/verify?session_id=cs_live_Q1w2',
            }, new Error(`row ${TOKEN} not found`));
        } finally {
            spy.mockRestore();
        }
        expect(lines).toHaveLength(1);
        expect(lines[0]).not.toMatch(new RegExp(`${TOKEN}|cs_live_Q1w2`));
        expect(lines[0]).toContain('/guides/library/[token]');
    });
});

describe('scrubSentryEvent', () => {
    it('masks tokens in nested event fields', () => {
        const event = {
            request: { url: `https://nphiring.com/guides/library/${TOKEN}` },
            transaction: 'GET /guides/library/[token]',
            breadcrumbs: [{ data: { url: '/api/guides/verify?session_id=cs_live_Zz9' } }],
        };
        const scrubbed = scrubSentryEvent(event);
        expect(JSON.stringify(scrubbed)).not.toMatch(new RegExp(`${TOKEN}|cs_live_Zz9`));
        expect(scrubbed.request.url).toBe('https://nphiring.com/guides/library/[token]');
    });

    it('returns an event with nothing to mask unchanged', () => {
        const event = { request: { url: 'https://nphiring.com/jobs' } };
        expect(scrubSentryEvent(event)).toBe(event);
    });

    it('is the beforeSend of every Sentry runtime', () => {
        for (const file of ['sentry.server.config.ts', 'sentry.edge.config.ts', 'instrumentation-client.ts']) {
            const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
            expect(src, file).toContain("import { scrubSentryEvent } from '@/lib/private-url';");
            expect(src, file).toMatch(/beforeSend: \(event\) => scrubSentryEvent\(event\)/);
            expect(src, file).toMatch(/beforeSendTransaction: \(event\) => scrubSentryEvent\(event\)/);
        }
    });
});

describe('Google Analytics page views', () => {
    it('never carry a library token or a checkout session id', () => {
        expect(sanitizeAnalyticsPath(`/guides/library/${TOKEN}`)).toBe('/guides/library/[token]');
        expect(sanitizeAnalyticsPath('/guides/library?error=link')).toBe('/guides/library');
        expect(sanitizeAnalyticsPath('/guides/success?session_id=cs_live_abc')).toBe('/guides/success');
        expect(sanitizeAnalyticsUrl(`https://nphiring.com/guides/library/${TOKEN}`)).toBe('https://nphiring.com/guides/library/[token]');
    });

    it('keep the store pages as they are', () => {
        expect(sanitizeAnalyticsPath('/guides')).toBe('/guides');
        expect(sanitizeAnalyticsPath('/guides/library')).toBe('/guides/library');
        expect(sanitizeAnalyticsPath('/guides/complete-library')).toBe('/guides/complete-library');
    });
});
