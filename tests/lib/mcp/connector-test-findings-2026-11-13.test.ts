/**
 * What a second live test of the job seeker connector turned up on
 * 2026-11-13, in the text the assistant reads and the filters it is given:
 *
 *  - easy_apply_only returned every job an employer had posted here, and
 *    nearly half of those apply on the employer's own site. It now means
 *    what a card's "Can apply from here" means, and the employers' own
 *    postings have a filter of their own (the website's "Featured" label).
 *  - A search stopped at 160 results however many matched. Every result is
 *    now on a page that can be asked for, and a page can be longer.
 *  - A search line gave a job's place with no work mode, so a hybrid role
 *    titled "Remote PMHNP" read as "Colorado", and a posting that names only
 *    the country read as a job in "United States".
 *  - A part-time posting's yearly pay ("$73k/yr") read as an hourly rate
 *    multiplied out wrongly. The line says what the figure is for.
 *  - search_articles returned eight articles and no way to the rest.
 *
 * They were found on PMHNP Hiring's connector, which NP Hiring's is built on.
 * (A sixth finding, about the guides tool, is covered by the guides tests.)
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/config/brand';

const db = vi.hoisted(() => ({
  job: { findMany: vi.fn(), findFirst: vi.fn() },
  savedJob: { findMany: vi.fn(), findUnique: vi.fn() },
}));

const blog = vi.hoisted(() => ({ posts: [] as Record<string, unknown>[], getPublishedPosts: vi.fn(), getPostBySlug: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/salary-analytics', () => ({
  getGatedLocationSalary: vi.fn(async () => ({ postings: 0, employers: 0, tier: 'none', gatePassed: false, median: null, p25: null, p75: null, medianK: null, p25K: null, p75K: null })),
  getGatedStateBenchmarks: vi.fn(async () => []),
}));
// The blog's own merged list (blog_posts, the license guides and the MDX
// posts), as lib/blog serves it: the article search reads nothing else.
vi.mock('@/lib/blog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/blog')>()),
  getPublishedPosts: blog.getPublishedPosts,
  getPostBySlug: blog.getPostBySlug,
}));

import { getJob, searchJobs } from '@/lib/mcp/tools/candidate-search';
import { searchArticles } from '@/lib/mcp/tools/candidate-content';
import { ROLE_TOKEN } from '@/lib/mcp/tools/board-words';
import { BLOG_CATEGORIES } from '@/lib/blog';
import { PLACE_NOT_LISTED, toJobCard, type JobCardRow } from '@/lib/mcp/tools/shared';
import { CANDIDATE_ENDPOINT } from '@/lib/mcp/endpoints/candidate';
import { resetBlogSearchCacheForTests } from '@/lib/blog-search';
import { resetPayCacheForTests } from '@/lib/mcp/tools/np-pay';
import { UserFacingError, type ToolContext } from '@/lib/mcp/server/types';
import type { JobsViewData, ListViewData } from '@/lib/mcp/widgets/src/contracts';

const BASE = brand.baseUrl;
/** A search's summary opens with the role token, its first letter a capital. */
const SUMMARY_ROLE = `${ROLE_TOKEN.charAt(0).toUpperCase()}${ROLE_TOKEN.slice(1)}`;
const ctx = { endpoint: 'candidate', access: null, baseUrl: BASE, ip: '203.0.113.9', requestMeta: undefined } as unknown as ToolContext;

const idOf = (n: number): string => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;

function jobRow(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: idOf(n),
    slug: `psychiatric-nurse-practitioner-${idOf(n)}`,
    title: 'Psychiatric Nurse Practitioner',
    employer: `Acme Behavioral Health ${n}`,
    location: 'Austin, TX',
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    isRemote: false,
    isHybrid: false,
    mode: 'In-Person',
    jobType: 'Full-Time',
    jobTypes: ['Full-Time'],
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
    description: 'Outpatient psychiatric care for adults.',
    descriptionSummary: null,
    benefits: [],
    setting: null,
    population: null,
    eligibleStateCodes: [],
    _count: { screeningQuestions: 0 },
    ...overrides,
  };
}

const card = (overrides: Record<string, unknown> = {}) => toJobCard(jobRow(1, overrides) as unknown as JobCardRow, BASE);

type FindManyArgs = { where?: { AND?: unknown[] } };
const pageIds = (args: FindManyArgs): string[] | undefined =>
  (args.where?.AND?.[1] as { id?: { in?: string[] } } | undefined)?.id?.in;

