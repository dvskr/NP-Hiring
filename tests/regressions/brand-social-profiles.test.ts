/**
 * The board's social profiles (config/brand.ts brand.social): only profiles
 * the board owns, because the footer links each one and the Organization
 * schema names every one in sameAs. A sameAs that names a handle someone else
 * holds would tie this entity to that account, which is worse than no entry.
 *
 * 2026-11-26: the owner created the Facebook page and the YouTube channel, and
 * the x, instagram and linkedin placeholders (never claimed) were removed
 * until the owner sends the real profiles. The Facebook group is a community,
 * not the board's profile, so it is in neither list.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brand } from '@/config/brand';
import { readCode } from '../helpers/source';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
        createElement('a', { href, ...rest }, children as never),
}));

import Footer from '@/components/Footer';

/** Hosts of the social networks the footer has ever linked. */
const SOCIAL_HOSTS = /^https:\/\/(?:www\.)?(?:facebook\.com|youtube\.com|x\.com|twitter\.com|instagram\.com|linkedin\.com)\//;

describe('brand.social', () => {
    it('holds the two profiles the board owns, and nothing else', () => {
        expect(brand.social).toEqual({
            facebook: 'https://www.facebook.com/nphiring',
            youtube: 'https://www.youtube.com/@nphiring',
        });
    });

    it('names no placeholder handle and no group', () => {
        for (const url of Object.values(brand.social)) {
            expect(url, url).not.toMatch(/x\.com|twitter\.com|instagram\.com|linkedin\.com|\/groups\//);
        }
    });
});

describe('the profiles reach the footer and the Organization schema, and only they do', () => {
    it('the footer links each profile once, in a new tab, and no other social account', () => {
        const html = renderToStaticMarkup(createElement(Footer));
        const links = [...html.matchAll(/<a\b[^>]*>/g)]
            .map((m) => ({ tag: m[0], href: (m[0].match(/href="([^"]*)"/)?.[1] ?? '').replace(/&amp;/g, '&') }))
            .filter((link) => SOCIAL_HOSTS.test(link.href));
        expect(links.map((link) => link.href)).toEqual(Object.values(brand.social));
        for (const link of links) {
            expect(link.tag, link.href).toContain('target="_blank"');
            expect(link.tag, link.href).toMatch(/rel="[^"]*noopener/);
            expect(link.tag, link.href).toMatch(/aria-label="[^"]+"/);
        }
    });

    it('the Organization sameAs lists every profile in brand.social', () => {
        const layout = readCode('app/layout.tsx');
        expect(layout).toMatch(/"sameAs":\s*Object\.values\(brand\.social\)/);
    });
});
