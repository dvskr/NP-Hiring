/**
 * scripts/indexing-fixes/unpublish-non-us-jobs.ts: owner decision
 * 2026-09-28: NP Hiring lists US jobs only. Ingest now rejects non-US work
 * sites (normalizer_non_us_location); this script applies the same test to
 * rows already stored.
 *
 * WHAT IT DOES
 *   Runs detectNonUsWorkSite (lib/location-parser.ts), the exact ingest
 *   gate, over every PUBLISHED job: the stored country column, the location
 *   text, the title ("CRNA - (Iraq)") and work-site phrases in the
 *   description ("relocate to Iraq for the duration of the project"). With
 *   --apply each hit is unpublished with isPublished = false and
 *   isManuallyUnpublished = true (renewal can never revive it), and gets an
 *   audit_logs row (action 'indexing_fix.non_us_unpublish') naming the
 *   country and the evidence. US territories (Puerto Rico, Guam, the US
 *   Virgin Islands) are in scope and are never listed. Neither are US places
 *   and facilities named like a country: "Panama City, FL", "Jamaica
 *   Hospital", "Ireland Army Health Clinic", "China Grove, NC", a bare
 *   "Ontario" (Ontario, California), or "located in Lebanon." on a row whose
 *   location names a US state. Nor are US postings about patients or
 *   families who served abroad ("Serve veterans who deployed to Iraq",
 *   "military families stationed in Germany", "Prior deployment in Kuwait
 *   preferred") or that accept either country ("must reside in Canada or
 *   the United States"): deployment wording counts only when it is
 *   addressed to the hire ("Must be willing to deploy to Iraq"). A posting
 *   that lists the United States among its places is a US job and is never
 *   listed either (owner decision 2026-09-29): a location "United States,
 *   Canada" or "Remote (US, Canada)", or a title "Nurse Practitioner - US,
 *   Canada", even when the stored country column names the other country.
 *
 *   Only aggregated rows (sourceType 'external') are unpublished. An
 *   employer's own post is never ingested again, so nothing would bring it
 *   back: employer or direct rows the same test flags are printed under
 *   "REVIEW (employer-posted, not changed)" and never written.
 *
 * RUN ORDER: step 2 of 8 of the job-row fixes (the order and the
 *   reasons are in scripts/indexing-fixes/lib/runtime.ts RUN_ORDER).
 *
 * HOW TO RUN (a person runs this; the repo .env is the PRODUCTION database)
 *   1. Dry run. Reads only and prints every row, country and evidence:
 *        node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *          --project scripts/tsconfig.json scripts/indexing-fixes/unpublish-non-us-jobs.ts
 *      Optional: --employer="International SOS", --ids=a,b, --limit=N.
 *   2. Review, then repeat the SAME command with --apply (one guarded
 *      transaction; a row that changed since the dry run aborts the run).
 */
import { ENV_FILE } from './lib/load-env';
import { prisma } from '@/lib/prisma';
import { EMPLOYER_POSTED_SOURCE_TYPES, JOB_ROW_SELECT, nonUsWorkSite, type JobRow } from './lib/planners';
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

const SCRIPT = 'scripts/indexing-fixes/unpublish-non-us-jobs.ts';

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  printHeader(
    'Unpublish jobs whose work site is outside the United States',
    'Sets isPublished=false and isManuallyUnpublished=true on each listed row.',
    opts,
    ENV_FILE,
  );

  // Only aggregated rows are unpublished (see the header); employer-posted
  // rows are read separately and only listed.
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
    const hit = nonUsWorkSite(row);
    if (!hit) continue;
    if (opts.limit !== null && writes.length >= opts.limit) break;
    printRow(
      row,
      `UNPUBLISH (work site ${hit.country})`,
      { isPublished: { from: true, to: false }, isManuallyUnpublished: { from: row.isManuallyUnpublished, to: true } },
      [`evidence ${hit.evidence}: "${hit.matched}"`],
      { unpublishedAt: 'now' },
    );
    writes.push({
      id: row.id,
      guard: { isPublished: true },
      data: { isPublished: false, isManuallyUnpublished: true, unpublishedAt: new Date() },
      audit: {
        action: 'indexing_fix.non_us_unpublish',
        metadata: { country: hit.country, evidence: hit.evidence, matched: hit.matched, script: SCRIPT },
      },
    });
  }

  const review = employerRows.flatMap((row) => {
    const hit = nonUsWorkSite(row);
    return hit ? [`${row.id} | ${row.sourceType} | work site ${hit.country} (${hit.evidence}: "${hit.matched}") | ${jobUrl(row)}`] : [];
  });
  if (review.length > 0) {
    console.log('');
    console.log(`REVIEW (employer-posted, not changed): ${review.length} row(s) the non-US test flags`);
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
