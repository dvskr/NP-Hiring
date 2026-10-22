/**
 * lib/direct-apply.ts: which apply links count as the employer's own site.
 *
 * Register 2.26: JazzHR serves its apply pages from <company>.applytojob.com
 * (jazz.co is its older domain), so those listings fell through to the plain
 * "Apply Now" label although they continue on the employer's ATS.
 */
import { describe, it, expect } from 'vitest';
import { isEmployerSiteUrl } from '@/lib/direct-apply';

describe('isEmployerSiteUrl', () => {
    it('recognises a JazzHR apply page', () => {
        expect(isEmployerSiteUrl('https://riversidehealth.applytojob.com/apply/AbC123/Family-Nurse-Practitioner')).toBe(true);
    });

    it('still recognises the hosts it knew', () => {
        for (const url of [
            'https://clinic.wd5.myworkdayjobs.com/en-US/careers/job/NP',
            'https://boards.greenhouse.io/clinic/jobs/1',
            'https://app.jazz.co/apply/1',
            'https://careers.example-health.org/np',
        ]) {
            expect(isEmployerSiteUrl(url), url).toBe(true);
        }
    });

    it('labels nothing it cannot vouch for', () => {
        for (const url of ['https://www.indeed.com/viewjob?jk=1', 'https://example.com/np', '', null, undefined]) {
            expect(isEmployerSiteUrl(url), String(url)).toBe(false);
        }
    });
});
