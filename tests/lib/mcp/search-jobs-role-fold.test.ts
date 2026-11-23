/**
 * search_jobs folds an employer's repeat postings of one role into one
 * result, and does not let one employer fill a page.
 *
 * A live test of the connector returned eight results that were one
 * telehealth role, posted once for each state. Every page of the default
 * search was that employer until its copies ran out. The role is now one
 * result that says how many postings and places it stands for, which
 * posting its id is, and how to get the posting for another place. An
 * employer whose roles differ a little from city to city is not folded, so a
 * page also takes no more than two results from one employer while others
 * have results.
 *
 * The database is a fake that applies the tool's own selects to full rows.
 * The board's name and role words are the active pack's. Every name is
 * fictional.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { brand } from '@/config/brand';
import { escapeRegExp, useTestBoard } from '../../helpers/mcp-board';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  job: { findMany: vi.fn(), count: vi.fn() },
  savedJob: { findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { searchJobs } from '@/lib/mcp/tools/candidate-search';
import { ROLE_TOKEN } from '@/lib/mcp/tools/board-words';
import type { ToolContext } from '@/lib/mcp/server/types';
import type { JobsViewData } from '@/lib/mcp/widgets/src/contracts';
import { renderJobs } from '@/lib/mcp/widgets/src/views/jobs';

const ctx = {
  endpoint: 'candidate',
  access: null,
  baseUrl: brand.baseUrl,
  ip: '203.0.113.9',
  requestMeta: undefined,
} as unknown as ToolContext;

/** The search's summary opens a line with the role token, its first letter a capital. */
const SUMMARY = `${ROLE_TOKEN.charAt(0).toUpperCase()}${ROLE_TOKEN.slice(1)}`;

/** The start of the text when nothing matches: the role in its prose form, a work mode before it in lower case. */
const noOpen = (before: string): RegExp => new RegExp(`^No open ${escapeRegExp(before)}`);

beforeAll(() => {
  useTestBoard();
});

let seq = 0;
function job(overrides: Row = {}): Row {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    slug: `psychiatric-nurse-practitioner-${id}`,
    title: 'Psychiatric Nurse Practitioner',
    employer: `Example Clinic ${seq}`,
    location: 'Austin, TX',
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    isRemote: false,
    isHybrid: false,
    mode: 'In-Person',
    jobType: 'Full-Time',
    displaySalary: null,
    normalizedMinSalary: null,
    normalizedMaxSalary: null,
    salaryRange: null,
    salaryPeriod: null,
    minSalary: null,
    maxSalary: null,
    salaryIsEstimated: false,
    sourceType: 'external',
    originalPostedAt: null,
    createdAt: new Date('2026-11-12T00:00:00Z'),
    experienceLabel: null,
    newGradFriendly: false,
    applyOnPlatform: false,
    isVerifiedEmployer: false,
    ...overrides,
  };
}

const STATES: Array<[string, string]> = [
  ['West Virginia', 'WV'], ['Washington', 'WA'], ['Wisconsin', 'WI'], ['Utah', 'UT'], ['Vermont', 'VT'],
  ['Tennessee', 'TN'], ['Texas', 'TX'], ['Rhode Island', 'RI'], ['Ohio', 'OH'], ['Oregon', 'OR'],
  ['Nevada', 'NV'], ['Maine', 'ME'], ['Iowa', 'IA'], ['Idaho', 'ID'],
];
const telehealthCopy = ([state, stateCode]: [string, string]): Row =>
  job({
    title: `Staff Psychiatric Nurse Practitioner, Remote | Telehealth | ${state}`,
    employer: 'Northwind Telepsych',
    location: `Remote, ${state}`,
    city: null,
    state,
    stateCode,
    isRemote: true,
    mode: 'Remote',
    displaySalary: '$150k-$300k/yr',
    normalizedMinSalary: 150_000,
    normalizedMaxSalary: 300_000,
    salaryPeriod: 'annual',
  });

