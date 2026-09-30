/**
 * scripts/indexing-fixes/unpublish-misrepresented-jobs.ts: indexing audit
 * plan item FB-3 (findings CQ-02, GFJ-09).
 *
 * WHAT IT DOES
 *   Finds PUBLISHED jobs whose page or JobPosting markup shows a location or
 *   pay the employer did not state, and (with --apply) unpublishes them with
 *   isPublished = false AND isManuallyUnpublished = true, so the ingest
 *   renewal path cannot revive them. The middleware then answers 410 and
 *   they leave /api/sitemaps/jobs/*. Reasons, each printed per row:
 *     non_us_work_site           the work site is outside the US ("CRNA -
 *                                (Iraq)" filed under Phoenix, Baltimore,
 *                                Philadelphia, Minneapolis)
 *     wrong_state                the location text does not name the stored
 *                                state at all ("1730 Rhode Island Ave NW,
 *                                Washington, DC" filed as state RI: Rhode
 *                                Island is only the street). A posting that
 *                                lists several places ("Kansas City, MO;
 *                                Overland Park, KS") is never wrong for
 *                                storing one of them.
 *     address_or_number_city     the stored city is a bare street number
 *                                ("1730"), or an address beside a wrong state
 *     pay_not_stated_by_employer the stored RAW pay is an old clamp value
 *                                ("$30k" header, 48000 baseSalary) and the
 *                                figure re-read from the posting differs
 *                                ("Compensation $140,000 - $228,400+", or no
 *                                figure at all)
 *   NOT listed here, because the page shows true if messy data, which
 *   correct-location-and-pay.ts fixes in place without unpublishing:
 *     - a street address stored as the city in the right state ("5100
 *       Buckeyestown Pike Suite 200 Frederick", MD; "4401 Wornall Rd Kansas
 *       City", MO);
 *     - a raw figure that is the employer's own and only LOOKS like a clamp
 *       bound (MedElite's "$30,000 - $90,000"), or a real figure whose
 *       normalized columns were clamped (a $40,000 to $44,000 posting stored
 *       as $48,000 normalized).
 *   Each unpublished row gets an audit_logs row (action
 *   'indexing_fix.fb3_unpublish') listing its reasons.
 *
 *   Only aggregated rows (sourceType 'external') are unpublished. An
 *   employer's own post is never ingested again, so nothing would bring it
 *   back: employer or direct rows the same test flags are printed under
 *   "REVIEW (employer-posted, not changed)" and never written.
 *
 * AFTER THE PARSER FIX IS DEPLOYED
 *   Run correct-location-and-pay.ts. It corrects these rows with the fixed
 *   parser and re-publishes the ones this script held (it finds them by the
 *   audit rows), except non-US rows, which stay unpublished for good (owner
 *   decision: US jobs only).
 *
 * RUN ORDER: step 1 of 8 of the job-row fixes (the order and the
 *   reasons are in scripts/indexing-fixes/lib/runtime.ts RUN_ORDER).
 *
 * HOW TO RUN (a person runs this; the repo .env is the PRODUCTION database)
 *   1. Dry run. Reads only and prints every row and reason:
 *        node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *          --project scripts/tsconfig.json scripts/indexing-fixes/unpublish-misrepresented-jobs.ts
 *      Narrow it with --employer="Sol Mental Health", --ids=a,b,c,
 *      --only=non_us_work_site,wrong_state,address_or_number_city,pay_not_stated_by_employer
 *      or --limit=N.
 *   2. Review the printed rows. Then repeat the SAME command with --apply.
 *      Every write happens in one transaction, guarded so that a row that
 *      changed since the dry run aborts the whole run with nothing written.
 */
import { ENV_FILE } from './lib/load-env';
import { prisma } from '@/lib/prisma';
import { EMPLOYER_POSTED_SOURCE_TYPES, JOB_ROW_SELECT, planFb3, type JobRow } from './lib/planners';
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

const SCRIPT = 'scripts/indexing-fixes/unpublish-misrepresented-jobs.ts';

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  printHeader(
    'FB-3: unpublish jobs that show a false location or pay',
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
  const byReason = new Map<string, number>();
  for (const row of rows) {
    const plan = planFb3(row);
    if (!plan) continue;
    const reasons = opts.only ? plan.reasons.filter((r) => opts.only!.includes(r)) : plan.reasons;
    if (reasons.length === 0) continue;
    if (opts.limit !== null && writes.length >= opts.limit) break;
    for (const r of reasons) byReason.set(r, (byReason.get(r) ?? 0) + 1);
    printRow(
      row,
      `UNPUBLISH (${reasons.join(', ')})`,
      { isPublished: { from: true, to: false }, isManuallyUnpublished: { from: row.isManuallyUnpublished, to: true } },
      plan.notes,
      { unpublishedAt: 'now' },
    );
    writes.push({
      id: row.id,
      guard: { isPublished: true },
      data: { isPublished: false, isManuallyUnpublished: true, unpublishedAt: new Date() },
      audit: {
        action: 'indexing_fix.fb3_unpublish',
        metadata: { reasons, notes: plan.notes, script: SCRIPT },
      },
    });
  }

  const review = employerRows.flatMap((row) => {
    const plan = planFb3(row);
    const reasons = plan ? (opts.only ? plan.reasons.filter((r) => opts.only!.includes(r)) : plan.reasons) : [];
    return reasons.length > 0 ? [`${row.id} | ${row.sourceType} | ${reasons.join(', ')} | ${plan!.notes.join('; ')} | ${jobUrl(row)}`] : [];
  });
  if (review.length > 0) {
    console.log('');
    console.log(`REVIEW (employer-posted, not changed): ${review.length} row(s) FB-3 flags`);
    for (const line of review) console.log(`  ${line}`);
  }

  console.log('');
  console.log(`By reason: ${[...byReason].map(([r, n]) => `${r} ${n}`).join(', ') || 'none'}`);
  if (opts.apply) await applyPlannedWrites(prisma, writes);
  printFooter(opts, writes.length, SCRIPT);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
