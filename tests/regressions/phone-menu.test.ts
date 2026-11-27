/**
 * The phone menu (components/PhoneMenu.tsx), from the phone restructure the
 * owner approved on 2026-11-27: one round button at the right end of the bar
 * on every page, and the same menu behind it everywhere. Before, the phone
 * bar had a menu button on the left and Log in and Sign up on the right, and
 * the menu's extra links showed to signed-out visitors only.
 *
 * The menu itself renders only when tapped open (a portal), so its lists are
 * pinned here as data (lib/nav/phone-menu-links.ts) and its markup by source
 * with comments blanked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readCode } from '../helpers/source';

vi.mock('next/navigation', () => ({
    usePathname: () => '/jobs',
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/image', () => ({
    default: ({ src, alt }: { src?: string; alt?: string }) => createElement('img', { src, alt: alt ?? '' }),
}));
// As the footer tests do: a link renders as a plain anchor.
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
        createElement('a', { href, ...rest }, children as never),
}));

import PhoneMenu, { PHONE_MENU_ID } from '@/components/PhoneMenu';
import Header from '@/components/Header';
import { PHONE_MENU_BUTTONS, PHONE_MENU_GROUPS, PHONE_MENU_SMALL_LINKS } from '@/lib/nav/phone-menu-links';
import { ADMIN_LINKS, EMPLOYER_LINKS, SEEKER_LINKS, roleLinks } from '@/lib/nav/role-links';

const ROOT = process.cwd();

/** Whether an internal path has a page of its own in app/. */
function routeExists(href: string): boolean {
    const clean = href.split('#')[0].split('?')[0].replace(/^\/|\/$/g, '');
    return fs.existsSync(path.join(ROOT, 'app', clean, 'page.tsx'));
}

/** The sources next.config.ts redirects away from. */
function redirectedPaths(): string[] {
    const config = fs.readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');
    const start = config.indexOf('async redirects()');
    expect(start, 'redirects() in next.config.ts').toBeGreaterThan(-1);
    const body = config.slice(start);
    return [...body.matchAll(/source:\s*'([^']+)'/g)].map((m) => m[1]);
}

const GROUP_HREFS = PHONE_MENU_GROUPS.flatMap((group) => group.links.map((link) => link.href));
const MENU_HREFS = [
    ...PHONE_MENU_BUTTONS,
    ...PHONE_MENU_GROUPS.flatMap((group) => group.links),
    ...PHONE_MENU_SMALL_LINKS,
].map((link) => link.href);

describe('the button', () => {
    it('is all a page sends: the menu itself opens on a tap', () => {
        const html = renderToStaticMarkup(createElement(PhoneMenu));
        expect(html).toContain('data-phone-menu-button=""');
        expect(html).toContain('aria-label="Menu"');
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain(`aria-controls="${PHONE_MENU_ID}"`);
        expect(html).not.toContain('role="dialog"');
    });

    it('takes the classes of the bar that places it, on a wrapper, so its own look never overrides them', () => {
        const html = renderToStaticMarkup(createElement(PhoneMenu, { className: 'lg:hidden' }));
        expect(html).toMatch(/^<div class="lg:hidden" data-phone-menu="">/);
        expect(html).toMatch(/<button type="button" class="phone-menu-button" data-phone-menu-button=""/);
    });
});

describe('the header on a phone', () => {
    const html = renderToStaticMarkup(createElement(Header));

    it('has one menu button, the phone menu, at the right end of the bar', () => {
        expect(html.split('data-phone-menu-button=""').length - 1).toBe(1);
        expect(html).not.toContain('aria-label="Toggle menu"');
        expect(html).not.toContain('mobile-nav-menu');
        expect(html).toContain('<div class="lg:hidden" data-phone-menu="">');
        // After the desktop links, the jobs page's alert slot and the desktop
        // account block: the last thing in the bar.
        const menuAt = html.indexOf('data-phone-menu=""');
        expect(menuAt).toBeGreaterThan(html.indexOf('<nav class="hidden lg:flex'));
        expect(menuAt).toBeGreaterThan(html.indexOf('id="nav-alert-slot"'));
        expect(html.slice(menuAt)).toMatch(/^[^]*?<\/button>[^]*?<\/div><\/header>/);
    });

    it("shows the board's name beside the logo on a phone too", () => {
        expect(html).toMatch(/<span class="font-heading hdr-word"/);
        expect(html).not.toContain('font-heading hidden sm:inline');
    });

    it('puts no sign in control in the phone bar: it is in the menu', () => {
        const phoneBar = html.slice(html.indexOf('data-phone-menu=""'));
        expect(phoneBar).not.toContain('animate-pulse');
        expect(phoneBar).not.toContain('Log in');
        // One account control is left in the bar: the desktop one, shown from
        // 1024 pixels up, which on a phone still finds out who is signed in.
        expect(html.split('motion-safe:animate-pulse').length - 1).toBe(1);
        const desktop = html.slice(html.indexOf('<div class="hidden lg:flex items-center gap-2 flex-shrink-0">'));
        expect(desktop.indexOf('motion-safe:animate-pulse')).toBeGreaterThan(-1);
        expect(desktop.indexOf('motion-safe:animate-pulse')).toBeLessThan(desktop.indexOf('data-phone-menu=""'));
    });
});