/** The search reads every match once (the scan), then the page's cards by id. */
function serve(table: Record<string, unknown>[]): void {
  db.job.findMany.mockImplementation(async (args: FindManyArgs) => {
    const ids = pageIds(args);
    return ids ? table.filter((row) => ids.includes(row.id as string)) : table;
  });
}

/** The listing rule the scan ran with: the first read of a search. */
const scanWhere = (): { AND?: unknown[] } => db.job.findMany.mock.calls[0][0].where;

const search = async (args: Record<string, unknown>) => {
  const outcome = await searchJobs.run(args as never, ctx);
  return { text: outcome.text, data: outcome.structured as JobsViewData, lines: outcome.text.split('\n') };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.savedJob.findMany.mockResolvedValue([]);
  db.savedJob.findUnique.mockResolvedValue(null);
  resetBlogSearchCacheForTests();
  resetPayCacheForTests();
  blog.posts = [];
  blog.getPublishedPosts.mockImplementation(async () => blog.posts);
  blog.getPostBySlug.mockResolvedValue(null);
});

// ── The two filters the website's one filter joins ───────────────────────────

describe('search_jobs easy_apply_only', () => {
  it('asks for jobs that take applications here, and nothing wider', async () => {
    serve([jobRow(1, { applyOnPlatform: true, sourceType: 'employer' })]);
    await search({ easy_apply_only: true });
    expect(scanWhere().AND!.slice(2)).toEqual([{ applyOnPlatform: true }]);
  });

  it('says what the filter is in the summary, and does not call the website\'s wider list "all results"', async () => {
    serve([jobRow(1, { applyOnPlatform: true, sourceType: 'employer' })]);
    const { text, data } = await search({ easy_apply_only: true });
    expect(data.summary).toBe(`${SUMMARY_ROLE} jobs, taking applications on ${brand.name}`);
    expect(text).not.toContain(`All results on ${brand.name}`);
    expect(text).toContain(`On ${brand.name} these are among the results at ${BASE}/jobs?`);
  });

  it('is described to the model by what it does', () => {
    const description = searchJobs.input.easy_apply_only.description ?? '';
    expect(description).toContain(`take applications on ${brand.name}`);
    expect(description).not.toMatch(/posted directly by employers/);
  });
});

describe('search_jobs employer_posted_only', () => {
  it('asks for the postings employers made here, whichever way they take applications', async () => {
    serve([jobRow(1, { sourceType: 'employer' })]);
    await search({ employer_posted_only: true });
    expect(scanWhere().AND!.slice(2)).toEqual([{ sourceType: 'employer' }]);
  });

  it('takes both filters together, and neither when neither is asked for', async () => {
    serve([jobRow(1)]);
    await search({ easy_apply_only: true, employer_posted_only: true });
    expect(scanWhere().AND!.slice(2)).toEqual([{ applyOnPlatform: true }, { sourceType: 'employer' }]);

    vi.clearAllMocks();
    db.savedJob.findMany.mockResolvedValue([]);
    serve([jobRow(1)]);
    await search({});
    expect(scanWhere().AND).toHaveLength(2);
  });

  it('says what the website\'s Featured label means, and that it is not a ranking', async () => {
    serve([jobRow(1, { sourceType: 'employer' })]);
    const { text, data } = await search({ employer_posted_only: true });
    expect(data.summary).toBe(`${SUMMARY_ROLE} jobs, posted directly by employers`);
    expect(text).toMatch(/website labels such postings "Featured", which means only that; it does not change their order/);
    expect(text).not.toMatch(/paid/);
    // The card's heading is the summary, and no card says featured.
    expect(data.summary.toLowerCase()).not.toContain('featured');
  });

  it('is the filter the model is told to use when the person asks for featured jobs', () => {
    // The input says what the filter is; when to use it is in the instructions,
    // since a tool description holds no instructions about model behavior.
    expect(searchJobs.input.employer_posted_only.description).toMatch(/the website labels "Featured", which means only that the employer posted the job here/);
    expect(CANDIDATE_ENDPOINT.instructions).toMatch(/search with employer_posted_only/);
    expect(CANDIDATE_ENDPOINT.instructions).toMatch(/nothing moves a listing up/);
  });

  it('never changes the order: both filters search in the same two orders as any other search', async () => {
    serve([jobRow(1, { sourceType: 'employer' })]);
    await search({ employer_posted_only: true, sort: 'salary' });
    expect(JSON.stringify(db.job.findMany.mock.calls[0][0].orderBy)).not.toMatch(/isFeatured|sourceType/);
  });
});

