/**
 * scripts/indexing-fixes/rederive-job-type.ts: indexing audit H-03 (f) and
 * M-06. Re-derives Job.jobType on live rows with the fixed employment-type
 * rules (lib/job-type-detection.ts) and prints what would change.
 *
 * WHY
 *   The old detector read the first substring hit anywhere in the text, so
 *   boilerplate decided the type. Live examples: every Advocate Health row
 *   was Per Diem from "(e.g., full-time, part-time, per diem...)" although
 *   the posting says "Status: Full time ... Hours Per Week: 40"; Highmark's
 *   "Employees, Contractors, and Applicants Notice" made 29 rows Contract;
 *   Centene's "contractual", MultiCare's "union contract" and Thriveworks'
 *   "Fee For Service (W2)" made full-time roles Contract. Ingest now uses
 *   the fixed rules; stored rows keep the old value until this runs.
 *
 * WHAT IT CHANGES (scripts/indexing-fixes/lib/planners.ts planJobTypeRederive)
 *   - a stored type the old text detector produced is replaced by the fixed
 *     answer, or cleared when the text states no type (the markup then
 *     omits employmentType instead of stating a wrong one);
 *   - a missing type is filled when the fixed rules find one;
 *   - a type from an ATS field (Ashby, BambooHR, SmartRecruiters, Workable
 *     and other providers that passed one), from enrichment or from a
 *     person, and every employer-posted row, is left alone.
 *   Each change also sets contentChangedAt = now (the type is shown on the
 *   page and in the JobPosting markup) and writes an audit_logs row (action
 *   'indexing_fix.job_type_rederive') with before and after values.
 *
 * AFTER --apply
 *   Run scripts/indexing-fixes/retag-category-tags.ts (dry run first): the
 *   full-time, part-time, contract and per diem category tags read jobType.
 *   Then let aggregate-pseo run so the landing verdicts are recomputed.
 *
 * RUN ORDER: step 7 of 8 of the job-row fixes (the order and the
 *   reasons are in scripts/indexing-fixes/lib/runtime.ts RUN_ORDER).
 *
 * HOW TO RUN (a person runs this; the repo .env is the PRODUCTION database)
 *   1. Dry run. Reads only and prints every planned change with the source
 *      the new type was read from (title, labelled line, text, W-2):
 *        node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *          --project scripts/tsconfig.json scripts/indexing-fixes/rederive-job-type.ts
 *      Optional: --employer="Advocate", --ids=a,b, --limit=N,
 *      --only=text_detector_fix,missing_type.
 *   2. Review, then repeat the SAME command with --apply (one guarded
 *      transaction; a row that changed since the dry run aborts the run).
 */
import { ENV_FILE } from './lib/load-env';
import { prisma } from '@/lib/prisma';
import { JOB_ROW_SELECT, diffFields, planJobTypeRederive, type JobRow } from './lib/planners';
import {
  parseCli,
  rowFilter,
  printHeader,
  printRow,
  printFooter,
  applyPlannedWrites,
  auditChanges,
  guardFrom,
  type PlannedWrite,
} from './lib/runtime';

const SCRIPT = 'scripts/indexing-fixes/rederive-job-type.ts';

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  printHeader(
    'Re-derive employment type with the fixed rules (H-03)',
    'Writes jobType and contentChangedAt on published rows whose stored type the old detector produced.',
    opts,
    ENV_FILE,
  );

  const rows = (await prisma.job.findMany({
    where: { isPublished: true, ...rowFilter(opts) },
    select: JOB_ROW_SELECT,
    orderBy: [{ employer: 'asc' }, { createdAt: 'asc' }],
  })) as JobRow[];
  console.log(`Read ${rows.length} published row(s).`);

  const now = new Date();
  const writes: PlannedWrite[] = [];
  const tally = new Map<string, number>();
  for (const row of rows) {
    if (opts.limit !== null && writes.length >= opts.limit) break;
    const plan = planJobTypeRederive(row);
    if (!plan) continue;
    if (opts.only && !opts.only.includes(plan.reason)) continue;
    const changes = diffFields(row, plan.next);
    if (Object.keys(changes).length === 0) continue;
    const notes = [
      `${plan.reason}: read from ${plan.source ?? 'nothing (no type stated)'}`,
      ...(plan.types.length > 1 ? [`the posting offers ${plan.types.join(' and ')}; the row stores the first`] : []),
    ];
    printRow(row, 'UPDATE', changes, notes, { contentChangedAt: 'now' });
    const key = `${row.jobType ?? 'null'} -> ${plan.next.jobType ?? 'null'}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    writes.push({
      id: row.id,
      guard: { ...guardFrom(changes), isPublished: true },
      data: { jobType: plan.next.jobType, contentChangedAt: now },
      audit: {
        action: 'indexing_fix.job_type_rederive',
        metadata: { changes: auditChanges(changes), notes, script: SCRIPT },
      },
    });
  }

  if (tally.size > 0) {
    console.log('');
    console.log('Changes by type:');
    for (const [key, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${key}: ${count}`);
  }

  if (opts.apply) await applyPlannedWrites(prisma, writes);
  printFooter(opts, writes.length, SCRIPT);
  if (writes.length > 0) {
    console.log('Next: run scripts/indexing-fixes/retag-category-tags.ts (dry run first); the job-type categories read jobType.');
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
