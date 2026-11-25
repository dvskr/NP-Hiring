/**
 * Hunt 2026-11-11, second wave (INGEST reviewer note, routed through
 * JOBDETAIL): `looksLikeHtml` called a body HTML when a "<" and a letter
 * appeared anywhere before a ">" anywhere later. The ingest cleaner keeps
 * comparison signs in plain text when another "<" sits between them
 * ("patients <age 18 ... caseload <20 ... visits >45 min"), so such a body
 * was read as markup: the job page and JobStructuredData passed it on as
 * HTML, and the sanitizer and the email restyler dropped the words between
 * the signs as one tag. The sniff now uses the cleaner's own tag shape, so
 * whatever the cleaner leaves as text is read as text.
 */
import { describe, it, expect } from 'vitest';
import { looksLikeHtml } from '@/lib/jd-blocks';
import { cleanDescription } from '@/lib/description-cleaner';

const PLAIN_WITH_SIGNS = 'We see patients <age 18 only with a guardian; caseload <20 a day; visits >45 min are billed as extended.';

describe('looksLikeHtml agrees with the ingest cleaner on what a tag is', () => {
    it.each([
        ['a comparison sign before a word and another after it', PLAIN_WITH_SIGNS],
        ['caseload limits', 'Caseload <20 patients a day, visits >5 min'],
        ['a pay ceiling', 'Pay <$150k negotiable > benefits'],
        ['a heart', 'We <3 our team'],
        ['a cleaned aggregator body', 'ABOUT THE ROLE\n\n• Medication management\n• Telehealth'],
        ['an empty body', ''],
    ])('plain text: %s', (_name, text) => {
        expect(looksLikeHtml(text)).toBe(false);
    });

    it.each([
        ['a paragraph', '<p>Adult outpatient panel.</p>'],
        ['a list', '<ul><li>Telehealth</li></ul>'],
        ['a self-closing break', 'Line one<br/>Line two'],
        ['a tag with attributes', '<div class="role">Panel</div>'],
        ['upper-case tags', '<P>Panel</P>'],
        ['a closing tag alone', 'Panel</strong>'],
    ])('markup: %s', (_name, text) => {
        expect(looksLikeHtml(text)).toBe(true);
    });

    it('whatever the cleaner leaves behind is never read as markup', () => {
        // Greenhouse sends its HTML entity-escaped, signs included.
        const escaped = PLAIN_WITH_SIGNS.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const cleaned = cleanDescription(`<p>${escaped}</p><ul><li>Caseload &lt;20</li></ul>`);
        expect(cleaned).toContain('<age 18 only with a guardian; caseload <20 a day; visits >45 min');
        expect(looksLikeHtml(cleaned)).toBe(false);
    });
});

/**
 * Markup in the shapes each source sends (invented content, real structure),
 * and the employer editor's output. Each is markup; what the ingest cleaner
 * makes of it is plain text, and the sniff must agree with both.
 */
const SOURCE_MARKUP: Array<[string, string]> = [
    ['Greenhouse content, decoded', '<div class="content-intro"><p><strong>About Acme Health</strong></p></div><h3>What you will do</h3><ul><li>Run intake evaluations</li><li>Caseload &lt;20 a day</li></ul>'],
    ['Lever description', '<div><b>Who we are</b></div><div><br></div><div>Outpatient clinic.</div><ul><li>Telehealth two days a week</li></ul>'],
    ['Workday jobDescription', '<p><b>Job Description</b></p><p><span style="font-size:11pt">Clinical lead, adult outpatient.</span></p><ul><li><p>Medication management</p></li></ul>'],
    ['Ashby descriptionHtml', '<h2>The role</h2><p>Join our team.</p><h2>Requirements</h2><ul><li><p>Board certification</p></li></ul>'],
    ['SmartRecruiters sections', '<p>Company description</p><br /><p>We see adults and adolescents.</p>'],
    ['Workable description', '<p><strong>Benefits</strong></p><ul><li>401(k)</li></ul>'],
    ['BambooHR and JazzHR', '<p style="margin:0"><span>Full time, Monday to Friday.</span></p>'],
    ['Word paste with conditional comments', '<!--[if gte mso 9]><xml><o:OfficeDocumentSettings></o:OfficeDocumentSettings></xml><![endif]--><p class=MsoNormal>Panel of adults.</p>'],
    ['the employer editor (Quill)', '<p>We are hiring.</p><ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>Medication management</li></ol><p><br></p>'],
];

describe('every source shape: the markup reads as HTML, the cleaned body as text', () => {
    it.each(SOURCE_MARKUP)('%s', (_source, markup) => {
        expect(looksLikeHtml(markup)).toBe(true);
        const cleaned = cleanDescription(markup);
        expect(cleaned.length).toBeGreaterThan(0);
        expect(looksLikeHtml(cleaned)).toBe(false);
    });

    it.each([
        ['an Adzuna snippet', 'Clinician needed for a busy outpatient clinic. Competitive pay, caseload <18 per day...'],
        ['a USAJobs summary', 'Serves as a staff clinician at the VA medical center. Patients aged 18->65.'],
        ['ranges written with signs', 'Visits <=30 min; productivity >=12 patients; 1:1 supervision <2 hrs a week'],
    ])('plain text from %s stays text', (_source, text) => {
        expect(looksLikeHtml(text)).toBe(false);
    });
});