describe('a search line says who posted the job and how it is applied to', () => {
  it('marks an employer\'s own posting, on any search', async () => {
    serve([jobRow(1, { sourceType: 'employer', applyOnPlatform: false }), jobRow(2, { sourceType: 'employer', applyOnPlatform: true }), jobRow(3)]);
    const { lines } = await search({});
    expect(lines.find((line) => line.includes(idOf(1)))).toMatch(/Posted by the employer\. Applies on employer site\. id:/);
    expect(lines.find((line) => line.includes(idOf(2)))).toMatch(/Posted by the employer\. Can apply from here\. id:/);
    expect(lines.find((line) => line.includes(idOf(3)))).not.toContain('Posted by the employer');
  });

  it('get_job says the same, and what the website\'s label on it means', async () => {
    db.job.findFirst.mockResolvedValue(jobRow(1, { sourceType: 'employer' }));
    const posted = await getJob.run({ job_id: idOf(1) }, ctx);
    expect(posted.text).toContain(`Posted by: the employer, on ${brand.name} itself. The website labels such a posting "Featured", which means only that the employer posted it here.`);

    db.job.findFirst.mockResolvedValue(jobRow(1));
    const gathered = await getJob.run({ job_id: idOf(1) }, ctx);
    expect(gathered.text).not.toContain('Posted by:');
  });
});

// ── Every result can be reached ──────────────────────────────────────────────

describe('search_jobs pages', () => {
  const table = (count: number) => Array.from({ length: count }, (_, i) => jobRow(i + 1));

  it('has no page that cannot be asked for: page 21 of 400 results is there', async () => {
    serve(table(400));
    const { text, data } = await search({ page: 21 });
    expect(data.jobs).toHaveLength(8);
    expect(data.page).toBe(21);
    expect(text).toContain('Showing 161 to 168');
    expect(text).toContain('More results: call search_jobs again with page 22. There are 50 pages of 8');
    expect(text).not.toMatch(/Only the first|are available here/);
  });

  it('returns a longer page when asked, up to 25, and pages by that size', async () => {
    serve(table(60));
    const first = await search({ page_size: 25 });
    expect(first.data.jobs).toHaveLength(25);
    expect(first.data.pageSize).toBe(25);
    expect(first.text).toContain('There are 3 pages of 25.');
    // The card's "Show more" asks for the next page of the same size.
    expect(first.data.searchArgs).toMatchObject({ page: 1, page_size: 25 });

    const last = await search({ page_size: 25, page: 3 });
    expect(last.data.jobs).toHaveLength(10);
    expect(last.data.hasMore).toBe(false);
    expect(last.text).toContain('Showing 51 to 60');
    expect(last.text).toContain('That is the last page.');
    expect(last.text).not.toContain('More results');
  });

  it('puts every result on exactly one page', async () => {
    serve(table(60));
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) seen.push(...(await search({ page_size: 25, page })).data.jobs.map((job) => job.id));
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
  });

  it('answers a page past the last one as that, never as "no jobs match"', async () => {
    serve(table(20));
    await expect(searchJobs.run({ page: 9 } as never, ctx)).rejects.toThrow(/There is no page 9: this search has 3 pages of 8\. Ask for page 3 or lower\./);
    await expect(searchJobs.run({ page: 9 } as never, ctx)).rejects.toBeInstanceOf(UserFacingError);
  });

  it('accepts a page size from 5 to 25, and a page from 1 to the last there can be', () => {
    expect(searchJobs.input.page_size.safeParse(26).success).toBe(false);
    expect(searchJobs.input.page_size.safeParse(25).success).toBe(true);
    expect(searchJobs.input.page_size.safeParse(5).success).toBe(true);
    // A tiny page makes a late page cost many times the work, and a
    // signed-out caller picks both numbers.
    expect(searchJobs.input.page_size.safeParse(4).success).toBe(false);
    expect(searchJobs.input.page.safeParse(0).success).toBe(false);
    expect(searchJobs.input.page.safeParse(1000).success).toBe(true);
    expect(searchJobs.input.page.safeParse(1001).success).toBe(false);
  });

  it('still reaches everything the search reads with the smallest page and the last page', async () => {
    // 5,000 rows is all one search reads; 5 a page times 1,000 pages is 5,000.
    serve(table(5000));
    const last = await search({ page_size: 5, page: 1000 });
    expect(last.data.jobs.map((job) => job.id)).toEqual([4996, 4997, 4998, 4999, 5000].map(idOf));
    expect(last.text).toContain('That is the last page.');
  });

  it('tells the model that paging reaches everything', () => {
    expect(searchJobs.description).toMatch(/every result can be reached by paging/);
    expect(CANDIDATE_ENDPOINT.instructions).toMatch(/never say a page was everything unless the tool said it was the last one/);
  });
});

// ── Place and work mode ──────────────────────────────────────────────────────

