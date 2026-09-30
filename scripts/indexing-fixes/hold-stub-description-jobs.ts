/**
 * scripts/indexing-fixes/hold-stub-description-jobs.ts: indexing audit
 * GFJ-04.
 *
 * WHAT IT DOES
 *   Finds PUBLISHED jobs whose description is a stub, using the exact ingest
 *   test (analyzeDescriptionStub in lib/job-normalizer.ts): the title plus
 *   "Employer: / Department: / Employment: / Location:" metadata with less
 *   than 300 characters of prose, or under 80 characters of prose at all.
 *   The known case is Televero Health (BambooHR): "PMHNP, Remote TX Part
 *   Time, Up to 90 an Hour / Employer: Televero Health / ... / Location:
 *   United States", 137 characters, published as a full JobPosting.
 *
 *   With --apply each stub is HELD: isPublished = false, with
 *   isManuallyUnpublished left FALSE on purpose. The BambooHR adapter now
 *   reads the full posting from the detail endpoint, and the next ingest
 *   that finds this opening replaces the stub (the renewal delta takes a
 *   longer description) and re-publishes the row by itself. A stub whose
 *   source never supplies a full description simply ages out. Each held row
 *   gets an audit_logs row (action 'indexing_fix.stub_hold').
 *
 *   Only aggregated rows (sourceType 'external') are held. An employer's
 *   own post is never ingested again, so nothing would re-publish it, and
 *   its one-line HTML makes every short post look like a stub: employer or
 *   direct rows the same test flags are printed under "REVIEW
 *   (employer-posted, not changed)" and never written.
 *
 * RUN ORDER: step 3 of 8 of the job-row fixes (the order and the
 *   reasons are in scripts/indexing-fixes/lib/runtime.ts RUN_ORDER).
 *
 * HOW TO RUN (a person runs this; the repo .env is the PRODUCTION database)
 *   1. Dry run. Reads only and prints each row with its prose length:
 *        node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *          --project scripts/tsconfig.json scripts/indexing-fixes/hold-stub-description-jobs.ts
 *      Optional: --employer="Televero Health", --ids=a,b, --limit=N.
 *   2. Review, then repeat the SAME command with --apply (one guarded
 *      transaction; a row that changed since the dry run aborts the run).
 */
import { ENV_FILE } from './lib/load-env';
import { prisma } from '@/lib/prisma';
import { analyzeDescriptionStub } from '@/lib/job-normalizer';
import { EMPLOYER_POSTED_SOURCE_TYPES, JOB_ROW_SELECT, type JobRow } from './lib/planners';
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

const SCRIPT = 'scripts/indexing-fixes/hold-stub-description-jobs.ts';

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  printHeader(
    'Hold jobs whose description is a stub',
    'Sets isPublished=false (isManuallyUnpublished stays false, so a full description revives the row).',
    opts,
    ENV_FILE,
  );

  // Only aggregated rows are held (see the header); employer-posted rows are
  // read separately and only listed.
  const rows = (await prisma.job.findMany({
    where: { isPublished: true, sourceType: 'external', ...rowFilter(opts) },
    select: JOB_ROW_SELECT,
    orderBy: [{ employer: 'asc' }, { createdAt: 'asc' }],
  })) as JobRow[];
  const employerRows = (await prisma.job.findMany({
    where: { isPublished: true, sourceType: { in: [...EMPLOYER_POSTED_SOURCE_TYPES] }, ...rowFilter(opts) },
    select: JOB_ROW_SELECT,
    orderBy: [{ employer: 'asc' }, { createdAt: 'asc' }],
  })) as JobRow[];
  console.log(`Read ${rows.length} published aggregated row(s) and ${employerRows.length} employer-posted row(s) (listed only).`);

  const writes: PlannedWrite[] = [];
  for (const row of rows) {
    const stub = analyzeDescriptionStub(row.description, row.title);
    if (!stub.isStub) continue;
    if (opts.limit !== null && writes.length >= opts.limit) break;
    printRow(
      row,
      'HOLD (stub description)',
      { isPublished: { from: true, to: false } },
      [
        `prose ${stub.proseLength} chars, ${stub.metadataLines} metadata line(s), ${stub.titleLines} title line(s)`,
        `description: ${JSON.stringify((row.description ?? '').slice(0, 200))}`,
      ],
    );
    writes.push({
      id: row.id,
      guard: { isPublished: true },
      data: { isPublished: false },
      audit: {
        action: 'indexing_fix.stub_hold',
        metadata: { proseLength: stub.proseLength, metadataLines: stub.metadataLines, script: SCRIPT },
      },
    });
  }

  const review = employerRows.flatMap((row) => {
    const stub = analyzeDescriptionStub(row.description, row.title);
    return stub.isStub ? [`${row.id} | ${row.sourceType} | prose ${stub.proseLength} chars | ${jobUrl(row)}`] : [];
  });
  if (review.length > 0) {
    console.log('');
    console.log(`REVIEW (employer-posted, not changed): ${review.length} row(s) the stub test flags`);
    for (const line of review) console.log(`  ${line}`);
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
