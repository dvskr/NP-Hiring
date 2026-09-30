/**
 * Shared runner plumbing for scripts/indexing-fixes/: CLI flags, printing,
 * and the single guarded transaction every --apply goes through.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { JobRow } from './planners';

/**
 * The order the job-row fixes run in, each one's dry run reviewed before its
 * --apply. Each script's header names its step; each dry run's footer names
 * the next one.
 *   1. FB-3 first: misrepresented rows are held before anything corrects
 *      them (step 5 re-publishes the held rows it corrects).
 *   2-3. Non-US work sites and stub descriptions come off before any
 *      correction touches them.
 *   4-5. Locations are filled and corrected before duplicates are grouped:
 *      rows with no city, state or remote flag ("2 Locations", "United
 *      States") all read as one work site, so collapsing first would merge
 *      postings for different places.
 *   6. Duplicates are collapsed on the corrected work sites.
 *   7-8. The job type is re-derived, then the category tags are recomputed
 *      last, from the corrected columns.
 * backfill-content-changed-at.ts, populate-company-website-logo.ts and the
 * report scripts touch other columns and can run at any point.
 */
export const RUN_ORDER: readonly string[] = [
  'scripts/indexing-fixes/unpublish-misrepresented-jobs.ts',
  'scripts/indexing-fixes/unpublish-non-us-jobs.ts',
  'scripts/indexing-fixes/hold-stub-description-jobs.ts',
  'scripts/indexing-fixes/backfill-job-locations.ts',
  'scripts/indexing-fixes/correct-location-and-pay.ts',
  'scripts/indexing-fixes/collapse-duplicate-jobs.ts',
  'scripts/indexing-fixes/rederive-job-type.ts',
  'scripts/indexing-fixes/retag-category-tags.ts',
];

/** "Step 4 of 8; next: ...correct-location-and-pay.ts", or null for a script outside RUN_ORDER. */
export function runOrderNote(scriptPath: string): string | null {
  const i = RUN_ORDER.indexOf(scriptPath);
  if (i < 0) return null;
  const next = RUN_ORDER[i + 1];
  return `Run order: step ${i + 1} of ${RUN_ORDER.length}; ${next ? `next: ${next}` : 'this is the last step'}.`;
}

export interface CliOptions {
  /** Write the planned changes. Without it the script only reads and prints. */
  apply: boolean;
  /** Only rows whose employer contains this text (case-insensitive). */
  employer: string | null;
  /** Only these job ids. */
  ids: string[] | null;
  /** Only these reasons (script specific). */
  only: string[] | null;
  /** Stop after this many planned rows. */
  limit: number | null;
  /** backfill-job-locations.ts: also read the Workday detail endpoint. */
  fetchWorkday: boolean;
}

