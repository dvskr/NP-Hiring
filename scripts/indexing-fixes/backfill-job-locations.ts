/**
 * scripts/indexing-fixes/backfill-job-locations.ts: indexing audit CS-03 /
 * GFJ-02, plan fixSoon 6.
 *
 * WHAT IT DOES (four independent fixes; --only picks a subset)
 *   location  PUBLISHED jobs that are not fully remote and have no city,
 *             state or state code (about 42 rows; 12 were Workday
 *             "2 Locations") get a location. The title has authority, since
 *             it is the visible H1: a "City, ST", state-name or bare state
 *             segment of the title wins ("Nurse Practitioner - Denver, CO
 *             (Hybrid)", "Nurse Practitioner- Terre Haute, IN - Hybrid
 *             Remote", "Springboro/Miamisburg, OH", "..., Iowa, Remote").
 *             Otherwise, in order of trust:
 *               - the Workday detail endpoint's primary location, when run
 *                 with --fetch-workday (one polite request per Workday row);
 *               - a labelled "Location:" line in the description;
 *               - a street address line at the top of the description
 *                 ("2000 16th Street, Denver, Colorado, 80202");
 *               - a "work in City, State" phrase ("to work in St. Joseph,
 *                 Michigan").
 *             Only a candidate that resolves to a US state, with a town
 *             name that is a plausible town, is used; one in another state
 *             than the title names is skipped (DaVita "Freehold, NJ" opens
 *             with a Freeport, NY address). A location text that names no
 *             place is replaced by "City, ST". Logic: lib/location-fallback.ts.
 *             The same pass fills the town of a row that is not fully remote
 *             and has its state but no city, when its location string names
 *             exactly one place, a town in that state (the 13 Thriveworks
 *             "VA - Chesterfield" and "VA - Norfolk" rows). Only the city is
 *             written; the state stays (planStateOnlyTownBackfill).
 *   onsite    Rows flagged remote (isRemote = true, alone or beside
 *             isHybrid) although nothing says so: the location text has no
 *             remote token and the title and description have no remote,
 *             work-from-home, telehealth, virtual or home-based wording. The
 *             old enrich-jobs fallback flagged every location-less row remote,
 *             which put on-site roles such as Corewell's inpatient psychiatry
 *             post at Lakeland Hospital, St. Joseph on /jobs/remote. They
 *             become In-Person (isRemote = false, isHybrid = false), or Hybrid
 *             when the text states hybrid outside a list of modes. The same
 *             pass then runs the location backfill on the corrected row, so
 *             the Corewell row also gets St. Joseph, MI.
 *   remote    Rows whose raw location is only "Remote", "United States" or
 *             "United States- Remote" but are stored as hybrid (about 15)
 *             become fully remote (isRemote = true, isHybrid = false,
 *             mode = 'Remote') when the title and description confirm it:
 *             the ingest reconciler reads Remote and nothing says hybrid or
 *             "not a 100% remote position".
 *   state     A state column holding something that is not a US state (the
 *             old enrich-jobs fallback wrote "United States") is cleared.
 *   Every change sets contentChangedAt = now and writes an audit_logs row
 *   (action 'indexing_fix.location_backfill') with before and after values.
 *   Rows no candidate resolves are listed as UNRESOLVED and left alone.
 *
 * RUN ORDER: step 4 of 8 of the job-row fixes (the order and the
 *   reasons are in scripts/indexing-fixes/lib/runtime.ts RUN_ORDER).
 *
 * HOW TO RUN (a person runs this; the repo .env is the PRODUCTION database)
 *   1. Dry run. Reads only and prints each row, the evidence used and each
 *      before -> after:
 *        node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *          --project scripts/tsconfig.json scripts/indexing-fixes/backfill-job-locations.ts
 *      Add --fetch-workday to read Workday detail endpoints (network calls
 *      to the employers' Workday sites; nothing is written). Other filters:
 *      --only=location,onsite,remote,state, --employer=..., --ids=a,b, --limit=N.
 *   2. Review, then repeat the SAME command with --apply (one guarded
 *      transaction; a row that changed since the dry run aborts the run).
 */
