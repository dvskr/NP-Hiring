/**
 * scripts/indexing-fixes/retag-category-tags.ts: indexing audit CQ-05 and
 * CQ-14. Re-runs the fixed category tagger (lib/pseo/category-tagger.ts
 * classifyJobTags) over stored jobs and rewrites Job.categoryTags where the
 * stored tags differ.
 *
 * WHY
 *   The old tagger read description keywords: "Hybrid role, 1 to 2 days
 *   remotely" and "remote patient monitoring" tagged remote, "Full-time
 *   employees qualify for benefits" tagged full-time (and stripped the
 *   part-time tag), and EEO text ("gender identity", "protected veterans")
 *   tagged LGBTQ+ and veterans. The pages already count remote, telehealth,
 *   the job types and new grad from structured fields at query time, so
 *   they are right without this script. The stored tags still feed the
 *   keyword categories, the category tallies for untagged-column reads,
 *   lib/reports/queries.ts and any consumer that reads categoryTags
 *   directly; this script brings them in line.
 *
 * WHAT IT DOES
 *   Reads every PUBLISHED job (add --include-unpublished for all rows),
 *   classifies it with every input the tagger reads (title, description,
 *   jobType, isRemote, isHybrid, the employer-declared setting and
 *   population, newGradFriendly, minYearsExperience and the employer name)
 *   and prints each row whose tags would change, with the tags added and
 *   removed. With
 *   --apply every change is written in ONE transaction, each update guarded
 *   by the tags it was planned from (a row that changed since the dry run
 *   aborts the whole run), with an audit_logs row per job (action
 *   'indexing_fix.category_retag').
 *
 * AFTER --apply
 *   Run the aggregate-pseo cron so PseoStats (the category-landing and
 *   setting x state verdicts the sitemaps read) is recomputed.
 *
 * RUN ORDER: step 8 of 8 of the job-row fixes (the order and the
 *   reasons are in scripts/indexing-fixes/lib/runtime.ts RUN_ORDER).
 *
 * HOW TO RUN (a person runs this; the repo .env is the PRODUCTION database)
 *   1. Dry run. Reads only and prints every planned change:
 *        node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *          --project scripts/tsconfig.json scripts/indexing-fixes/retag-category-tags.ts
 *      Optional: --employer="LifeStance", --ids=a,b, --limit=N,
 *      --include-unpublished.
 *   2. Review, then repeat the SAME command with --apply.
 */
import { ENV_FILE } from './lib/load-env';
import { prisma } from '@/lib/prisma';
import { classifyJobTags } from '@/lib/pseo/category-tagger';
import type { JobRow } from './lib/planners';
import {
  parseCli,
  rowFilter,
  printHeader,
  printRow,
  printFooter,
  applyPlannedWrites,
  type PlannedWrite,
} from './lib/runtime';

const SCRIPT = 'scripts/indexing-fixes/retag-category-tags.ts';

/** The stored columns the classifier and the printout read. */
const RETAG_SELECT = {
  id: true,
  slug: true,
  title: true,
  employer: true,
  location: true,
  isPublished: true,
  description: true,
  descriptionSummary: true,
  jobType: true,
  isRemote: true,
  isHybrid: true,
  setting: true,
  population: true,
  newGradFriendly: true,
  minYearsExperience: true,
  categoryTags: true,
} as const;

interface RetagRow {
  id: string;
  slug: string | null;
  title: string;
  employer: string;
  location: string;
  isPublished: boolean;
  description: string;
  descriptionSummary: string | null;
  jobType: string | null;
  isRemote: boolean;
  isHybrid: boolean;
  setting: string | null;
  population: string | null;
  newGradFriendly: boolean;
  minYearsExperience: number | null;
  categoryTags: string[];
}

/** The tags the fixed classifier gives a stored row. */
function plannedTags(row: RetagRow): string[] {
  return classifyJobTags({
    title: row.title,
    description: row.description,
    descriptionSummary: row.descriptionSummary,
    jobType: row.jobType,
    isRemote: row.isRemote,
    isHybrid: row.isHybrid,
    setting: row.setting,
    population: row.population,
    newGradFriendly: row.newGradFriendly,
    minYearsExperience: row.minYearsExperience,
    employer: row.employer,
  });
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opts = parseCli(argv);
  const includeUnpublished = argv.includes('--include-unpublished');
  printHeader(
    'Re-tag Job.categoryTags with the fixed category tagger (CQ-05)',
    'Rewrites categoryTags where the stored tags differ from what the tagger now returns.',
    opts,
    ENV_FILE,
  );

  const rows = (await prisma.job.findMany({
    where: { ...(includeUnpublished ? {} : { isPublished: true }), ...rowFilter(opts) },
    select: RETAG_SELECT,
    orderBy: [{ employer: 'asc' }, { createdAt: 'asc' }],
  })) as RetagRow[];
  console.log(`Read ${rows.length} ${includeUnpublished ? '' : 'published '}row(s).`);

  const writes: PlannedWrite[] = [];
  const added = new Map<string, number>();
  const removed = new Map<string, number>();
  for (const row of rows) {
    const next = plannedTags(row);
    if (sameTags(row.categoryTags, next)) continue;
    if (opts.limit !== null && writes.length >= opts.limit) break;
    const plus = next.filter((tag) => !row.categoryTags.includes(tag));
    const minus = row.categoryTags.filter((tag) => !next.includes(tag));
    for (const tag of plus) added.set(tag, (added.get(tag) ?? 0) + 1);
    for (const tag of minus) removed.set(tag, (removed.get(tag) ?? 0) + 1);
    printRow(
      row as unknown as JobRow,
      'RETAG',
      { categoryTags: { from: row.categoryTags.join(', '), to: next.join(', ') } },
      [`added: ${plus.join(', ') || 'none'}`, `removed: ${minus.join(', ') || 'none'}`],
    );
    writes.push({
      id: row.id,
      guard: { categoryTags: { equals: row.categoryTags } },
      data: { categoryTags: next },
      audit: {
        action: 'indexing_fix.category_retag',
        metadata: { from: row.categoryTags, to: next, added: plus, removed: minus, script: SCRIPT },
      },
    });
  }

  const summary = (label: string, counts: Map<string, number>) => {
    const parts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    console.log(`${label}: ${parts.length === 0 ? 'none' : parts.map(([tag, n]) => `${tag} ${n}`).join(', ')}`);
  };
  console.log('');
  summary('Tags added', added);
  summary('Tags removed', removed);

  if (opts.apply) await applyPlannedWrites(prisma, writes);
  printFooter(opts, writes.length, SCRIPT);
  if (opts.apply && writes.length > 0) {
    console.log('Next: run the aggregate-pseo cron so PseoStats and the sitemaps pick up the new tags.');
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
