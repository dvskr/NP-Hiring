/**
 * Duplicate detection by work site (indexing audit CQ-10 / GFJ-09 /
 * fixSoon 8): genuine per-city requisitions stay separate, true duplicates
 * collapse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
    workSiteOf,
    isSameWorkSite,
    buildSiteIdentityKey,
    descriptionFingerprint,
    checkDuplicate,
} from '@/lib/deduplicator';

const BODY = 'Provide psychiatric evaluations and medication management for adults in our outpatient clinic. '.repeat(4);

describe('workSiteOf / isSameWorkSite', () => {
    it('treats format variants of one place as the same site', () => {
        expect(isSameWorkSite(workSiteOf('Denver, CO'), workSiteOf('Denver, Colorado, United States'))).toBe(true);
        expect(isSameWorkSite(workSiteOf('Remote'), workSiteOf('Remote, US'))).toBe(true);
    });

    it.each([
        ['VA - Norfolk', 'VA - Suffolk'],
        ['Springfield, MO', 'Springfield, IL'],
        ['Remote - OH', 'Remote - WI'],
        ['North Carolina, United States', 'United States- Remote'],
        ['Denver, CO', 'Colorado'],
        ['1730 Rhode Island Ave NW, Washington, DC, 20036', '4200 Wisconsin Ave NW, Washington, DC, 20016'],
        ['5100 Buckeyestown Pike Suite 200 Frederick, MD 21704', '7310 Grove Rd Suite 107 Frederick, MD 21704'],
    ])('keeps %s and %s apart', (a, b) => {
        expect(isSameWorkSite(workSiteOf(a), workSiteOf(b))).toBe(false);
    });

    it('carries the street address, and treats one address in two formats as one site', () => {
        expect(workSiteOf('4200 Wisconsin Ave NW, Washington, DC, 20016')).toEqual({
            city: 'washington',
            stateCode: 'DC',
            isRemote: false,
            address: '4200 wisconsin ave nw',
        });
        expect(isSameWorkSite(
            workSiteOf('5100 Buckeyestown Pike Suite 200 Frederick, MD 21704'),
            workSiteOf('5100 Buckeyestown Pike, Frederick, Maryland'),
        )).toBe(true);
    });
});

describe('buildSiteIdentityKey', () => {
    it('is equal for one posting in two location formats', () => {
        expect(buildSiteIdentityKey('PMHNP', 'Acme Health', 'Denver, CO'))
            .toBe(buildSiteIdentityKey('PMHNP', 'Acme Health, LLC', 'Denver, Colorado, United States'));
    });

    it('differs per street address in one city', () => {
        expect(buildSiteIdentityKey('Psychiatric Clinician', 'Sol Mental Health', '1730 Rhode Island Ave NW, Washington, DC, 20036'))
            .not.toBe(buildSiteIdentityKey('Psychiatric Clinician', 'Sol Mental Health', '4200 Wisconsin Ave NW, Washington, DC, 20016'));
        expect(buildSiteIdentityKey('Psychiatric Clinician', 'Sol Mental Health', '5100 Buckeyestown Pike Suite 200 Frederick, MD 21704'))
            .not.toBe(buildSiteIdentityKey('Psychiatric Clinician', 'Sol Mental Health', '7310 Grove Rd Suite 107 Frederick, MD 21704'));
    });

    it('differs per city, so per-city requisitions stay separate', () => {
        expect(buildSiteIdentityKey('Psychiatric Nurse Practitioner - Fee For Service', 'Thriveworks', 'VA - Norfolk'))
            .not.toBe(buildSiteIdentityKey('Psychiatric Nurse Practitioner - Fee For Service', 'Thriveworks', 'VA - Williamsburg'));
    });

    it('is null without a city (state-level and remote postings never collapse on it)', () => {
        expect(buildSiteIdentityKey('PMHNP', 'Acme', 'Texas')).toBeNull();
        expect(buildSiteIdentityKey('PMHNP', 'Acme', 'Remote')).toBeNull();
    });
});

describe('descriptionFingerprint', () => {
    it('ignores markup, case and spacing', () => {
        expect(descriptionFingerprint(`<p>${BODY}</p>`)).toBe(descriptionFingerprint(BODY.toUpperCase().replace(/ /g, '  ')));
    });

    it('is null for text too short to identify a posting', () => {
        expect(descriptionFingerprint('Short posting.')).toBeNull();
    });
});

describe('checkDuplicate', () => {
    beforeEach(() => {
        vi.mocked(prisma.job.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.job.findMany).mockResolvedValue([]);
    });

    it('matches the same posting across location formats through the site map', async () => {
        const siteMap = new Map([[buildSiteIdentityKey('PMHNP', 'Acme Health', 'Denver, CO')!, 'job-1']]);
        const result = await checkDuplicate(
            { title: 'PMHNP', employer: 'Acme Health', location: 'Denver, Colorado, United States' },
            { globalTitleKeyMap: new Map(), globalSiteKeyMap: siteMap, globalApplyLinkMap: new Map() },
        );
        expect(result).toMatchObject({ isDuplicate: true, matchType: 'same_site', matchedJobId: 'job-1' });
    });

    it('collapses a remote posting whose text is identical to a stored one', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValueOnce([
            { id: 'job-2', title: 'PMHNP', location: 'Remote', description: BODY },
        ] as never);
        const result = await checkDuplicate(
            { title: 'PMHNP', employer: 'BlueSky Telepsych', location: 'Remote, US', description: BODY },
            { globalTitleKeyMap: new Map(), globalSiteKeyMap: new Map(), globalApplyLinkMap: new Map() },
        );
        expect(result).toMatchObject({ isDuplicate: true, matchType: 'exact_content', matchedJobId: 'job-2' });
    });

    it('keeps a same-text posting for a different site separate', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([
            { id: 'job-3', title: 'PMHNP', employer: 'BlueSky Telepsych', location: 'North Carolina, United States', description: BODY },
        ] as never);
        const result = await checkDuplicate(
            { title: 'PMHNP', employer: 'BlueSky Telepsych', location: 'United States- Remote', description: BODY },
            { globalTitleKeyMap: new Map(), globalSiteKeyMap: new Map(), globalApplyLinkMap: new Map() },
        );
        expect(result.isDuplicate).toBe(false);
    });

    // Two clinics of one employer in one city are two work sites. Before the
    // street address was part of the site, both of these returned
    // { isDuplicate: true, matchType: 'same_site' }, so the second clinic's
    // posting was never inserted and renewal could copy its description onto
    // the first clinic's page.
    it.each([
        ['1730 Rhode Island Ave NW, Washington, DC, 20036', '4200 Wisconsin Ave NW, Washington, DC, 20016'],
        ['5100 Buckeyestown Pike Suite 200 Frederick, MD 21704', '7310 Grove Rd Suite 107 Frederick, MD 21704'],
    ])('keeps two addresses in one city apart: %s vs %s', async (stored, incoming) => {
        const job = { title: 'Psychiatric Clinician', employer: 'Sol Mental Health', location: incoming };
        const siteMap = new Map([[buildSiteIdentityKey(job.title, job.employer, stored)!, 'sol-1']]);
        vi.mocked(prisma.job.findMany).mockResolvedValue([
            { id: 'sol-1', title: job.title, employer: job.employer, location: stored },
        ] as never);
        const result = await checkDuplicate(job, {
            globalTitleKeyMap: new Map(),
            globalSiteKeyMap: siteMap,
            globalApplyLinkMap: new Map(),
        });
        expect(result).toMatchObject({ isDuplicate: false, matchType: 'none' });
    });

    it('still collapses one address written two ways', async () => {
        const stored = '4200 Wisconsin Avenue NW, Washington, DC 20016';
        const job = { title: 'Psychiatric Clinician', employer: 'Sol Mental Health', location: '4200 Wisconsin Ave. NW, Washington, DC, 20016' };
        const siteMap = new Map([[buildSiteIdentityKey(job.title, job.employer, stored)!, 'sol-2']]);
        const result = await checkDuplicate(job, {
            globalTitleKeyMap: new Map(),
            globalSiteKeyMap: siteMap,
            globalApplyLinkMap: new Map(),
        });
        expect(result).toMatchObject({ isDuplicate: true, matchType: 'same_site', matchedJobId: 'sol-2' });
    });

    it('no longer merges look-alike cities in the fuzzy pass', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([
            { id: 'job-4', title: 'Psychiatric Nurse Practitioner - Fee For Service', employer: 'Thriveworks', location: 'VA - Norfolk' },
        ] as never);
        const result = await checkDuplicate(
            { title: 'Psychiatric Nurse Practitioner - Fee For Service', employer: 'Thriveworks', location: 'VA - Suffolk' },
            { globalTitleKeyMap: new Map(), globalSiteKeyMap: new Map(), globalApplyLinkMap: new Map() },
        );
        expect(result.isDuplicate).toBe(false);
    });
});