describe('a job\'s place in a line of text', () => {
  it('carries the work mode, so a hybrid role in a state does not read as a place alone', async () => {
    serve([jobRow(1, { title: 'Remote PMHNP', location: 'Colorado', city: null, state: 'Colorado', stateCode: 'CO', isHybrid: true, mode: 'Hybrid' })]);
    const { lines } = await search({});
    expect(lines.find((line) => line.includes(idOf(1)))).toContain('Remote PMHNP, Acme Behavioral Health 1. Colorado (Hybrid).');
  });

  it('writes a fully remote job as "Remote", once', async () => {
    serve([jobRow(1, { location: 'Remote', city: null, state: null, stateCode: null, isRemote: true, mode: 'Remote' })]);
    const { lines } = await search({});
    expect(lines.find((line) => line.includes(idOf(1)))).toContain('Acme Behavioral Health 1. Remote. ');
  });

  it.each(['United States', 'US', 'USA', 'U.S.', 'united states of america'])(
    'does not print the country "%s" as if the posting had said where the job is',
    (location) => {
      const job = card({ location, city: null, state: null, stateCode: null, mode: null });
      expect(job.location).toBe(PLACE_NOT_LISTED);
      // Nothing says on site either: the role may well be remote.
      expect(job.workMode).toBeNull();
    },
  );

  it('still says hybrid for a hybrid posting that names only the country', () => {
    const job = card({ location: 'United States', city: null, state: null, stateCode: null, isHybrid: true, mode: 'Hybrid' });
    expect(job.location).toBe(PLACE_NOT_LISTED);
    expect(job.workMode).toBe('Hybrid');
  });

  it('keeps on site for a posting that names a place, and for one whose own mode says so', () => {
    expect(card({}).workMode).toBe('In-Person');
    expect(card({ location: 'United States', city: null, state: null, stateCode: null, mode: 'On-site' }).workMode).toBe('In-Person');
  });

  it('keeps the source\'s own word for a place that is neither a city and state nor a country', () => {
    expect(card({ location: 'Valley Center Tower', city: null, state: null, stateCode: null, mode: null }).location).toBe('Valley Center Tower');
    expect(card({ location: 'Roseville', city: 'Roseville', state: null, stateCode: null }).location).toBe('Roseville');
  });

  it('gives the city when that is all the posting has, whatever its location text says', () => {
    for (const location of ['', 'United States']) {
      expect(card({ location, city: 'Roseville', state: null, stateCode: null }).location).toBe('Roseville');
    }
  });
});

// ── Yearly pay on a part-time posting ────────────────────────────────────────

describe('yearly pay on a part-time posting', () => {
  const partTimeYearly = { jobType: 'Part-Time', displaySalary: '$73k/yr', normalizedMinSalary: 72_500, salaryPeriod: 'annual', minSalary: 72_500 };

  it('is said to be for that schedule, in a search line', async () => {
    serve([jobRow(1, partTimeYearly)]);
    const { lines } = await search({});
    expect(lines.find((line) => line.includes(idOf(1)))).toContain('$73k/yr (yearly pay as listed for a part-time schedule). Part-Time.');
  });

  it('is explained on the job itself, with why a median is not a like for like comparison', async () => {
    db.job.findFirst.mockResolvedValue(jobRow(1, partTimeYearly));
    const out = await getJob.run({ job_id: idOf(1) }, ctx);
    expect(out.text).toContain('Pay: $73k/yr');
    expect(out.text).toMatch(/Pay note: that is yearly pay as listed for a part-time schedule.+not like for like/);
  });

  it.each([
    ['an hourly rate on a part-time posting', { jobType: 'Part-Time', displaySalary: '$70-$90/hr', salaryPeriod: 'hourly' }],
    ['yearly pay on a full-time posting', { jobType: 'Full-Time', displaySalary: '$140k-$160k/yr', salaryPeriod: 'annual' }],
    ['a posting with no schedule', { jobType: null, displaySalary: '$73k/yr', salaryPeriod: 'annual' }],
    ['this site\'s own estimate, which already says so', { ...partTimeYearly, salaryIsEstimated: true }],
    ['a posting with no pay', { jobType: 'Part-Time' }],
  ])('says nothing extra about %s', (_name, overrides) => {
    expect(card(overrides).payNote ?? null).toBeNull();
  });

  it.each(['Part-Time', 'Per Diem', 'PRN'])('covers a %s posting', (jobType) => {
    expect(card({ ...partTimeYearly, jobType }).payNote).toBe('yearly pay as listed for a part-time schedule');
  });

  it('is in the model\'s instructions', () => {
    expect(CANDIDATE_ENDPOINT.instructions).toMatch(/yearly pay figure on a part-time posting is the figure listed for that schedule/);
  });
});

