/**
 * scripts/indexing-fixes/collapse-duplicate-jobs.ts: indexing audit CQ-10 /
 * GFJ-09, plan fixSoon 8.
 *
 * WHAT IT DOES
 *   Groups PUBLISHED jobs that are the same posting stored more than once:
 *   same employer, same normalized title, same work site (the city and
 *   state the fixed parser reads from the location text; for remote and
 *   state-level postings, the state and remote flag) and the same
 *   description text word for word. In each group the OLDEST row is kept
 *   (its URL has been live longest; an employer-posted row outranks age, see
 *   below) and, with --apply, every other row is
 *   unpublished with isPublished = false and isManuallyUnpublished = true,
 *   with an audit_logs row (action 'indexing_fix.duplicate_collapse')
 *   naming the row it duplicates. The middleware then answers 410 for the
 *   copies and they leave the job sitemap.
 *
 *   Genuine per-city requisitions are never grouped: they differ in work
 *   site (Thriveworks "VA - Norfolk", "VA - Williamsburg", ... are 13
 *   separate requisitions). Rows with the same employer, title and text at
 *   DIFFERENT sites (the BlueSky Telepsych pair filed as "North Carolina,
 *   United States" and "United States- Remote") are printed under REVIEW
 *   and never changed; decide those by hand in the admin screen.
 *
 *   An employer-posted row (sourceType 'employer' or 'direct') is never
 *   unpublished: it is a paying customer's job and is never ingested again,
 *   so nothing would bring it back. A group with one employer-posted row
 *   keeps THAT row, whatever its age, and unpublishes only the aggregated
 *   copies; a group with two or more is printed under REVIEW and never
 *   changed (planDuplicateGroups in lib/planners.ts).
 *
 *   Ingest now applies the same identity (lib/deduplicator.ts), so new
 *   copies are renewed onto the existing row instead of inserted.
 *
 * RUN ORDER: step 6 of 8 of the job-row fixes (the order and the
 *   reasons are in scripts/indexing-fixes/lib/runtime.ts RUN_ORDER).
 *
 * HOW TO RUN (a person runs this; the repo .env is the PRODUCTION database)
 *   1. Dry run. Reads only and prints every group, the row kept and the
 *      rows to unpublish:
 *        node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *          --project scripts/tsconfig.json scripts/indexing-fixes/collapse-duplicate-jobs.ts
 *      Optional: --employer="LifeStance Health", --limit=N (groups).
 *   2. Review, then repeat the SAME command with --apply (one guarded
 *      transaction; a row that changed since the dry run aborts the run).
 */
import { ENV_FILE } from './lib/load-env';
import { prisma } from '@/lib/prisma';
import { JOB_ROW_SELECT, isEmployerPosted, planDuplicateGroups, type JobRow } from './lib/planners';
import {
  parseCli,
  rowFilter,
  printHeader,
  printRow,
  printFooter,
  applyPlannedWrites,
  jobUrl,
  type PlannedWrite,
} from './lib/runtime';

const SCRIPT = 'scripts/indexing-fixes/collapse-duplicate-jobs.ts';

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  printHeader(
    'Collapse exact duplicate jobs (fixSoon 8)',
    'Keeps the oldest row of each group, or its one employer-posted row; sets isPublished=false and isManuallyUnpublished=true on the rest.',
    opts,
    ENV_FILE,
  );

  const rows = (await prisma.job.findMany({
    where: { isPublished: true, ...rowFilter(opts) },
    select: JOB_ROW_SELECT,
    orderBy: [{ employer: 'asc' }, { createdAt: 'asc' }],
  })) as JobRow[];
  console.log(`Read ${rows.length} published row(s).`);

  const plan = planDuplicateGroups(rows);
  const writes: PlannedWrite[] = [];
  let groupsShown = 0;
  for (const group of plan.groups) {
    if (opts.limit !== null && groupsShown >= opts.limit) break;
    groupsShown++;
    console.log('');
    const keptBy = isEmployerPosted(group.keep) ? `employer-posted (${group.keep.sourceType})` : 'oldest';
    console.log(`GROUP ${groupsShown}: ${group.remove.length + 1} rows; keeping ${group.keep.id}, ${keptBy} (${jobUrl(group.keep)})`);
    for (const row of group.remove) {
      printRow(
        row,
        `UNPUBLISH (duplicate of ${group.keep.id})`,
        { isPublished: { from: true, to: false }, isManuallyUnpublished: { from: row.isManuallyUnpublished, to: true } },
        [`created ${row.createdAt.toISOString()}; kept row created ${group.keep.createdAt.toISOString()}`],
        { unpublishedAt: 'now' },
      );
      writes.push({
        id: row.id,
        guard: { isPublished: true },
        data: { isPublished: false, isManuallyUnpublished: true, unpublishedAt: new Date() },
        audit: {
          action: 'indexing_fix.duplicate_collapse',
          metadata: { duplicateOf: group.keep.id, script: SCRIPT },
        },
      });
    }
  }

  if (plan.review.length > 0) {
    console.log('');
    console.log(
      'REVIEW ONLY (same employer, title and text at different sites, or two or more employer-posted rows; not changed): ' +
      `${plan.review.length} set(s)`,
    );
    for (const set of plan.review) {
      console.log('');
      for (const row of set) {
        console.log(`  ${row.id} | ${row.sourceType ?? 'no source type'} | ${JSON.stringify(row.location)} | created ${row.createdAt.toISOString()} | ${jobUrl(row)}`);
      }
    }
  }

  if (opts.apply) await applyPlannedWrites(prisma, writes);
  printFooter(opts, writes.length, SCRIPT);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
