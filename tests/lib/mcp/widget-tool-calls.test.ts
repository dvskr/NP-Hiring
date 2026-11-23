/**
 * The cards call tools by name. A name no endpoint serves fails only when a
 * person presses that button, so every name the card code calls must be a
 * tool the connector lists. When save_job's removal moved to unsave_job
 * (2026-11-22, OpenAI's directory scan), the Save button had to move with it.
 *
 * The employer connector is not in this engine yet, while its cards are in
 * the bundle (views/employer.ts) and call its tools by name. Those names are
 * listed here exactly, so a card that starts calling any other tool no
 * endpoint serves still fails, and the list is checked against that
 * connector's tools when it lands.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { readCode } from '../../helpers/source';
import { CANDIDATE_ENDPOINT } from '@/lib/mcp/endpoints/candidate';

const served = new Set(CANDIDATE_ENDPOINT.tools.map((tool) => tool.name));
const called = [...readCode('lib/mcp/widgets/src/app.ts').matchAll(/(?:call|callTool)\(\s*'([a-z_]+)'/g)].map((m) => m[1]);

/** What the employer cards call: the employer connector's tools, which this engine does not serve yet. */
const EMPLOYER_CARD_CALLS = ['get_posting_status', 'list_applicants', 'publish_job_posting', 'update_applicant_status'];

describe('the tools the cards call', () => {
  it('are all served by the job seeker connector, apart from the employer cards\' own', () => {
    expect(called.length).toBeGreaterThan(5);
    expect(called.filter((name) => !served.has(name) && !EMPLOYER_CARD_CALLS.includes(name))).toEqual([]);
  });

  it('leave unserved only the employer cards\' calls, and no job seeker tool among them', () => {
    expect([...new Set(called.filter((name) => !served.has(name)))].sort()).toEqual(EMPLOYER_CARD_CALLS);
  });

  it('remove a saved job with unsave_job, which the job seeker connector serves', () => {
    expect(called).toContain('unsave_job');
    expect(CANDIDATE_ENDPOINT.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['save_job', 'unsave_job']));
  });
});