// ── Articles ─────────────────────────────────────────────────────────────────

/** A post as the blog's merged list gives it (lib/blog.ts BlogPost listing columns). */
const post = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `post-${n}`,
  slug: `article-${String(n).padStart(2, '0')}`,
  title: `Article ${n}`,
  meta_description: `About subject ${n}.`,
  category: 'salary_negotiation',
  // Newest first: a higher n is older.
  publish_date: new Date(Date.UTC(2026, 9, 31 - n)).toISOString(),
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('search_articles pages', () => {
  it('reads the page asked for and says where it sits among all the matches', async () => {
    blog.posts = Array.from({ length: 20 }, (_, i) => post(i + 1));
    const out = await searchArticles.run({ page: 2 }, ctx);

    expect(out.text).toContain('Latest articles: 9 to 16 of 20, newest first.');
    expect(out.text).toContain('9. Article 9');
    expect(out.text).toContain('More articles: call search_articles again with page 3. There are 3 pages.');
    expect((out.structured as ListViewData).subtitle).toBe('9 to 16 of 20, newest first');
  });

  it('says when a page is the last one, and when a page is past it', async () => {
    blog.posts = Array.from({ length: 20 }, (_, i) => post(i + 1));
    const last = await searchArticles.run({ page: 3 }, ctx);
    expect(last.text).toContain('17 to 20 of 20');
    expect(last.text).toContain('That is the last page.');
    expect(last.text).not.toContain('More articles');

    await expect(searchArticles.run({ page: 9 }, ctx)).rejects.toThrow(/There is no page 9: 20 articles match, which is 3 pages of 8/);
  });

  it('decides between "every word" and "any word" by how many match, not by the page', async () => {
    blog.posts = [
      ...Array.from({ length: 5 }, (_, i) => post(i + 1, { title: `Telehealth licensing ${i + 1}` })),
      post(6, { title: 'Telehealth pay' }),
      post(7, { title: 'Licensing basics' }),
    ];
    // Page 2 of a search that matched on every word holds nothing; that is
    // the end of that search, not a reason to search for any of the words.
    await expect(searchArticles.run({ query: 'telehealth licensing', page: 2 }, ctx)).rejects.toBeInstanceOf(UserFacingError);
    const first = await searchArticles.run({ query: 'telehealth licensing' }, ctx);
    expect(first.text).toContain('1 to 5 of 5');

    // No post has every word: posts with any of them come back.
    const any = await searchArticles.run({ query: 'telehealth basics' }, ctx);
    expect(any.text).toContain('1 to 7 of 7');
  });

  it('drops the words nearly every post carries', async () => {
    blog.posts = [post(1, { title: 'Negotiate your nurse practitioner salary' }), post(2, { title: 'NP interview questions' })];
    const out = await searchArticles.run({ query: 'NP nurse practitioner negotiate' }, ctx);
    expect(out.text).toContain('1 to 1 of 1');
    expect(out.text).toContain('Negotiate your nurse practitioner salary');
  });

  it('lists the sections and how many articles each holds, on the first page of the plain list only', async () => {
    const [larger, smaller] = BLOG_CATEGORIES;
    expect(smaller).toBeDefined();
    blog.posts = [
      ...Array.from({ length: 3 }, (_, i) => post(i + 1, { category: larger.id })),
      post(4, { category: smaller.id }),
      post(5, { category: 'not_a_section' }),
    ];
    const plain = await searchArticles.run({}, ctx);
    expect(plain.text).toContain(`Sections, for the topic input: ${larger.id} (${larger.label}, 3); ${smaller.id} (${smaller.label}, 1).`);

    const searched = await searchArticles.run({ query: 'subject' }, ctx);
    expect(searched.text).not.toContain('Sections');
  });

  it('reads the blog through its own merged list, and a section filter narrows it', async () => {
    blog.posts = [post(1, { category: 'salary_negotiation' }), post(2, { category: 'state_spotlight' })];
    const out = await searchArticles.run({ topic: 'state_spotlight' } as Parameters<typeof searchArticles.run>[0], ctx);
    expect(out.text).toContain('1 to 1 of 1');
    expect(out.text).toContain('Article 2');
    expect(blog.getPublishedPosts).toHaveBeenCalled();
  });

  it('tells the model there are no featured articles', () => {
    expect(searchArticles.description).toMatch(/no featured or pinned articles/);
    expect(CANDIDATE_ENDPOINT.instructions).toMatch(/The blog has no featured articles/);
  });
});
