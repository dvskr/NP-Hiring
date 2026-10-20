/**
 * The job alert digest prints the alert's own criteria ("Your Alert") as
 * HTML. Those criteria are whatever the alert was created with, and POST
 * /api/job-alerts takes no session, so anyone can create an alert under any
 * address with a keyword or location of their choosing. The box wrote them
 * into the email as given, so markup in a keyword reached an email we send
 * from our own domain. The job cards were already escaped
 * (lib/utils/render-job-card.ts); the criteria box now is too.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('resend', () => ({
    Resend: class {
        emails = { send: vi.fn() };
        batch = { send: vi.fn() };
    },
}));

import { buildAlertHtml, htmlToPlainText } from '@/lib/job-alerts-service';

const JOB = {
    id: 'job-1',
    title: 'Family Nurse Practitioner',
    employer: 'Clinic',
    location: 'Austin, TX',
    createdAt: new Date('2026-10-19T00:00:00Z'),
};

describe('job alert digest: the "Your Alert" criteria box', () => {
    it('prints the criteria escaped, so a keyword cannot carry markup into the email', () => {
        const criteria = '"</p><a href="https://evil.example">Verify your account</a>" in <b>Austin</b>';
        const html = buildAlertHtml([JOB], 'alert-token', criteria, 'https://nphiring.com/jobs');
        expect(html).not.toContain('<a href="https://evil.example">');
        expect(html).not.toContain('<b>Austin</b>');
        expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;Verify your account&lt;/a&gt;');
    });

    it('still prints plain criteria as they read', () => {
        const html = buildAlertHtml([JOB], 'alert-token', 'nurse practitioner in Austin, TX', 'https://nphiring.com/jobs');
        expect(html).toContain('nurse practitioner in Austin, TX');
    });

    it('the plain-text part reads the escaped criteria as typed', () => {
        const html = buildAlertHtml([JOB], 'alert-token', `"women's health" in Austin`, 'https://nphiring.com/jobs');
        const text = htmlToPlainText(html);
        expect(text).toContain(`"women's health" in Austin`);
        expect(text).not.toMatch(/&quot;|&#39;/);
    });
});