import { ENV_FILE } from './lib/load-env';
import { prisma } from '@/lib/prisma';
import { parseWorkdayDetail } from '@/lib/aggregators/workday';
import {
  JOB_ROW_SELECT,
  diffFields,
  isPhantomState,
  needsLocationBackfill,
  planLocationBackfill,
  planOnsiteReclassify,
  planRemoteReclassify,
  planStateOnlyTownBackfill,
  workdayDetailUrl,
  type JobRow,
} from './lib/planners';
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

const SCRIPT = 'scripts/indexing-fixes/backfill-job-locations.ts';
const WORKDAY_GAP_MS = 400;
const WORKDAY_TIMEOUT_MS = 8_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function workdayPrimaryLocation(row: JobRow): Promise<string | null> {
  const url = workdayDetailUrl(row.applyLink);
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WORKDAY_TIMEOUT_MS);
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return parseWorkdayDetail(await res.json()).primaryLocation ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  printHeader(
    'Backfill missing job locations, reclassify misfiled on-site and remote rows, clear phantom states (fixSoon 6)',
    'Writes city/state/stateCode (and a vague location text), work-mode flags, and contentChangedAt.',
    opts,
    ENV_FILE,
  );
  const want = (k: string): boolean => !opts.only || opts.only.includes(k);

  const rows = (await prisma.job.findMany({
    where: { isPublished: true, ...rowFilter(opts) },
    select: JOB_ROW_SELECT,
    orderBy: [{ employer: 'asc' }, { createdAt: 'asc' }],
  })) as JobRow[];
  console.log(`Read ${rows.length} published row(s).`);

  const now = new Date();
  const writes: PlannedWrite[] = [];
  const unresolved: JobRow[] = [];
  for (const row of rows) {
    if (opts.limit !== null && writes.length >= opts.limit) break;
    const next: Record<string, unknown> = {};
    const notes: string[] = [];

    // On-site first: a row it corrects stops being fully remote, so the
    // location backfill below reads the corrected row and can fill its city.
    let current: JobRow = row;
    if (want('onsite')) {
      const plan = planOnsiteReclassify(row);
      if (plan) {
        Object.assign(next, plan.next);
        current = { ...row, ...plan.next };
        notes.push(
          `onsite: flagged remote, but neither the location nor the text says remote; text mode ${plan.statedMode ?? 'none stated'}`,
        );
      }
    }

    if (want('location') && needsLocationBackfill(current)) {
      let workday: string | null = null;
      if (opts.fetchWorkday && row.sourceProvider === 'workday') {
        workday = await workdayPrimaryLocation(row);
        await sleep(WORKDAY_GAP_MS);
      }
      const plan = planLocationBackfill(current, workday);
      if (plan) {
        Object.assign(next, plan.next);
        notes.push(`location from ${plan.source}: "${plan.evidence}"`);
      } else {
        unresolved.push(row);
      }
    } else if (want('location')) {
      // State set, city missing, and the location string names one town in that state.
      const plan = planStateOnlyTownBackfill(current);
      if (plan) {
        Object.assign(next, plan.next);
        notes.push(`town from the location string: "${plan.evidence}" (state kept)`);
      }
    }

    if (want('remote') && current === row) {
      const plan = planRemoteReclassify(row);
      if (plan) {
        Object.assign(next, plan.next);
        notes.push('remote: location is remote-only and the text confirms fully remote');
      }
    }

    if (want('state') && isPhantomState(row) && next.state === undefined) {
      next.state = null;
      if (row.stateCode && !/^[A-Z]{2}$/.test(row.stateCode)) next.stateCode = null;
      notes.push(`state "${row.state}" is not a US state`);
    }

    const changes = diffFields(row, next);
    if (Object.keys(changes).length === 0) continue;
    printRow(row, 'UPDATE', changes, notes, { contentChangedAt: 'now' });
    writes.push({
      id: row.id,
      guard: { ...guardFrom(changes), isPublished: true },
      data: {
        ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])),
        contentChangedAt: now,
      },
      audit: {
        action: 'indexing_fix.location_backfill',
        metadata: { changes: auditChanges(changes), notes, script: SCRIPT },
      },
    });
  }

  if (unresolved.length > 0) {
    console.log('');
    console.log(`UNRESOLVED (no location candidate resolved to a US state; left alone): ${unresolved.length}`);
    for (const row of unresolved) {
      console.log(`  ${row.id} | ${row.employer} | ${JSON.stringify(row.title)} | location ${JSON.stringify(row.location)}`);
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
