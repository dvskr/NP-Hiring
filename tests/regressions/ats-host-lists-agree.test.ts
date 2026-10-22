/**
 * The four lists of employer apply hosts agree (register 2.26, review M1).
 *
 * Whether an aggregated job counts as one that continues on the employer's
 * own site is decided in four places, each told to mirror the others:
 *   - lib/direct-apply.ts ATS_PATTERNS: the "Apply on employer site" label;
 *   - lib/ai/job-classifier.ts ATS_HOST_SUBSTRINGS: classifyJob's direct
 *     apply tier, the post-filter of the featured jobs, the alert digests,
 *     the widget and the recommendations;
 *   - lib/ai/recommendation-policy.ts ATS_HOST_SUBSTRINGS: the database
 *     filters (applyLink contains) behind those surfaces;
 *   - lib/ai/vector-search.ts: the Postgres regex of the direct apply pool.
 * JazzHR's apply pages (<company>.applytojob.com) were added to the label
 * only, so a JazzHR job was labelled as the employer's site while every
 * surface that features direct apply jobs still treated it as an aggregator
 * link. One sample of links now runs through all four.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isEmployerSiteUrl } from '@/lib/direct-apply';
import { classifyJob, ATS_HOST_SUBSTRINGS as CLASSIFIER_HOSTS } from '@/lib/ai/job-classifier';
import { ATS_HOST_SUBSTRINGS as POLICY_HOSTS } from '@/lib/ai/recommendation-policy';

const ROOT = path.resolve(__dirname, '../..');

/** The apply_link regex the direct apply pool query runs, as written in its SQL. */
function vectorSearchPattern(): RegExp {
    const src = fs.readFileSync(path.join(ROOT, 'lib/ai/vector-search.ts'), 'utf8');
    const match = /apply_link ~\* '([^']+)'/.exec(src);
    expect(match, 'the direct apply pool query names no apply_link regex').not.toBeNull();
    // The SQL sits in a template literal, so each backslash is written twice.
    return new RegExp(match![1].replace(/\\\\/g, '\\'), 'i');
}

const EMPLOYER_SITES = [
    'https://riversidehealth.applytojob.com/apply/AbC123/Family-Nurse-Practitioner',
    'https://clinic.wd5.myworkdayjobs.com/en-US/careers/job/NP',
    'https://boards.greenhouse.io/clinic/jobs/1',
    'https://jobs.lever.co/clinic/1',
    'https://jobs.ashbyhq.com/clinic/1',
    'https://jobs.smartrecruiters.com/Clinic/1',
    'https://careers-clinic.icims.com/jobs/1/np/job',
    'https://app.jazz.co/apply/1',
    'https://clinic.bamboohr.com/careers/1',
    'https://www.usajobs.gov/job/1',
    'https://apply.workable.com/clinic/j/1',
    'https://careers.example-health.org/np',
];

const OTHER_SITES = [
    'https://www.indeed.com/viewjob?jk=1',
    'https://www.linkedin.com/jobs/view/1',
    'https://example.com/np',
];

const asJob = (applyLink: string) => ({ sourceType: 'external', applyOnPlatform: false, applyLink });

describe('the employer apply host lists agree', () => {
    it.each(EMPLOYER_SITES)('all four count %s as the employer site', (url) => {
        expect(isEmployerSiteUrl(url), 'lib/direct-apply.ts').toBe(true);
        expect(classifyJob(asJob(url)).tier, 'lib/ai/job-classifier.ts').toBe('direct_apply');
        expect(POLICY_HOSTS.some((host) => url.toLowerCase().includes(host)), 'lib/ai/recommendation-policy.ts').toBe(true);
        expect(vectorSearchPattern().test(url), 'lib/ai/vector-search.ts').toBe(true);
    });

    it.each(OTHER_SITES)('none of the four counts %s', (url) => {
        expect(isEmployerSiteUrl(url)).toBe(false);
        expect(classifyJob(asJob(url)).tier).toBe('external');
        expect(POLICY_HOSTS.some((host) => url.toLowerCase().includes(host))).toBe(false);
        expect(vectorSearchPattern().test(url)).toBe(false);
    });

    it('the two substring lists are the same list', () => {
        expect([...CLASSIFIER_HOSTS].sort()).toEqual([...POLICY_HOSTS].sort());
    });
});
