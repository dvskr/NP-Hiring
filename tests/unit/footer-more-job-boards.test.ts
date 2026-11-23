/**
 * The footer's "More Job Boards" group (the owner, 2026-11-23: cross-link
 * every job board from every site's footer). It links the company's other
 * public boards by name, in the same tab, and never a board that is still
 * behind the host's sign-in wall: such a link would send visitors and
 * crawlers to a login page.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brand } from '@/config/brand';
import { JOB_BOARD_NETWORK, SELF_HOST, sisterBoards } from '@/lib/job-board-network';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
        createElement('a', { href, ...rest }, children as never),
}));

import Footer from '@/components/Footer';

const html = renderToStaticMarkup(createElement(Footer));
const group = /<nav aria-label="More Job Boards">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
const anchors = [...group.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map((m) => ({ attrs: m[1], text: m[2] }));
const hrefOf = (attrs: string) => /href="([^"]*)"/.exec(attrs)?.[1] ?? '';

describe('the job board network list', () => {
    it('names each board once, at its own host', () => {
        const hosts = JOB_BOARD_NETWORK.map((board) => new URL(board.url).host);
        expect(new Set(hosts).size).toBe(hosts.length);
        expect(new Set(JOB_BOARD_NETWORK.map((board) => board.name)).size).toBe(JOB_BOARD_NETWORK.length);
    });

    it('lists this site itself, at this site\'s host', () => {
        expect(SELF_HOST).toBe(brand.domain);
        expect(JOB_BOARD_NETWORK.some((board) => new URL(board.url).host === SELF_HOST && board.name === brand.name)).toBe(true);
    });

    it('offers only live boards, and never the site itself', () => {
        const offered = sisterBoards();
        expect(offered.length).toBeGreaterThan(0);
        for (const board of offered) {
            expect(board.live, board.name).toBe(true);
            expect(new URL(board.url).host, board.name).not.toBe(SELF_HOST);
        }
        expect(offered.length).toBe(JOB_BOARD_NETWORK.filter((board) => board.live).length - 1);
    });
});

describe('the footer links the other public job boards', () => {
    it('renders the group with one link per live sister board, by name', () => {
        expect(group, 'a "More Job Boards" footer group').not.toBe('');
        expect(group).toContain('More Job Boards');
        expect(anchors.map((a) => ({ href: hrefOf(a.attrs), text: a.text }))).toEqual(
            sisterBoards().map((board) => ({ href: board.url, text: board.name })),
        );
    });

    it('links PMHNP Hiring', () => {
        expect(anchors.some((a) => hrefOf(a.attrs) === 'https://pmhnphiring.com' && a.text === 'PMHNP Hiring')).toBe(true);
    });

    it('opens each board in the same tab, as a plain followed link', () => {
        for (const a of anchors) {
            expect(a.attrs, a.text).not.toContain('target=');
            expect(a.attrs, a.text).not.toContain('rel=');
        }
    });

    it('links no board that is not open to the public yet, anywhere in the footer', () => {
        for (const board of JOB_BOARD_NETWORK.filter((b) => !b.live)) {
            expect(html, board.name).not.toContain(new URL(board.url).host);
        }
    });
});
