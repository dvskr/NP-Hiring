/**
 * P1 gsc-ops: sitemaps.list normalization, sitemap-error alerting, and
 * graceful credential degradation (lib/gsc-client.ts pure surface).
 */
import { describe, test, expect } from 'vitest';
import {
    normalizeSitemapEntries,
    buildSitemapAlerts,
    getGscConfig,
    type GscSitemapEntry,
} from '@/lib/gsc-client';
import { brand } from '@/config/brand';

function entry(overrides: Partial<GscSitemapEntry> = {}): GscSitemapEntry {
    return {
        path: 'https://example.com/sitemap.xml',
        lastSubmitted: '2026-07-27T09:30:00.000Z',
        lastDownloaded: '2026-07-28T02:00:00.000Z',
        isPending: false,
        isSitemapsIndex: false,
        errors: 0,
        warnings: 0,
        submittedUrls: 100,
        ...overrides,
    };
}

describe('normalizeSitemapEntries', () => {
    test('normalizes a full sitemaps.list payload including int64-as-string fields', () => {
        // Arrange — mirrors the real API shape: errors/warnings/submitted are strings.
        const payload = {
            sitemap: [
                {
                    path: 'https://example.com/api/sitemaps/cities/0',
                    lastSubmitted: '2026-07-20T00:00:00.000Z',
                    lastDownloaded: '2026-07-28T01:00:00.000Z',
                    isPending: false,
                    isSitemapsIndex: false,
                    errors: '2',
                    warnings: '5',
                    contents: [
                        { type: 'web', submitted: '9000' },
                        { type: 'image', submitted: '150' },
                    ],
                },
            ],
        };

        // Act
        const entries = normalizeSitemapEntries(payload);

        // Assert
        expect(entries).toHaveLength(1);
        expect(entries[0]).toEqual({
            path: 'https://example.com/api/sitemaps/cities/0',
            lastSubmitted: '2026-07-20T00:00:00.000Z',
            lastDownloaded: '2026-07-28T01:00:00.000Z',
            isPending: false,
            isSitemapsIndex: false,
            errors: 2,
            warnings: 5,
            submittedUrls: 9150,
        });
    });

    test('tolerates missing fields, pending entries, and junk rows', () => {
        const entries = normalizeSitemapEntries({
            sitemap: [
                { path: 'https://example.com/sitemap.xml', isPending: true },
                { noPath: true },
                null,
                'garbage',
            ],
        });

        expect(entries).toHaveLength(1);
        expect(entries[0]).toEqual({
            path: 'https://example.com/sitemap.xml',
            lastSubmitted: null,
            lastDownloaded: null,
            isPending: true,
            isSitemapsIndex: false,
            errors: 0,
            warnings: 0,
            submittedUrls: 0,
        });
    });

    test('returns [] for empty or malformed payloads', () => {
        expect(normalizeSitemapEntries({})).toEqual([]);
        expect(normalizeSitemapEntries(null)).toEqual([]);
        expect(normalizeSitemapEntries({ sitemap: 'nope' })).toEqual([]);
        expect(normalizeSitemapEntries(undefined)).toEqual([]);
    });
});

describe('buildSitemapAlerts', () => {
    test('no alerts when every sitemap is clean', () => {
        expect(buildSitemapAlerts([entry(), entry({ warnings: 3 })])).toEqual([]);
    });

    test('one alert line per sitemap with errors, including path and counts', () => {
        const alerts = buildSitemapAlerts([
            entry({ path: 'https://example.com/api/sitemaps/cities/3', errors: 2, warnings: 1 }),
            entry({ path: 'https://example.com/sitemap.xml', errors: 1, lastDownloaded: null }),
            entry(), // clean — no alert
        ]);

        expect(alerts).toHaveLength(2);
        expect(alerts[0]).toContain('https://example.com/api/sitemaps/cities/3');
        expect(alerts[0]).toContain('2 errors');
        expect(alerts[0]).toContain('1 warning');
        expect(alerts[1]).toContain('1 error');
        expect(alerts[1]).toContain('never');
    });

    test('warnings alone never page anyone', () => {
        expect(buildSitemapAlerts([entry({ warnings: 99 })])).toEqual([]);
    });
});

describe('getGscConfig — graceful degradation without credentials', () => {
    const keyJson = JSON.stringify({ client_email: 'svc@test.iam', private_key: 'pem' });

    test('returns null when no service-account env is configured (local dev)', () => {
        expect(getGscConfig({})).toBeNull();
    });

    test('accepts raw JSON via GSC_SERVICE_ACCOUNT_KEY with default sc-domain property', () => {
        const config = getGscConfig({ GSC_SERVICE_ACCOUNT_KEY: keyJson });
        expect(config).not.toBeNull();
        expect(config?.keyJson).toBe(keyJson);
        expect(config?.siteUrl).toBe(`sc-domain:${brand.domain}`);
    });

    test('falls back to GOOGLE_INDEXING_CREDENTIALS and decodes base64', () => {
        const config = getGscConfig({
            GOOGLE_INDEXING_CREDENTIALS: Buffer.from(keyJson).toString('base64'),
        });
        expect(config?.keyJson).toBe(keyJson);
    });

    test('honors an explicit GSC_SITE_URL', () => {
        const config = getGscConfig({
            GSC_SERVICE_ACCOUNT_KEY: keyJson,
            GSC_SITE_URL: 'https://example.com/',
        });
        expect(config?.siteUrl).toBe('https://example.com/');
    });
});
