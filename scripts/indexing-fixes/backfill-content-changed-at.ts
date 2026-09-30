/**
 * scripts/indexing-fixes/backfill-content-changed-at.ts: indexing audit
 * fixSoon 5 (CS-02, TECH-04).
 *
 * WHY
 *   Job.contentChangedAt (sitemap lastmod, the job page's "Last updated"
 *   line) has no default. Migration 20260928000000_job_content_changed_at
 *   fills it from createdAt for every row that exists when it runs, and
 *   every create and revival path now stamps it. A row written by the old
 *   code in the window between `prisma migrate deploy` and the new
 *   deployment going live still holds NULL: its page shows no "Last
 *   updated" line and its sitemap entry falls back to createdAt.
 *
 * WHAT IT DOES
 *   Reads every job whose contentChangedAt is NULL and plans
 *   contentChangedAt = createdAt, the last content change that can be
 *   proved for it (the same rule as the migration). It never touches a row
 *   that already has a value. updatedAt is written back with its current
 *   value: deindex-expired uses it as its cursor, and a moved updatedAt on
 *   an unpublished row would send that removal to the search engines again.
 *   With --apply every change is written in ONE transaction, each update
 *   guarded by the values it was planned from (a row that changed since the
 *   dry run aborts the whole run), with an audit_logs row per job (action
 *   'indexing_fix.content_changed_at_backfill').
 *
 * HOW TO RUN (a person runs this, AFTER the deploy that applies the
 * migration; the repo .env is the PRODUCTION database)
 *   1. Dry run. Reads only and prints every planned change:
 *        node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *          --project scripts/tsconfig.json scripts/indexing-fixes/backfill-content-changed-at.ts
 *      Optional: --employer="LifeStance", --ids=a,b, --limit=N.
 *   2. Review, then repeat the SAME command with --apply.
 */
import { ENV_FILE } from './lib/load-env';
import { prisma } from '@/lib/prisma';
import {
  parseCli,
  rowFilter,
  printHeader,
  printFooter,
  applyPlannedWrites,
  jobUrl,
  type PlannedWrite,
} from './lib/runtime';

const SCRIPT = 'scripts/indexing-fixes/backfill-content-changed-at.ts';

/** The audit_logs action every backfilled row records. */
export const CONTENT_CHANGED_AT_BACKFILL_ACTION = 'indexing_fix.content_changed_at_backfill';

interface BackfillRow {
  id: string;
  slug: string | null;
  title: string;
  employer: string;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The write for one row: contentChangedAt from createdAt, updatedAt kept as
 * it is, guarded so it lands only while the row still has no content date
 * and has not been written since the plan was made. Pure, for tests.
 */
export function planContentChangedAtBackfill(row: BackfillRow): PlannedWrite {
  return {
    id: row.id,
    guard: { contentChangedAt: null, updatedAt: row.updatedAt },
    data: { contentChangedAt: row.createdAt, updatedAt: row.updatedAt },
    audit: {
      action: CONTENT_CHANGED_AT_BACKFILL_ACTION,
      metadata: { contentChangedAt: row.createdAt.toISOString(), script: SCRIPT },
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opts = parseCli(argv);
  printHeader(
    'Backfill Job.contentChangedAt from createdAt',
    'Fills only NULL values, from createdAt; updatedAt (the deindex-expired cursor) is written back unchanged.',
    opts,
    ENV_FILE,
  );

  const rows = (await prisma.job.findMany({
    where: { contentChangedAt: null, ...rowFilter(opts) },
    select: { id: true, slug: true, title: true, employer: true, isPublished: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'asc' },
    ...(opts.limit !== null ? { take: opts.limit } : {}),
  })) as BackfillRow[];
  console.log(`Read ${rows.length} row(s) with no contentChangedAt.`);

  const writes: PlannedWrite[] = [];
  for (const row of rows) {
    console.log('');
    console.log(`- BACKFILL contentChangedAt`);
    console.log(`  id ${row.id} | ${row.employer} | ${JSON.stringify(row.title)}`);
    console.log(`  published ${row.isPublished} | ${jobUrl(row)}`);
    console.log(`  contentChangedAt: null -> ${row.createdAt.toISOString()} (createdAt)`);
    writes.push(planContentChangedAtBackfill(row));
  }

  if (opts.apply) await applyPlannedWrites(prisma, writes);
  printFooter(opts, writes.length, SCRIPT, argv);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
