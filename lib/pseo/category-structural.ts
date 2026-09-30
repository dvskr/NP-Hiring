/**
 * lib/pseo/category-structural.ts
 *
 * The structured-field half of the category predicates (indexing audit
 * CQ-05, CQ-14, fixSoon 11). Remote, telehealth and the job-type categories
 * are decided by columns (isRemote, isHybrid, jobType) and the title, never
 * by description keywords, and every rule here comes as a pair: a JS test
 * the ingest tagger runs on one job, and the Prisma clause the pages, the
 * aggregate-pseo cron and the sitemaps count with. The pairs are written
 * from the same constants, and tests/unit/category-predicate.test.ts runs
 * both over the same fixtures, so a stored tag and a live count cannot
 * disagree.
 *
 * Why structural: a description keyword sweep tagged "Hybrid role, 1 to 2
 * days remotely", "remote patient monitoring" and "Full-time employees
 * qualify for benefits" as remote or full-time, so /jobs/remote/utah listed
 * three hybrid jobs and part-time jobs vanished from /jobs/part-time pages.
 *
 * A leaf module (Prisma types only), imported by category-tagger.ts.
 */
import type { Prisma } from '@prisma/client';

/* ─── Work mode ──────────────────────────────────────────────────────────── */

/**
 * Fully remote by the structured work mode: remote and not hybrid. The same
 * test JobPosting uses for jobLocationType TELECOMMUTE
 * (components/JobStructuredData.tsx) and the strict setting x state gate
 * uses (lib/pseo/setting-state-index.ts).
 */
export const FULLY_REMOTE_WHERE: Prisma.JobWhereInput = { isRemote: true, isHybrid: false };

/** JS twin of FULLY_REMOTE_WHERE. */
export function isFullyRemote(row: { isRemote?: boolean | null; isHybrid?: boolean | null }): boolean {
  return row.isRemote === true && row.isHybrid !== true;
}

/* ─── Title keywords ─────────────────────────────────────────────────────── */

/**
 * JS title test with the tagger's padding convention: the title is padded
 * with one leading and one trailing space, so a space-anchored keyword
 * (' prn', ' cns ') also matches at the start or end of the title.
 */