export function parseCli(argv: readonly string[]): CliOptions {
  const value = (name: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const list = (name: string): string[] | null => {
    const v = value(name);
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null;
  };
  const limitRaw = value('limit');
  const limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : null;
  return {
    apply: argv.includes('--apply'),
    employer: value('employer'),
    ids: list('ids'),
    only: list('only'),
    limit,
    fetchWorkday: argv.includes('--fetch-workday'),
  };
}

/** Prisma where for the --employer and --ids filters. */
export function rowFilter(opts: CliOptions): Prisma.JobWhereInput {
  return {
    ...(opts.employer ? { employer: { contains: opts.employer, mode: 'insensitive' as const } } : {}),
    ...(opts.ids ? { id: { in: opts.ids } } : {}),
  };
}

export function printHeader(title: string, purpose: string, opts: CliOptions, envFile: string): void {
  const rule = '='.repeat(78);
  console.log(rule);
  console.log(title);
  console.log(purpose);
  console.log(`Database: DATABASE_URL from ${envFile} (the repo .env is the PRODUCTION database)`);
  console.log(`Mode: ${opts.apply ? 'APPLY (writes inside one transaction)' : 'DRY RUN (reads only, writes nothing)'}`);
  const filters = [
    opts.employer ? `employer contains "${opts.employer}"` : null,
    opts.ids ? `ids ${opts.ids.join(', ')}` : null,
    opts.only ? `only ${opts.only.join(', ')}` : null,
    opts.limit ? `limit ${opts.limit}` : null,
  ].filter(Boolean);
  if (filters.length > 0) console.log(`Filters: ${filters.join('; ')}`);
  console.log(rule);
}

export function jobUrl(row: Pick<JobRow, 'slug' | 'id'>): string {
  return row.slug ? `https://nphiring.com/jobs/${row.slug}` : `(no slug) id ${row.id}`;
}

function show(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

/**
 * A timestamp column --apply also writes, with the value it writes: 'now'
 * (the time of the write) or null. Printed so a dry run shows every column
 * a write changes; the row's current value is not read.
 */
export type StampWrites = Readonly<Record<string, 'now' | null>>;

export function printRow(
  row: JobRow,
  heading: string,
  changes: Record<string, { from: unknown; to: unknown }>,
  notes: string[] = [],
  stamps: StampWrites = {},
): void {
  console.log('');
  console.log(`- ${heading}`);
  console.log(`  id ${row.id} | ${row.employer} | ${JSON.stringify(row.title)}`);
  console.log(`  location ${JSON.stringify(row.location)} | published ${row.isPublished} | ${jobUrl(row)}`);
  for (const note of notes) console.log(`  note: ${note}`);
  for (const [field, { from, to }] of Object.entries(changes)) {
    console.log(`  ${field}: ${show(from)} -> ${show(to)}`);
  }
  for (const [field, value] of Object.entries(stamps)) {
    console.log(`  ${field}: set to ${value === 'now' ? 'the time of --apply' : 'null'}`);
  }
}

export interface PlannedWrite {
  id: string;
  /** The row must still look as it did when the plan was made. */
  guard: Prisma.JobWhereInput;
  /** Column values to write (validated by Prisma at write time). */
  data: Record<string, unknown>;
  audit: { action: string; metadata: Prisma.InputJsonValue };
}

/**
 * Write every planned change in ONE transaction. Each update is guarded by
 * the values it was planned from; if any row changed since the dry run, the
 * transaction rolls back and nothing is written. Each write leaves an
 * audit_logs row (actor 'system', action 'indexing_fix.*').
 */
export async function applyPlannedWrites(prisma: PrismaClient, writes: readonly PlannedWrite[]): Promise<void> {
  if (writes.length === 0) return;
  await prisma.$transaction(
    async (tx) => {
      for (const w of writes) {
        const res = await tx.job.updateMany({ where: { AND: [{ id: w.id }, w.guard] }, data: w.data as Prisma.JobUpdateManyMutationInput });
        if (res.count !== 1) {
          throw new Error(`Job ${w.id} changed after the plan was made. Nothing was written; run the dry run again.`);
        }
        await tx.auditLog.create({
          data: {
            action: w.audit.action,
            actorType: 'system',
            actorId: null,
            targetType: 'job',
            targetId: w.id,
            metadata: w.audit.metadata,
          },
        });
      }
    },
    { timeout: 180_000, maxWait: 20_000 },
  );
}

const TS_NODE_PREFIX =
  'node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register --project scripts/tsconfig.json';

/** Characters a shell would read as anything other than plain text. */
const SHELL_SPECIAL_RE = /[\s"'$`\\!*?;&|<>()[\]{}#~]/;

/**
 * One argument, quoted when a shell would split or expand it. Double quotes
 * work the same in bash and PowerShell for plain text; a value that itself
 * holds a double quote, "$", a backtick or a backslash gets POSIX single
 * quotes instead.
 */
function shellQuote(value: string): string {
  if (!SHELL_SPECIAL_RE.test(value)) return value;
  if (!/["$`\\]/.test(value)) return `"${value}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellArg(arg: string): string {
  const eq = arg.indexOf('=');
  if (arg.startsWith('--') && eq > 0) return `${arg.slice(0, eq + 1)}${shellQuote(arg.slice(eq + 1))}`;
  return shellQuote(arg);
}

/**
 * The command that applies exactly what a dry run printed: the same script
 * with the same filters (--employer, --ids, --only, --limit, ...) plus
 * --apply. Suggesting the bare script instead would write to every matching
 * row in the database, not the reviewed subset.
 */
export function applyCommand(scriptPath: string, argv: readonly string[]): string {
  const args = argv.filter((a) => a !== '--apply').map(shellArg);
  return [TS_NODE_PREFIX, scriptPath, ...args, '--apply'].join(' ');
}

export function printFooter(
  opts: CliOptions,
  planned: number,
  scriptPath: string,
  argv: readonly string[] = process.argv.slice(2),
): void {
  console.log('');
  console.log('-'.repeat(78));
  if (opts.apply) {
    console.log(`Applied ${planned} change(s).`);
  } else {
    console.log(`${planned} change(s) planned. Nothing was written.`);
    if (planned > 0) {
      console.log('Review the rows above, then apply with the same filters plus --apply:');
      console.log(`  ${applyCommand(scriptPath, argv)}`);
    }
  }
  const order = runOrderNote(scriptPath);
  if (order) console.log(order);
}

/** JSON-safe snapshot of the planned field changes, for the audit row. */
export function auditChanges(changes: Record<string, { from: unknown; to: unknown }>): Prisma.InputJsonValue {
  const out: Record<string, { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null }> = {};
  for (const [k, { from, to }] of Object.entries(changes)) {
    const safe = (v: unknown): Prisma.InputJsonValue | null =>
      v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : (v as Prisma.InputJsonValue);
    out[k] = { from: safe(from), to: safe(to) };
  }
  return out as Prisma.InputJsonValue;
}

/**
 * A where clause that matches the row only while every field about to
 * change still holds the value the plan was made from.
 */
export function guardFrom(changes: Record<string, { from: unknown; to: unknown }>): Prisma.JobWhereInput {
  return Object.fromEntries(
    Object.entries(changes).map(([field, { from }]) => [field, from ?? null]),
  ) as Prisma.JobWhereInput;
}
