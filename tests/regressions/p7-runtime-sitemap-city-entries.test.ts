/**
 * P7 runtime fix D4 (MEDIUM) — sitemap city entries must not redirect, 404,
 * or duplicate their metro twins.
 *
 * Runtime-verified defects in app/sitemap.ts's city block:
 *   1. 13 /jobs/city/* entries (new-york-ny, los-angeles-ca, dallas-tx, …)
 *      308-redirected to /jobs/metro/* twins that were ALSO listed —
 *      duplicate/redirecting sitemap entries.
 *   2. A local slug re-derivation left a doubled hyphen when the DB city
 *      value ends in space/punctuation: "Boston " → /jobs/city/boston--ma
 *      → 404.
 *   3. Dirty twins ("Boston" + "Boston ") could emit two entries for one
 *      page.
 *
 * The fix routes slug building through buildCitySlug (the canonical,
 * trim-safe form the city route actually parses), drops metro-consolidated
 * slugs (their metro twin is already emitted by metroPages), vetoes slugs
 * whose lossy round-trip can't resolve (cityLinkResolves), and dedupes by
 * slug.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    buildCitySlug,
    cityLinkResolves,
    parseCitySlugToName,
} from '@/app/jobs/locations/[state]/directory';
import { METRO_CITIES } from '@/lib/metro-data';

const ROOT = process.cwd();
const sitemapSrc = fs.readFileSync(path.join(ROOT, 'app/sitemap.ts'), 'utf8');

describe('D4 — buildCitySlug is trim-safe (the boston--ma class of 404)', () => {
    it('trailing space no longer doubles the hyphen', () => {
        expect(buildCitySlug('Boston ', 'MA')).toBe('boston-ma');
    });

    it('leading/trailing punctuation is stripped, inner punctuation collapses', () => {
        expect(buildCitySlug(' St. Paul ', 'MN')).toBe('st-paul-mn');
        expect(buildCitySlug('Boston.', 'MA')).toBe('boston-ma');
    });

    it('a value that sanitizes to nothing yields the empty slug (dropped upstream)', () => {
        expect(buildCitySlug('   ', 'MA')).toBe('');
        expect(buildCitySlug('***', 'MA')).toBe('');
    });

    it('the trim-safe slug round-trips through the city route parser', () => {
        // The /jobs/city/[slug] route rebuilds a name from the slug; the old
        // boston--ma slug parsed back to a name matching zero rows.
        expect(parseCitySlugToName(buildCitySlug('Boston ', 'MA'))).toBe('Boston');
    });
});

describe('D4 — sitemap city block uses the canonical helpers, not a local re-derivation', () => {
    it('imports and calls buildCitySlug', () => {
        expect(sitemapSrc).toMatch(/import\s*\{[\s\S]*?buildCitySlug[\s\S]*?\}\s*from\s*'@\/app\/jobs\/locations\/\[state\]\/directory'/);
        expect(sitemapSrc).toMatch(/buildCitySlug\(/);
    });

    it('the old inline slug derivation is gone', () => {
        // `${c.city!.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${code...` —
        // the exact expression that produced boston--ma.
        expect(sitemapSrc).not.toMatch(/city!?\.toLowerCase\(\)\.replace\(/);
    });

    it('metro-consolidated slugs are filtered out of cityPages', () => {
        expect(sitemapSrc).toMatch(/metroTwinSlugs/);
        expect(sitemapSrc).toMatch(/METRO_CITIES\.map\(m => m\.slug\)/);
        expect(sitemapSrc).toMatch(/if \(metroTwinSlugs\.has\(slug\)\) continue/);
    });

    it('unresolvable round-trip slugs are vetoed with cityLinkResolves', () => {
        expect(sitemapSrc).toMatch(/if \(!cityLinkResolves\(c\.city, code\)\) continue/);
    });

    it('entries are deduped by slug (dirty-twin city values collapse to one URL)', () => {
        expect(sitemapSrc).toMatch(/cityPageBySlug/);
        expect(sitemapSrc).toMatch(/cityPageBySlug\.set\(slug/);
    });
});

describe('D4 — the 13 runtime-flagged redirecting slugs are all metro twins (filter premise)', () => {
    const flagged = [
        'new-york-ny', 'los-angeles-ca', 'dallas-tx', 'chicago-il',
        'seattle-wa', 'atlanta-ga', 'houston-tx', 'philadelphia-pa',
        'boston-ma', 'denver-co', 'nashville-tn', 'washington-dc',
        'san-antonio-tx',
    ];
    const metroSlugs = new Set(METRO_CITIES.map((m) => m.slug));

    it.each(flagged)('%s is a curated metro slug the filter now drops', (slug) => {
        expect(metroSlugs.has(slug)).toBe(true);
    });

    it('metro cities still pass cityLinkResolves (metro exemption intact)', () => {
        // e.g. "New York" → new-york-ny parses back fine, but even names that
        // would not round-trip are exempt when the slug is a curated metro.
        expect(cityLinkResolves('New York', 'NY')).toBe(true);
    });
});
