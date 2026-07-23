/**
 * Regression guards for the email-service content fixes
 * (2026-07-18 med/low backlog wave — B70, B21, V3).
 *
 * B70 — the candidate-alert digest previously discarded every candidate
 *        detail it was built with; the email must now render them.
 * B21 — sendDraftSavedEmail was a dead export and is deleted; pin its
 *        absence so it doesn't get resurrected by a template merge.
 * V3  — employer transactional emails deep-linked the deprecated token
 *        dashboard (/employer/dashboard/[token] → unconditional login
 *        redirect); all links must point at the real dashboard.
 *
 * The global setup mocks @/lib/email-service, so we unmock it here to
 * exercise the REAL implementation (same pattern as
 * candidate-alerts-suppression.test.ts). Resend is mocked to capture HTML.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.unmock('@/lib/email-service');

const resendSendMock = vi.fn().mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: resendSendMock },
    batch: { send: vi.fn().mockResolvedValue({ data: [], error: null }) },
  })),
}));

import { prisma } from '@/lib/prisma';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CANDIDATES = [
  {
    name: 'Alice B.',
    headline: 'FNP with <script>alert(1)</script> tag',
    profileUrl: 'https://example.com/employer/candidates/uuid-1',
    specialties: ['Primary Care', 'Telehealth'],
    states: ['TX', 'CO'],
    experience: 4,
  },
  {
    name: 'Carol D.',
    headline: null,
    profileUrl: 'https://example.com/employer/candidates/uuid-2',
    specialties: [],
    states: ['NY'],
    experience: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  resendSendMock.mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
  // not suppressed; existing unsubscribe token
  vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({
    isSuppressed: false,
    unsubscribeToken: 'tok-abc-123',
  } as never);
  vi.mocked(prisma.userProfile.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
});

describe('B70 — candidate-alert digest threads candidate details into the email', () => {
  // 15s timeout: first dynamic import of the very large email-service module
  // can blow vitest's 5s default under a loaded parallel run.
  it('renders name, headline, specialties, states, experience, and profile link', async () => {
    const { sendNewCandidateAlertEmail } = await import('@/lib/email-service');
    const result = await sendNewCandidateAlertEmail('employer@example.com', 'Acme Clinic', CANDIDATES as never);

    expect(result.success).toBe(true);
    expect(resendSendMock).toHaveBeenCalledOnce();
    const sendArg = resendSendMock.mock.calls[0][0] as { html: string; subject: string };

    expect(sendArg.html).toContain('Alice B.');
    expect(sendArg.html).toContain('Carol D.');
    expect(sendArg.html).toContain('Primary Care, Telehealth');
    expect(sendArg.html).toContain('Licensed: TX, CO');
    expect(sendArg.html).toContain('4 yrs experience');
    expect(sendArg.html).toContain('https://example.com/employer/candidates/uuid-1');
    expect(sendArg.html).toContain('https://example.com/employer/candidates/uuid-2');
    // count threads through header + subject
    expect(sendArg.html).toContain('2 New Candidate Matches');
    expect(sendArg.subject).toContain('2 new candidates');
  }, 15_000);

  it('escapes user-supplied profile content (no raw <script> in the HTML)', async () => {
    const { sendNewCandidateAlertEmail } = await import('@/lib/email-service');
    await sendNewCandidateAlertEmail('employer@example.com', 'Acme Clinic', CANDIDATES as never);

    const sendArg = resendSendMock.mock.calls[0][0] as { html: string };
    expect(sendArg.html).not.toContain('<script>alert(1)</script>');
    expect(sendArg.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  }, 15_000);
});

describe('B21 — sendDraftSavedEmail stays deleted', () => {
  it('lib/email-service.ts no longer exports sendDraftSavedEmail or the draft_saved type', () => {
    const s = read('lib/email-service.ts');
    expect(s).not.toMatch(/export async function sendDraftSavedEmail/);
    expect(s).not.toMatch(/\|\s*'draft_saved'/);
  });

  it('no production code imports sendDraftSavedEmail', () => {
    // walk the source trees a consumer could live in
    const dirs = ['app', 'components', 'lib', 'scripts', 'config'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const rel = path.relative(ROOT, full).replace(/\\/g, '/');
          // the definition file keeps a tombstone comment naming the export
          if (rel === 'lib/email-service.ts') continue;
          if (fs.readFileSync(full, 'utf8').includes('sendDraftSavedEmail')) {
            offenders.push(rel);
          }
        }
      }
    };
    for (const d of dirs) {
      const abs = path.join(ROOT, d);
      if (fs.existsSync(abs)) walk(abs);
    }
    expect(offenders).toEqual([]);
  });
});

describe('V3 — employer emails link the real dashboard, not the deprecated token dashboard', () => {
  it('lib/email-service.ts contains no /employer/dashboard/${token} deep links', () => {
    const s = read('lib/email-service.ts');
    // template-literal interpolation directly after the dashboard path is the
    // deprecated token form
    expect(s).not.toMatch(/\/employer\/dashboard\/\$\{/);
    // the plain dashboard link is still present
    expect(s).toContain('/employer/dashboard`');
  });
});
