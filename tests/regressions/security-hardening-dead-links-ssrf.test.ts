/**
 * Regression (audit B102) — the check-dead-links cron fetched externally-
 * controlled applyLink URLs with no scheme/host validation: a poisoned
 * aggregator feed or malicious employer posting could aim the cron at
 * http://169.254.169.254/, internal hostnames, or raw IPs (blind SSRF
 * from inside the deployment's network, up to 1500 probes per run).
 *
 * Fix: assessApplyLinkSafety() gates every probe — https only, default
 * port only, and a conservative hostname denylist (localhost, private
 * suffixes, IP literals, single-label names). Blocked links resolve as
 * inconclusive, never as dead, so the guard cannot unpublish jobs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { assessApplyLinkSafety } from '@/app/api/cron/check-dead-links/url-guard';

describe('assessApplyLinkSafety — public https apply links pass', () => {
    const SAFE_URLS = [
        'https://boards.greenhouse.io/acme/jobs/1234567',
        'https://jobs.lever.co/acme/abc-123',
        'https://www.indeed.com/viewjob?jk=abcdef',
        'https://careers.example-health.org/pmhnp?src=feed',
        'https://example.com:443/jobs/1', // explicit default port
        'https://example.com./jobs/1', // FQDN trailing dot normalizes
    ];

    for (const url of SAFE_URLS) {
        it(`allows ${url}`, () => {
            expect(assessApplyLinkSafety(url)).toEqual({ safe: true });
        });
    }
});

describe('assessApplyLinkSafety — SSRF targets are blocked', () => {
    const BLOCKED_URLS: Array<[string, string]> = [
        ['not a url at all', 'invalid_url'],
        ['http://example.com/jobs/1', 'non_https_scheme'],
        ['ftp://example.com/file', 'non_https_scheme'],
        ['https://example.com:8443/admin', 'non_default_port'],
        ['https://localhost/admin', 'localhost'],
        ['https://foo.localhost/admin', 'private_hostname'],
        ['https://printer.local/', 'private_hostname'],
        ['https://metadata.google.internal/computeMetadata/v1/', 'private_hostname'],
        ['https://router.home.arpa/', 'private_hostname'],
        ['https://127.0.0.1/', 'ip_literal'],
        ['https://10.0.0.5/secrets', 'ip_literal'],
        ['https://169.254.169.254/latest/meta-data/', 'ip_literal'],
        ['https://192.168.1.1/', 'ip_literal'],
        ['https://8.8.8.8/', 'ip_literal'], // ALL raw IPs blocked, public included
        ['https://[::1]/', 'ipv6_literal'],
        ['https://intranet/portal', 'single_label_hostname'],
    ];

    for (const [url, expectedReason] of BLOCKED_URLS) {
        it(`blocks ${url} (${expectedReason})`, () => {
            const verdict = assessApplyLinkSafety(url);
            expect(verdict.safe).toBe(false);
            if (!verdict.safe) {
                expect(verdict.reason).toBe(expectedReason);
            }
        });
    }

    it('blocks obfuscated IPv4 forms (decimal / hex hostnames)', () => {
        // WHATWG URL normalizes these to dotted-quad; either the ip_literal
        // or numeric_hostname rule must catch them — pin only safe:false.
        for (const url of ['https://2130706433/', 'https://0x7f.0x0.0x0.0x1/']) {
            expect(assessApplyLinkSafety(url).safe).toBe(false);
        }
    });
});

describe('route wiring pin', () => {
    it('check-dead-links route.ts imports and invokes the guard before probing', () => {
        const source = readFileSync(
            path.join(process.cwd(), 'app', 'api', 'cron', 'check-dead-links', 'route.ts'),
            'utf-8'
        );
        expect(source).toMatch(/import\s*\{\s*assessApplyLinkSafety\s*\}\s*from\s*'\.\/url-guard'/);
        expect(source).toMatch(/assessApplyLinkSafety\(job\.applyLink\)/);
        // Guard rejections must stay non-destructive (inconclusive, alive).
        expect(source).toContain('ssrf_guard_blocked');
    });
});
