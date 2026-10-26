/**
 * The admin SEO health page shows a snapshot day Search Console returned no
 * row for as not read, never as 0 (register 2.30).
 *
 * The gsc-health-check cron stores null for such a day: usually "today"
 * (yesterday), which Search Console has not processed when the cron runs. The
 * page read that null as 0 clicks and 0 impressions on every row, and against
 * a week-ago day it did read, as a red 100% drop. lib/gsc-snapshot-days.ts
 * reads a stored day, and the page prints N/A and no change for one that was
 * not read.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { snapshotDay } from '@/lib/gsc-snapshot-days';

const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('snapshotDay', () => {
    const raw = {
        searchAnalytics: {
            today: null,
            weekAgo: { clicks: 3, impressions: 280, ctr: 0.0107, position: 19.2 },
        },
    };

    it('reads the totals of a day Search Console answered for', () => {
        expect(snapshotDay(raw, 'weekAgo')).toEqual({ clicks: 3, impressions: 280, ctr: 0.0107, position: 19.2 });
    });

    it('reads a day it returned no row for as not read', () => {
        expect(snapshotDay(raw, 'today')).toBeNull();
    });

    it.each([
        ['no raw payload', null],
        ['a payload that is not an object', 'garbage'],
        ['a payload with no searchAnalytics', { sitemaps: [] }],
        ['a searchAnalytics that is not an object', { searchAnalytics: 7 }],
        ['a day that is not an object', { searchAnalytics: { today: 'none' } }],
    ])('reads %s as not read', (_label, value) => {
        expect(snapshotDay(value, 'today')).toBeNull();
    });

    it('a stored day missing a figure, or holding one that is not a number, reads that figure as 0', () => {
        expect(snapshotDay({ searchAnalytics: { today: { clicks: 2, impressions: '90' } } }, 'today')).toEqual({ clicks: 2, impressions: 0, ctr: 0, position: 0 });
    });
});

describe('app/admin/seo-health/page.tsx', () => {
    const src = read('app/admin/seo-health/page.tsx');

    it('reads both snapshot days through snapshotDay', () => {
        expect(src).toContain("from '@/lib/gsc-snapshot-days'");
        expect(src).toContain("snapshotDay(latest.raw, 'today')");
        expect(src).toContain("snapshotDay(latest.raw, 'weekAgo')");
        expect(src).toContain("snapshotDay(s.raw, 'today')");
    });

    it('no longer turns a day that was not read into 0, or a change from one', () => {
        expect(src).not.toMatch(/\.clicks \?\? 0/);
        expect(src).not.toMatch(/\.impressions \?\? 0/);
        expect(src).toContain('todaySa && wkAgoSa ? deltaPct(todaySa.clicks, wkAgoSa.clicks) : null');
        expect(src).toContain('todaySa && wkAgoSa ? deltaPct(todaySa.impressions, wkAgoSa.impressions) : null');
    });
});
