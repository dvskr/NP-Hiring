/**
 * The employer hiring report names applications only when there are some.
 *
 * Most applicants apply on the employer's own site, which the apply clicks
 * count, so a report that says "0 applications" beside real clicks reads as a
 * failure it is not. With no applications the report shows views and apply
 * clicks alone: in the figures, the preview line and the subject. The subject
 * carries no emoji.
 *
 * The REAL email service runs (the global setup mocks it); Resend is mocked to
 * capture what would be sent. Every address and name is fictional.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.unmock('@/lib/email-service');

const { resendSendMock } = vi.hoisted(() => ({ resendSendMock: vi.fn() }));
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: resendSendMock } })),
}));

import { prisma } from '@/lib/prisma';

const TO = 'reader@northfield.example';
const LEAD_TOKEN = 'lead-unsub-token-report';

interface Sent {
  subject: string;
  html: string;
}

function lastSent(): Sent {
  expect(resendSendMock).toHaveBeenCalled();
  return resendSendMock.mock.calls.at(-1)![0] as Sent;
}

/** The width of each figure block in the stats row, in order. */
function statWidths(html: string): string[] {
  return [...html.matchAll(/<td width="(\d+%)" style="padding:16px 12px;/g)].map((m) => m[1]);
}

function job(views: number, applyClicks: number, applications: number) {
  return { title: 'Outpatient Role (Fictional Fixture)', views, applyClicks, applications, dashboardToken: 'dash-fic' };
}

// The first import of the real email service is a cold transform of its
// whole module graph; pay for it once, in a hook with its own budget.
beforeAll(async () => {
  await import('@/lib/email-service');
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  resendSendMock.mockResolvedValue({ data: { id: 'resend-msg-report' }, error: null });
  vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: LEAD_TOKEN } as never);
  vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
});

describe('the hiring report with no applications', () => {
  const jobs = [job(120, 9, 0), job(30, 2, 0)];

  it('shows views and apply clicks only, sharing the row', async () => {
    const { sendPerformanceReportEmail } = await import('@/lib/email-service');
    const result = await sendPerformanceReportEmail(TO, 'Northfield Example Group', jobs, 'Monthly');
    const { html } = lastSent();

    expect(result.success).toBe(true);
    expect(html).toContain('>150<');
    expect(html).toContain('>11<');
    expect(html).toContain('Views');
    expect(html).toContain('Apply Clicks');
    expect(html).not.toContain('>Applications<');
    expect(statWidths(html)).toEqual(['50%', '50%']);
  });

  it('leaves applications out of the preview line and puts apply clicks in the subject', async () => {
    const { sendPerformanceReportEmail } = await import('@/lib/email-service');
    await sendPerformanceReportEmail(TO, 'Northfield Example Group', jobs, 'Monthly');
    const { html, subject } = lastSent();

    expect(html).toContain('Your monthly report: 150 views, 11 clicks');
    expect(html).not.toContain('11 clicks, 0 applications');
    expect(subject).toBe('Monthly Report for Northfield Example Group: 150 views, 11 apply clicks');
  });
});

describe('the hiring report with applications', () => {
  const jobs = [job(120, 9, 3), job(30, 2, 0)];

  it('adds the applications figure as a third block and keeps it in the subject', async () => {
    const { sendPerformanceReportEmail } = await import('@/lib/email-service');
    await sendPerformanceReportEmail(TO, 'Northfield Example Group', jobs, 'Monthly');
    const { html, subject } = lastSent();

    expect(html).toContain('>Applications<');
    expect(html).toContain('>3<');
    expect(statWidths(html)).toEqual(['33%', '33%', '33%']);
    expect(html).toContain('Your monthly report: 150 views, 11 clicks, 3 applications');
    expect(subject).toBe('Monthly Report for Northfield Example Group: 150 views, 3 applications');
  });

  it('starts the subject with words, not an emoji', async () => {
    const { sendPerformanceReportEmail } = await import('@/lib/email-service');
    await sendPerformanceReportEmail(TO, 'Northfield Example Group', jobs, 'Monthly');

    expect(lastSent().subject).toMatch(/^[A-Za-z]/);
    expect(lastSent().subject).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