interface ReadArgs {
  select: Row;
  where?: { AND?: [unknown, { id?: { in?: string[] } }] };
  orderBy?: unknown;
  skip?: number;
  take?: number;
}
const idsAsked = (args: ReadArgs): string[] | undefined => args.where?.AND?.[1]?.id?.in;

let table: Row[];

/** The fake database: the scan returns every row, the page read returns the rows asked for by id. */
function serve(rows: Row[]): void {
  table = rows;
  db.job.findMany.mockImplementation(async (args: ReadArgs) => {
    const ids = idsAsked(args);
    const matched = ids ? table.filter((r) => ids.includes(r.id as string)) : table.slice(0, args.take ?? table.length);
    return matched.map((r) => Object.fromEntries(Object.keys(args.select).filter((k) => args.select[k]).map((k) => [k, r[k]])));
  });
}

async function search(args: Record<string, unknown> = {}): Promise<{ text: string; data: JobsViewData }> {
  const out = await searchJobs.run(args as never, ctx);
  return { text: out.text, data: out.structured as JobsViewData };
}

const NOW = Date.parse('2026-11-12T12:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  db.savedJob.findMany.mockResolvedValue([]);
});

describe('one role posted once for each state', () => {
  beforeEach(() => {
    serve([...STATES.map(telehealthCopy), job({ employer: 'Birch Clinic' }), job({ employer: 'Cedar Health', city: 'Dayton', state: 'Ohio', stateCode: 'OH' })]);
  });

  it('is one result, and the page goes on to the next employers', async () => {
    const { data } = await search();
    expect(data.jobs.map((j) => j.employer)).toEqual(['Northwind Telepsych', 'Birch Clinic', 'Cedar Health']);
    expect(data.total).toBe(3);
    expect(data.postings).toBe(16);
    expect(data.hasMore).toBe(false);
    expect(data.postingsCapped).toBe(false);
  });

  it('says how many postings and places the result stands for, and which posting its id is', async () => {
    const { data, text } = await search();
    const [folded, single] = data.jobs;
    expect(folded.id).toBe(table[0].id);
    // The title no longer names one state while standing for fourteen.
    expect(folded.title).toBe('Staff Psychiatric Nurse Practitioner, Remote | Telehealth');
    expect(folded.alsoPosted).toMatchObject({ postings: 14, placeCount: 14, ownPlace: 'West Virginia' });
    expect(folded.alsoPosted!.places).toHaveLength(12);
    expect(folded.alsoPosted!.places.slice(0, 3)).toEqual(['Idaho', 'Iowa', 'Maine']);
    expect(single.alsoPosted).toBeUndefined();

    expect(text).toContain('16 open postings across 3 roles');
    const line = text.split('\n').find((l) => l.startsWith('1. '))!;
    expect(line).toContain(`id: ${table[0].id}`);
    expect(line).toContain('Posted 14 times across 14 places: Idaho, Iowa, Maine');
    expect(line).toContain('and 2 more');
    expect(line).toContain('This id is the West Virginia posting');
    expect(line).toContain('job_location');
  });

  it('gives a state\'s own posting when the search names the state', async () => {
    // The website and the connector filter in the database; here the fake
    // returns what that filter would: the one Ohio copy and the Ohio clinic.
    serve(table.filter((r) => r.state === 'Ohio'));
    const { data, text } = await search({ job_location: 'Ohio' });
    expect(data.jobs.map((j) => j.title)).toEqual([
      'Staff Psychiatric Nurse Practitioner, Remote | Telehealth | Ohio',
      'Psychiatric Nurse Practitioner',
    ]);
    expect(data.jobs[0].alsoPosted).toBeUndefined();
    expect(text).toContain('2 open.');
    expect(text).not.toContain('across');
  });

  it('reads the page with two statements and never a count', async () => {
    await search();
    expect(db.job.count).not.toHaveBeenCalled();
    expect(db.job.findMany).toHaveBeenCalledTimes(2);
    const [scan, page] = db.job.findMany.mock.calls.map((call) => call[0] as ReadArgs);
    // The scan reads only what folding needs, in the search's own order.
    expect(Object.keys(scan.select).sort()).toEqual(
      ['city', 'employer', 'id', 'isHybrid', 'isRemote', 'jobType', 'normalizedMaxSalary', 'normalizedMinSalary', 'sourceType', 'state', 'stateCode', 'title'].sort(),
    );
    expect(scan.orderBy).toBeDefined();
    expect(scan.skip).toBeUndefined();
    // The cards are read for this page's results only, under the same listing rule as the scan.
    expect(idsAsked(page)).toEqual([table[0].id, table[14].id, table[15].id]);
    expect(page.where!.AND![0]).toEqual(scan.where);
  });

  it('shows the folded result on its card', async () => {
    const { data } = await search();
    const html = renderJobs(data, { busy: null, now: NOW }).__safe;
    expect(html).toContain('14 postings in 14 places: Idaho, Iowa, Maine and 11 more');
    expect(html).toContain(`16 open jobs on ${brand.name}`);
  });

  it('leaves out a posting that closed between the two reads', async () => {
    const closed = table[14].id;
    db.job.findMany.mockImplementation(async (args: ReadArgs) => {
      const ids = idsAsked(args);
      const matched = ids ? table.filter((r) => ids.includes(r.id as string) && r.id !== closed) : table;
      return matched.map((r) => Object.fromEntries(Object.keys(args.select).filter((k) => args.select[k]).map((k) => [k, r[k]])));
    });
    const { data, text } = await search();
    expect(data.jobs.map((j) => j.employer)).toEqual(['Northwind Telepsych', 'Cedar Health']);
    expect(text).toContain('Showing 1 to 2');
  });
});