describe('the menu lists', () => {
    it('opens with Browse Jobs and Post a Job, for every visitor', () => {
        expect(PHONE_MENU_BUTTONS).toEqual([
            { href: '/jobs', label: 'Browse Jobs' },
            { href: '/post-job', label: 'Post a Job' },
        ]);
        // No sign in state guards the two buttons.
        const code = readCode('components/PhoneMenu.tsx');
        const at = code.indexOf('{PHONE_MENU_BUTTONS.map(');
        expect(at).toBeGreaterThan(-1);
        expect(code.slice(Math.max(0, at - 200), at)).not.toMatch(/role\s*(?:===|!==)|typeof role|ownLinks\.length/);
    });

    it('then three short groups, Find jobs, Pay and careers and Employers, then About and Contact', () => {
        expect(PHONE_MENU_GROUPS.map((group) => group.title)).toEqual(['Find jobs', 'Pay and careers', 'Employers']);
        for (const group of PHONE_MENU_GROUPS) expect(group.links.length, group.title).toBeGreaterThan(0);
        expect(PHONE_MENU_SMALL_LINKS.map((link) => link.href)).toEqual(['/about', '/contact']);
    });

    it('the groups render for every visitor on every page: no condition on the page or the role guards them', () => {
        const code = readCode('components/PhoneMenu.tsx');
        const at = code.indexOf('{PHONE_MENU_GROUPS.map(');
        expect(at).toBeGreaterThan(-1);
        const before = code.slice(code.lastIndexOf(')}', at), at);
        expect(before).not.toMatch(/pathname|role|&&/);
    });

    it('no link twice, and no group repeats a button or a small link', () => {
        expect(new Set(MENU_HREFS).size).toBe(MENU_HREFS.length);
        for (const href of ['/jobs', '/post-job', '/about', '/contact']) expect(GROUP_HREFS).not.toContain(href);
    });

    it('every link opens a page of its own: a route in app/, never a redirect', () => {
        const missing = MENU_HREFS.filter((href) => !routeExists(href));
        expect(missing, `phone menu links with no page: ${missing.join(', ')}`).toEqual([]);
        const redirected = redirectedPaths();
        expect(MENU_HREFS.filter((href) => redirected.includes(href))).toEqual([]);
        // /new-grad only redirects to the listing, so the menu links the listing.
        expect(redirected).toContain('/new-grad');
        expect(GROUP_HREFS).toContain('/jobs/new-grad');
    });

    it('carries the directories, the tools hub and the guides store', () => {
        for (const href of ['/companies', '/jobs/locations', '/tools', '/guides']) expect(GROUP_HREFS).toContain(href);
    });

    it('the account row offers Sign in and Create account to a signed-out visitor, and the account control to a signed-in one', () => {
        const code = readCode('components/PhoneMenu.tsx');
        const signedOut = code.slice(code.indexOf('{role === null && ('), code.indexOf("{typeof role === 'string' && ("));
        expect(signedOut).toMatch(/<Link href="\/login"[^>]*>\s*Sign in/);
        expect(signedOut).toMatch(/<Link href="\/signup"[^>]*>\s*Create account/);
        const signedIn = code.slice(code.indexOf("{typeof role === 'string' && ("));
        expect(signedIn).toContain('<HeaderAuth onNavigate={close} />');
        for (const href of ['/login', '/signup']) expect(routeExists(href), href).toBe(true);
    });

    it('a tap on any link closes the menu', () => {
        const code = readCode('components/PhoneMenu.tsx');
        const links = code.match(/<Link\b[^>]*>/g) ?? [];
        expect(links.length).toBeGreaterThanOrEqual(5);
        for (const tag of links) expect(tag).toMatch(/onClick=\{(?:close|onTap)\}/);
    });
});

describe("a signed-in visitor's own links", () => {
    it('one list per role, shared by the desktop bar and the top of the phone menu', () => {
        expect(roleLinks('job_seeker')).toBe(SEEKER_LINKS);
        expect(roleLinks('employer')).toBe(EMPLOYER_LINKS);
        expect(roleLinks('admin')).toBe(ADMIN_LINKS);
        expect(roleLinks(null)).toBeNull();
        expect(roleLinks(undefined)).toBeNull();
        expect(readCode('components/Header.tsx')).toContain('roleLinks(userRole) ?? publicNavLinks');
        expect(readCode('components/PhoneMenu.tsx')).toContain('roleLinks(role)');
    });

    it('every own link opens a page', () => {
        for (const link of [...SEEKER_LINKS, ...EMPLOYER_LINKS, ...ADMIN_LINKS]) {
            expect(routeExists(link.href), link.href).toBe(true);
        }
    });
});
