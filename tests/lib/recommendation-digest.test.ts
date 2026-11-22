/**
 * The weekly recommendation digest.
 *
 * It was hand-rolled HTML with no brand header, no legal entity or postal
 * address (CAN-SPAM), no viewport meta, no lang and no preheader. It renders
 * through the shared V2 shell and the shared job card now.
 *
 * sendAndLog has no opt-out gate, so the roster query is what honours an
 * opt-out: it excludes suppressed leads (every opt-out path sets
 * is_suppressed) and, as the engine's roster does, leads marked unsubscribed
 * any other way (is_subscribed = false).
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/config/brand';
import {
  buildRecommendationDigestHtml,
  recommendationDigestHeadline,
  type RecommendationDigestJob,
} from '@/lib/email/recommendation-digest-template';

const BASE = 'https://fixture.invalid';
const TOKEN = 'leadtokfic0000000000004';

const captured = vi.hoisted(() => ({
  queries: [] as string[],
  sends: [] as Array<{ to: string; subject: string; html: string }>,
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: { createFunction: (config: unknown, handler: unknown) => ({ config, handler }) },
}));
vi.mock('@/lib/ai/feature-flags', () => ({ isAiFeatureEnabled: async () => true }));
vi.mock('@/lib/env', () => ({ getBaseUrl: () => 'https://fixture.invalid' }));
vi.mock('@/lib/email-service', () => ({
  sendAndLog: vi.fn(async (params: { to: string; subject: string; html: string }) => {
    captured.sends.push(params);
    return { data: { id: 'email-fixture' }, error: null };
  }),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      captured.queries.push(sql);
      return [{ supabase_id: 'cand-fixture-1', email: 'casey@fixture.invalid', first_name: 'Casey', unsubscribe_token: 'leadtokfic0000000000004' }];
    }),
    candidateRecommendation: {
      findMany: vi.fn(async () => [
        {
          id: 'rec-fixture-1',
          tier: 'easy_apply',
          job: { id: 'j1', title: 'Family Nurse Practitioner', slug: 'family-np-j1', employer: 'Example Community Health', location: 'Austin, TX', state: 'TX', isRemote: false, displaySalary: '$120k to $140k' },
        },
      ]),
    },
  },
}));

const JOBS: RecommendationDigestJob[] = [
  { id: 'j1', title: 'Family NP <b>& Telehealth</b>', slug: 'family-np-j1', employer: 'Example Community Health', location: 'Austin, TX', state: 'TX', isRemote: false, displaySalary: '$120k to $140k', tier: 'easy_apply' },
  { id: 'j2', title: 'Remote Nurse Practitioner', slug: null, employer: 'Example Telehealth', location: null, state: null, isRemote: true, displaySalary: null, tier: 'external' },
];

/** Visible text: markup and the head's style block dropped, entities decoded. */
function textOf(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&zwnj;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const hrefsOf = (html: string): string[] => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

const html = buildRecommendationDigestHtml({ firstName: 'Casey', jobs: JOBS, unsubscribeToken: TOKEN, baseUrl: BASE });
const text = textOf(html);
const hrefs = hrefsOf(html);

describe('the digest carries what every marketing mail must', () => {
  it('names the legal entity and its postal address', () => {
    expect(text).toContain(brand.legal.entityName);
    expect(text).toContain(brand.legal.address);
  });

  it('has an unsubscribe link bound to the recipient', () => {
    // The footer links the deployment's own address (NEXT_PUBLIC_BASE_URL or
    // brand.baseUrl), as every other mail's footer does.
    expect(hrefs.some((href) => /^https?:\/\//.test(href) && new URL(href).pathname === '/unsubscribe' && new URL(href).searchParams.get('token') === TOKEN)).toBe(true);
  });

  it('reflows on phones and declares its language', () => {
    expect(html).toMatch(/<meta name="viewport"/);
    expect(html).toMatch(/<html lang="en"/);
  });

  it('has its own preheader', () => {
    expect(text).toContain('Picked from your latest recommendations, Easy Apply first.');
  });

  it('wears the brand header', () => {
    expect(text).toContain(brand.name);
  });
});

describe('the digest content', () => {
  it('lists every role with a link to its page', () => {
    expect(hrefs).toContain(`${BASE}/jobs/family-np-j1`);
    expect(hrefs).toContain(`${BASE}/jobs/j2`);
  });

  it('escapes listing text', () => {
    expect(html).not.toContain('<b>');
    expect(text).toContain('Family NP <b>& Telehealth</b>');
  });

  it('heads with the count, in agreement with the noun', () => {
    expect(recommendationDigestHeadline(1)).toBe('1 new role matches your profile');
    expect(recommendationDigestHeadline(5)).toBe('5 new roles match your profile');
    expect(text).toContain('2 new roles match your profile');
  });

  it('offers no dead unsubscribe link without a token', () => {
    const bare = buildRecommendationDigestHtml({ firstName: null, jobs: JOBS, unsubscribeToken: null, baseUrl: BASE });
    expect(bare).not.toMatch(/\/unsubscribe\?token=/);
    expect(textOf(bare)).toContain('Hi there,');
  });

  it('keeps a trailing slash of the base URL out of the links', () => {
    const slashed = buildRecommendationDigestHtml({ firstName: null, jobs: JOBS, unsubscribeToken: TOKEN, baseUrl: `${BASE}/` });
    expect(hrefsOf(slashed)).toContain(`${BASE}/jobs/family-np-j1`);
    expect(slashed).not.toContain('invalid//jobs');
  });
});

describe('the weekly run', () => {
  beforeEach(() => {
    captured.queries.length = 0;
    captured.sends.length = 0;
  });

  async function runDigest(): Promise<void> {
    const { recommendationDigestWeekly } = await import('@/lib/inngest/functions/recommendation-digest');
    const fn = recommendationDigestWeekly as unknown as {
      handler: (ctx: { step: { run: <T>(id: string, body: () => Promise<T>) => Promise<T> } }) => Promise<unknown>;
    };
    await fn.handler({ step: { run: async (_id, body) => body() } });
  }

  it('asks only for candidates who are neither suppressed nor unsubscribed', async () => {
    await runDigest();
    const roster = captured.queries.find((sql) => /FROM user_profiles/.test(sql)) ?? '';
    expect(roster).toMatch(/el\.is_subscribed\s*=\s*true/);
    expect(roster).toMatch(/el\.is_suppressed\s*=\s*false/);
  });

  it('mails the shell digest with a subject that agrees with its count', async () => {
    await runDigest();
    expect(captured.sends).toHaveLength(1);
    const [mail] = captured.sends;
    expect(mail.subject).toBe('1 new role matches your profile');
    expect(textOf(mail.html)).toContain(brand.legal.address);
    expect(hrefsOf(mail.html)).toContain('https://fixture.invalid/jobs/family-np-j1');
  });
});
