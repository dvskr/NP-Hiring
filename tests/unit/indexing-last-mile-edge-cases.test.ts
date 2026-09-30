/**
 * Edge cases the last skeptic round found after three fix rounds, each fixed
 * with the patch that skeptic tested:
 *   - GFJ-07: every state listed before a remote token counts, so a job open
 *     in Oregon and Washington is not advertised to Washington alone, and two
 *     postings for different state sets never share a <title>.
 *   - M-04: the hyphenated "Nurse-Practitioner" and APN spellings count as NP
 *     terms, so a shortened title never keeps only the PA half of the role.
 *   - GFJ-01: a sentence that names the job itself as remote and negates
 *     something else ("This remote position does not require travel") is not
 *     read as on site; a negated full-remote claim for work from home,
 *     telework or telehealth is not read as Remote; a negation in the title
 *     ("No Remote") makes the job on site.
 */
import { describe, it, expect } from 'vitest';
import { statesNearRemoteToken, cleanRoleTitle } from '@/app/jobs/[slug]/job-posting-facts';
import { buildJobPageTitle } from '@/app/jobs/[slug]/job-page-meta';
import { detectMode } from '@/lib/work-mode-detection';
import { normalizeJobWithReason } from '@/lib/job-normalizer';

describe('GFJ-07: every state listed before a remote token', () => {
    it.each([
        ['PMHNP - OR/WA - Remote', ['OR', 'WA']],
        ['Oregon or Washington, Remote', ['OR', 'WA']],
        ['TX, OK - Remote', ['TX', 'OK']],
        ['NY & NJ Remote', ['NY', 'NJ']],
    ])('%s gives every listed state', (title, expected) => {
        expect(statesNearRemoteToken(title)).toEqual(expected);
    });

    it.each([
        ['PMHNP - WA - Remote', ['WA']],
        ['Oregon, Remote', ['OR']],
        ['TX Remote', ['TX']],
        ['PMHNP - Washington, DC - Remote', ['DC']],
        ['PMHNP - Portland, OR - Remote', ['OR']],
    ])('%s still gives exactly one state', (title, expected) => {
        expect(statesNearRemoteToken(title)).toEqual(expected);
    });
});

describe('M-04: a shortened title keeps the NP term', () => {
    const employer = 'Very Long Employer Name Health System of America';
    it.each([
        'Physician Assistant or Nurse-Practitioner, Cardiology',
        'Physician Assistant or APN, Cardiology',
        'Physician Assistant or Nurse Practitioner, Cardiology',
    ])('%s', (title) => {
        const role = cleanRoleTitle(title, { employer });
        const pageTitle = buildJobPageTitle({ roleTitle: role, employer, location: 'Springfield, IL' });
        expect(pageTitle).toMatch(/nurse[\s-]+practitioner|\bAPN\b/i);
    });
});

describe('GFJ-01: work mode reads what the posting says', () => {
    it.each([
        'This remote position does not require travel.',
        'This remote role does not require relocation.',
        'This work from home position does not require prior telehealth experience.',
        'Our remote position does not require weekends.',
        'The remote role does not include on-call duties.',
        'This remote position is not available to residents of California.',
        'This remote role is not open to candidates in New York.',
        'This remote position is not eligible for visa sponsorship.',
        'You will never feel isolated in this remote role.',
    ])('"%s" is remote', (text) => {
        expect(detectMode(text)).toBe('Remote');
    });

    it.each([
        'Remote positions are not available.',
        'The remote option is not available.',
        'None of our roles are remote.',
        'This is not currently a remote position.',
    ])('"%s" is not remote', (text) => {
        expect(detectMode(text)).not.toBe('Remote');
    });

    it.each([
        'This is not a 100% work from home role.',
        'This is not a fully telehealth position.',
        'This role is not 100% telework.',
    ])('"%s" is never read as fully remote', (text) => {
        expect(detectMode(text)).not.toBe('Remote');
    });

    const BODY =
        'Provide psychiatric evaluation and medication management for adults. Collaborate with therapists and a ' +
        'supervising psychiatrist, document visits in the EHR and take part in weekly case reviews. An active ' +
        'license and DEA registration are required. We offer paid time off and continuing education support.';
    const ingest = (title: string, location = 'Tampa, FL') =>
        normalizeJobWithReason(
            {
                title,
                company: 'Example Health',
                location,
                applyLink: 'https://boards.greenhouse.io/example/jobs/1',
                externalId: 'greenhouse-example-1',
                description: BODY,
            },
            'greenhouse',
        ).job;

    it.each([
        'Nurse Practitioner (No Remote)',
        'Nurse Practitioner - No Remote',
        'PMHNP - In-Office, No Remote',
    ])('title "%s" makes the job on site', (title) => {
        expect(ingest(title)).toMatchObject({ mode: 'In-Person', isRemote: false });
    });

    it.each([
        'Remote Nurse Practitioner - No Weekends',
        'Nurse Practitioner - Remote',
        'PMHNP - Remote, No Travel',
    ])('title "%s" stays remote', (title) => {
        expect(ingest(title)).toMatchObject({ mode: 'Remote', isRemote: true });
    });
});