describe('the same role posted more than once in one place', () => {
  it('says so without offering another place', async () => {
    const clinic = () => job({ employer: 'Birch Clinic', city: 'Austin', state: 'Texas', stateCode: 'TX' });
    serve([clinic(), clinic(), clinic()]);
    const { data, text } = await search();
    expect(data.jobs).toHaveLength(1);
    const line = text.split('\n').find((l) => l.startsWith('1. '))!;
    expect(line).toMatch(/Posted 3 times in Austin, TX\.$/);
    expect(line).not.toContain('job_location');
    expect(renderJobs(data, { busy: null, now: NOW }).__safe).toContain('3 postings in 1 place: Austin, TX');
  });
});

describe('an employer with many different roles', () => {
  it('has no more than two results on a page while other employers have results', async () => {
    // Six roles of one employer, newest, then four other employers.
    const roles = ['Adult', 'Child and Adolescent', 'Geriatric', 'Addiction', 'Inpatient', 'Crisis'].map((focus) =>
      job({ employer: 'Northwind Telepsych', title: `Psychiatric Nurse Practitioner, ${focus}` }),
    );
    const others = Array.from({ length: 4 }, () => job());
    serve([...roles, ...others]);

    const first = await search();
    expect(first.data.jobs.map((j) => j.employer)).toEqual([
      'Northwind Telepsych', 'Northwind Telepsych',
      others[0].employer, others[1].employer, others[2].employer, others[3].employer,
      // Nothing else is left, so the page is filled with what was held back.
      'Northwind Telepsych', 'Northwind Telepsych',
    ]);
    expect(first.data.jobs.slice(0, 2).map((j) => j.title)).toEqual(['Psychiatric Nurse Practitioner, Adult', 'Psychiatric Nurse Practitioner, Child and Adolescent']);
    expect(first.data).toMatchObject({ total: 10, hasMore: true });
    // The order is no longer the sort alone, and the text beside the results says so.
    expect(first.text.split('\n')[0]).toBe(`${SUMMARY} jobs: 10 open. Showing 1 to 8, newest first, with no more than 2 results from one employer on a page.`);

    const second = await search({ page: 2 });
    expect(second.data.jobs.map((j) => j.title)).toEqual(['Psychiatric Nurse Practitioner, Inpatient', 'Psychiatric Nurse Practitioner, Crisis']);
    expect(second.data.hasMore).toBe(false);
  });

  it('pages through one employer as usual when the search is only that employer', async () => {
    serve(Array.from({ length: 11 }, (_, i) => job({ employer: 'Northwind Telepsych', title: `Psychiatric Nurse Practitioner, Clinic ${i + 1}` })));
    const first = await search({ query: 'Northwind' });
    expect(first.data.jobs).toHaveLength(8);
    expect(first.data.jobs[0].title).toBe('Psychiatric Nurse Practitioner, Clinic 1');
    expect((await search({ query: 'Northwind', page: 2 })).data.jobs).toHaveLength(3);
  });

  it('says in the tool description that a page holds an employer to two results', () => {
    expect(searchJobs.description).toMatch(/no more than two results from one employer on a page/);
  });
});