export function titleHasKeyword(title: string | null | undefined, keywords: readonly string[]): boolean {
  const haystack = ` ${(title ?? '').toLowerCase()} `;
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

/**
 * Prisma twin of titleHasKeyword: a leading space in a keyword also matches
 * at the start of the title, a trailing space at the end, so the clause
 * matches exactly the titles the padded JS test matches.
 */
export function titleKeywordWhere(keywords: readonly string[]): Prisma.JobWhereInput {
  const insensitive = 'insensitive' as const;
  const clauses = keywords.flatMap((keyword): Prisma.JobWhereInput[] => {
    const lead = keyword.startsWith(' ');
    const trail = keyword.endsWith(' ');
    const inner = keyword.trim();
    const out: Prisma.JobWhereInput[] = [{ title: { contains: keyword, mode: insensitive } }];
    if (lead && trail) {
      out.push({ title: { startsWith: `${inner} `, mode: insensitive } });
      out.push({ title: { endsWith: ` ${inner}`, mode: insensitive } });
      out.push({ title: { equals: inner, mode: insensitive } });
    } else if (lead) {
      out.push({ title: { startsWith: inner, mode: insensitive } });
    } else if (trail) {
      out.push({ title: { endsWith: inner, mode: insensitive } });
    }
    return out;
  });
  return { OR: clauses };
}

/* ─── Job type ───────────────────────────────────────────────────────────── */

export const JOB_TYPE_CATEGORY_SLUGS = ['full-time', 'part-time', 'contract', 'per-diem', 'locum-tenens'] as const;
export type JobTypeCategory = (typeof JOB_TYPE_CATEGORY_SLUGS)[number];

export function isJobTypeCategory(slug: string): slug is JobTypeCategory {
  return (JOB_TYPE_CATEGORY_SLUGS as readonly string[]).includes(slug);
}

/** The mutually exclusive employment types (locum tenens can sit beside any of them). */
const EXCLUSIVE_JOB_TYPES = ['full-time', 'part-time', 'contract', 'per-diem'] as const;

/**
 * Title keywords per job type. For the four exclusive types they are read
 * only when the job carries no jobType; the employer's or the source's
 * structured value always wins (a Part-Time job whose benefits text says
 * "full-time employees qualify" stays part-time). Locum tenens keywords are
 * read from the title whatever the jobType, because an agency locum role is
 * usually typed Contract.
 */
export const JOB_TYPE_TITLE_KEYWORDS: Readonly<Record<JobTypeCategory, readonly string[]>> = {
  'full-time': ['full-time', 'full time'],
  'part-time': ['part-time', 'part time'],
  contract: ['contract position', 'temp-to-perm', 'temporary assignment'],
  // 'PRN' stays anchored: a bare 'prn' is a substring of 'APRN'.
  'per-diem': ['per diem', 'per-diem', ' prn', '(prn', '/prn', '-prn'],
  'locum-tenens': ['locum tenens', 'locums'],
};

type ValueTest = { op: 'contains' | 'equals'; value: string };

/**
 * How a stored jobType value maps to a category: the FIRST row whose test
 * matches wins, so "Full-Time/Part-Time" is full-time, as before. Canonical
 * values (lib/job-normalizer.ts canonicalizeJobType) are Full-Time,
 * Part-Time, Contract, Per Diem, PRN, Locum Tenens and Internship; any other
 * set value (Internship) maps to no category.
 */
const JOB_TYPE_VALUE_ORDER: ReadonlyArray<{ slug: JobTypeCategory; tests: readonly ValueTest[] }> = [
  { slug: 'full-time', tests: [{ op: 'contains', value: 'full' }] },
  { slug: 'part-time', tests: [{ op: 'contains', value: 'part' }] },
  {
    slug: 'per-diem',
    tests: [
      { op: 'contains', value: 'per diem' },
      { op: 'contains', value: 'per-diem' },
      { op: 'equals', value: 'prn' },
    ],
  },
  { slug: 'locum-tenens', tests: [{ op: 'contains', value: 'locum' }] },
  { slug: 'contract', tests: [{ op: 'contains', value: 'contract' }] },
];

function valueTestMatches(value: string, test: ValueTest): boolean {
  return test.op === 'equals' ? value === test.value : value.includes(test.value);
}

/**
 * The category a jobType value maps to: undefined when the job carries no
 * jobType (blank), null when it carries one that names no category.
 */
export function jobTypeValueCategory(jobType: string | null | undefined): JobTypeCategory | null | undefined {
  const value = (jobType ?? '').trim().toLowerCase();
  if (!value) return undefined;
  const hit = JOB_TYPE_VALUE_ORDER.find((row) => row.tests.some((test) => valueTestMatches(value, test)));
  return hit ? hit.slug : null;
}

/** The job-type categories of one job (the tagger's rule; header rules above). */
export function jobTypeCategoriesOf(job: { jobType?: string | null; title?: string | null }): Set<JobTypeCategory> {
  const out = new Set<JobTypeCategory>();
  const fromValue = jobTypeValueCategory(job.jobType);
  if (fromValue === undefined) {
    for (const slug of EXCLUSIVE_JOB_TYPES) {
      if (titleHasKeyword(job.title, JOB_TYPE_TITLE_KEYWORDS[slug])) out.add(slug);
    }
    // "Full Time or Part Time": the full-time reading wins, as it always has.
    if (out.has('full-time')) out.delete('part-time');
  } else if (fromValue) {
    out.add(fromValue);
  }
  if (titleHasKeyword(job.title, JOB_TYPE_TITLE_KEYWORDS['locum-tenens'])) out.add('locum-tenens');
  return out;
}

function valueTestWhere(test: ValueTest): Prisma.JobWhereInput {
  return { jobType: { [test.op]: test.value, mode: 'insensitive' } } as Prisma.JobWhereInput;
}

/** Prisma: the stored jobType value maps to `slug` (first match in JOB_TYPE_VALUE_ORDER). */
function jobTypeValueWhere(slug: JobTypeCategory): Prisma.JobWhereInput {
  const index = JOB_TYPE_VALUE_ORDER.findIndex((row) => row.slug === slug);
  const own = JOB_TYPE_VALUE_ORDER[index];
  const earlier = JOB_TYPE_VALUE_ORDER.slice(0, index);
  return {
    AND: [
      { OR: own.tests.map(valueTestWhere) },
      ...earlier.map((row): Prisma.JobWhereInput => ({ NOT: { OR: row.tests.map(valueTestWhere) } })),
    ],
  };
}

/** Prisma: the job carries no jobType. */
const JOB_TYPE_UNSET: Prisma.JobWhereInput = { OR: [{ jobType: null }, { jobType: { equals: '' } }] };

/** Prisma twin of `jobTypeCategoriesOf(job).has(slug)`. */
export function jobTypeCategoryWhere(slug: JobTypeCategory): Prisma.JobWhereInput {
  if (slug === 'locum-tenens') {
    return { OR: [jobTypeValueWhere(slug), titleKeywordWhere(JOB_TYPE_TITLE_KEYWORDS[slug])] };
  }
  const fromTitle: Prisma.JobWhereInput[] = [JOB_TYPE_UNSET, titleKeywordWhere(JOB_TYPE_TITLE_KEYWORDS[slug])];
  if (slug === 'part-time') fromTitle.push({ NOT: titleKeywordWhere(JOB_TYPE_TITLE_KEYWORDS['full-time']) });
  return { OR: [jobTypeValueWhere(slug), { AND: fromTitle }] };
}

/* ─── Description boilerplate ────────────────────────────────────────────── */

/**
 * Sentences of equal-opportunity, accommodation and legal boilerplate. A
 * description match must never fire on them: "without regard to ... gender
 * identity ... protected veteran status" is in nearly every posting and said
 * nothing about the role (the audit's LGBTQ+ and veterans false positives).
 */
const EEO_SENTENCE_RE =
  /equal (?:employment )?opportunit|\beeo\b|affirmative action|without regard to|protected veteran|veteran status|sexual orientation|gender identity|national origin|genetic information|reasonable accommodation|e-verify|pay transparency|drug[- ]free workplace|know your rights/i;

/** The description with its EEO and legal boilerplate sentences removed. */
export function stripEeoBoilerplate(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/([.!?])\s+/g, '$1\n')
    .split(/\n+/)
    .filter((sentence) => !EEO_SENTENCE_RE.test(sentence))
    .join(' ');
}
