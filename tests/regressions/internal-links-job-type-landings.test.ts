/**
 * Register 2.26, coverage wording outside app/jobs: the job page's "Explore
 * More Opportunities" card (components/InternalLinks.tsx) sent every Contract
 * job to /jobs/travel as "Explore Travel NP Positions", although the travel
 * landing lists only jobs tagged travel (tests/unit/category-predicate.test.ts)
 * and /jobs/contract is the landing that lists contract roles. A Locum Tenens
 * job got no type link at all. Each type link now goes to the landing that
 * lists the job, by the category rule the landings use (jobTypeValueCategory
 * in lib/pseo/category-structural.ts), and the travel link only to a job
 * tagged travel.
 *
 * The scan in nav-card-coverage-claims.test.ts already reads every
 * component for the /jobs/locations wording; its travel and locum tenens
 * check now reads components and lib modules too.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import InternalLinks from '@/components/InternalLinks';

type Props = React.ComponentProps<typeof InternalLinks>;
const render = (props: Props): string => renderToStaticMarkup(React.createElement(InternalLinks, props));

const PAGE = fs.readFileSync(path.join(process.cwd(), 'app/jobs/[slug]/page.tsx'), 'utf8');

describe('InternalLinks: a job type link goes to the landing that lists the job', () => {
    it('a contract job links the contract landing, not travel', () => {
        const html = render({ jobType: 'Contract' });
        expect(html).toContain('href="/jobs/contract"');
        expect(html).toContain('View Contract');
        expect(html).not.toContain('href="/jobs/travel"');
        expect(html).not.toContain('Travel');
    });

    it('a locum tenens job links the locum tenens landing', () => {
        const html = render({ jobType: 'Locum Tenens' });
        expect(html).toContain('href="/jobs/locum-tenens"');
        expect(html).toContain('View Locum Tenens');
        expect(html).not.toContain('href="/jobs/travel"');
    });

    it('a per diem or PRN job links the per diem landing', () => {
        for (const jobType of ['Per Diem', 'PRN']) {
            expect(render({ jobType }), jobType).toContain('href="/jobs/per-diem"');
        }
    });

    it('a job tagged travel links the travel landing, whatever its type', () => {
        const html = render({ jobType: 'Full-Time', isTravel: true });
        expect(html).toContain('href="/jobs/travel"');
        expect(html).toContain('Explore Travel');
    });

    it('a full-time job with no other signal falls back to all jobs', () => {
        const html = render({ jobType: 'Full-Time' });
        expect(html).toContain('href="/jobs"');
        expect(html).not.toContain('href="/jobs/travel"');
        expect(html).not.toContain('href="/jobs/contract"');
    });

    it('the job page passes the travel tag, which /jobs/travel lists', () => {
        const start = PAGE.indexOf('<InternalLinks');
        const links = PAGE.slice(start, PAGE.indexOf('/>', start));
        expect(links).toContain('isTravel={isTravelJob}');
        expect(PAGE).toContain("const isTravelJob = job.categoryTags?.includes('travel') === true;");
    });
});