describe('paging over folded results', () => {
  it('pages by result, not by posting', async () => {
    // Twenty employers, each posting one role in three cities, newest first.
    const rows = Array.from({ length: 20 }, (_, i) =>
      ['Akron', 'Dayton', 'Toledo'].map((city) => job({ employer: `Clinic ${String(i + 1).padStart(2, '0')}`, city, state: 'Ohio', stateCode: 'OH' })),
    ).flat();
    serve(rows);

    const first = await search();
    expect(first.data.jobs.map((j) => j.employer)).toEqual(['Clinic 01', 'Clinic 02', 'Clinic 03', 'Clinic 04', 'Clinic 05', 'Clinic 06', 'Clinic 07', 'Clinic 08']);
    expect(first.data).toMatchObject({ total: 20, postings: 60, hasMore: true });
    expect(first.text).toContain('60 open postings across 20 roles. Showing 1 to 8');
    expect(first.text).toContain('More results: call search_jobs again with page 2.');

    const third = await search({ page: 3 });
    expect(third.data.jobs.map((j) => j.employer)).toEqual(['Clinic 17', 'Clinic 18', 'Clinic 19', 'Clinic 20']);
    expect(third.data.hasMore).toBe(false);
    expect(third.text).toContain('Showing 17 to 20');
    expect(third.text).not.toContain('More results');
  });
});

describe('a search that matches more postings than are read', () => {
  it('says the counts are the least there are, and how to reach the rest', async () => {
    // The scan asks for its limit and gets that many back: there may be more.
    serve(Array.from({ length: 5200 }, () => job()));
    const { data, text } = await search();
    const scan = db.job.findMany.mock.calls[0][0] as ReadArgs;
    expect(scan.take).toBe(5000);
    expect(data).toMatchObject({ postings: 5000, postingsCapped: true });
    expect(text).toContain('5,000 or more open');
    expect(text).toContain('More than 5,000 postings match, and only the first 5,000 are searched here.');
    expect(renderJobs(data, { busy: null, now: NOW }).__safe).toContain(`5,000 or more open jobs on ${brand.name}`);
  });
});

describe('a search with no repeat postings', () => {
  it('reads as it always has', async () => {
    serve([job(), job(), job()]);
    const { data, text } = await search();
    expect(data).toMatchObject({ total: 3, postings: 3 });
    expect(data.jobs.every((j) => j.alsoPosted === undefined)).toBe(true);
    expect(text.split('\n')[0]).toBe(`${SUMMARY} jobs: 3 open. Showing 1 to 3, newest first.`);
    expect(text).not.toContain('Posted');
    expect(text).not.toContain('More than');
  });

  it('says so when nothing matches, without a second read', async () => {
    serve([]);
    const { data, text } = await search({ query: 'zebra' });
    expect(data.jobs).toEqual([]);
    expect(text).toMatch(noOpen(`${ROLE_TOKEN} jobs matching "zebra" right now`));
    expect(db.job.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps the role\'s own capitals in that sentence, and drops a work mode\'s', async () => {
    serve([]);
    expect((await search()).text).toMatch(noOpen(`${ROLE_TOKEN} jobs right now`));
    expect((await search({ work_mode: ['remote'] })).text).toMatch(noOpen(`remote ${ROLE_TOKEN} jobs right now`));
  });
});
