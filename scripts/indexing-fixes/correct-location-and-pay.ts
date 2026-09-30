/**
 * scripts/indexing-fixes/correct-location-and-pay.ts: indexing audit CQ-02,
 * plan fixSoon 7 (the correction step after FB-3).
 *
 * WHAT IT DOES
 *   Re-derives location and pay for stored jobs with the FIXED ingest code
 *   and, with --apply, writes the corrected values:
 *     location  parseLocation re-reads the stored location text. A wrong
 *               state is corrected ("1730 Rhode Island Ave NW, Washington,
 *               DC, 20036": city "1730", RI -> Washington, DC), a street
 *               address or facility stored as the city is replaced
 *               ("5100 Buckeyestown Pike Suite 200 Frederick" -> Frederick),
 *               and a missing city or state is filled when the text names it.
 *               A valid stored city is never swapped for a different one,
 *               and a stored state the text names is kept (a posting that
 *               lists "Kansas City, MO; Overland Park, KS" may store either).
 *     pay       A raw figure equal to an old clamp bound ($30,000 or
 *               $500,000 a year, $20 or $350 an hour, ...) is re-read from
 *               the posting text with the fixed extractor, which skips CEU
 *               budgets, bonuses and relocation amounts ("CEU budget of
 *               $1,500 annually") and takes the stated range ("Compensation
 *               $140,000 - $228,400+"), or the posting's own figure when it
 *               repeats the stored one (MedElite "$30,000 - $90,000": kept,
 *               re-normalized); with no such figure the salary is
 *               cleared. Otherwise the stored raw figure is re-normalized
 *               without the old clamp ($40,000 to $44,000 stored as $48,000
 *               -> $40,000 to $44,000, flagged out of salary aggregates).
 *   Each corrected row also gets contentChangedAt = now (its visible
 *   content changed) and an audit_logs row (action
 *   'indexing_fix.correct_location_pay') with every before and after value.
 *
 *   Rows that unpublish-misrepresented-jobs.ts HELD (found by its
 *   'indexing_fix.fb3_unpublish' audit rows) are re-published here once
 *   corrected (isPublished = true, isManuallyUnpublished = false), only
 *   when the corrected row passes every gate (republishBlocker in
 *   lib/planners.ts): a full run (no --only, or both location and pay), a
 *   US work site, no FB-3 reason left after the corrections, and a
 *   description that is not a stub. A job past its expiresAt stays down
 *   too. A held row that stays held is printed with the reason, for
 *   example "stays held: run without --only", "stays held:
 *   pay_not_stated_by_employer" or "stays held: stub description". Rows
 *   unpublished for any other reason are never touched.
 *
 *   The Sol Mental Health rows are the known case; run them first:
 *     --employer="Sol Mental Health"
 *
 * RUN ORDER: step 5 of 8 of the job-row fixes (the order and the
 *   reasons are in scripts/indexing-fixes/lib/runtime.ts RUN_ORDER).
 *
 * HOW TO RUN (a person runs this; the repo .env is the PRODUCTION database)
 *   Run it only after the parser fix is deployed, so a later ingest renewal
 *   agrees with what this writes.
 *   1. Dry run. Reads only and prints every row with each before -> after:
 *        node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *          --project scripts/tsconfig.json scripts/indexing-fixes/correct-location-and-pay.ts \
 *          --employer="Sol Mental Health"
 *      Drop --employer to see every affected row. Other filters: --ids=a,b,
 *      --only=location,pay, --limit=N.
 *   2. Review, then repeat the SAME command with --apply (one guarded
 *      transaction; a row that changed since the dry run aborts the run).
 */
import { ENV_FILE } from './lib/load-env';
import { prisma } from '@/lib/prisma';
import {
  JOB_ROW_SELECT,
  diffFields,
  planLocationCorrection,
  planPayCorrection,
  republishBlocker,
  type FieldChanges,
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

const SCRIPT = 'scripts/indexing-fixes/correct-location-and-pay.ts';

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  printHeader(
    'Correct location and pay with the fixed parser (and re-publish FB-3 holds)',
    'Writes corrected city/state and salary columns, contentChangedAt, and re-publishes rows FB-3 held.',
    opts,
    ENV_FILE,
  );
  const wantLocation = !opts.only || opts.only.includes('location');
  const wantPay = !opts.only || opts.only.includes('pay');

  const heldAudits = await prisma.auditLog.findMany({
    where: { action: 'indexing_fix.fb3_unpublish', targetType: 'job' },
    select: { targetId: true },
  });
  const heldIds = new Set(heldAudits.map((a) => a.targetId).filter((id): id is string => !!id));

  const rows = (await prisma.job.findMany({
    where: {
      AND: [
        rowFilter(opts),
        { OR: [{ isPublished: true }, { id: { in: [...heldIds] }, isPublished: false, isManuallyUnpublished: true }] },
      ],
    },
    select: JOB_ROW_SELECT,
    orderBy: [{ employer: 'asc' }, { createdAt: 'asc' }],
  })) as JobRow[];
  console.log(`Read ${rows.length} row(s): published ones plus ${heldIds.size} held by FB-3.`);

  const now = new Date();
  const writes: PlannedWrite[] = [];
  let republished = 0;
  for (const row of rows) {
    if (opts.limit !== null && writes.length >= opts.limit) break;
    const loc = wantLocation ? planLocationCorrection(row) : null;
    const pay = wantPay ? planPayCorrection(row) : null;
    const next: Record<string, unknown> = { ...(loc?.next ?? {}), ...(pay?.next ?? {}) };
    const changes = diffFields(row, next);

    const held = heldIds.has(row.id) && !row.isPublished;
    const expired = !!row.expiresAt && row.expiresAt.getTime() <= now.getTime();
    // A held row goes live again only when the corrected row passes every
    // gate: a partial --only run, a remaining FB-3 reason, a non-US work
    // site or a stub description keeps it held (republishBlocker, the pure
    // form of shouldRepublishHeld that also names the reason).
    const blocker = held ? republishBlocker(row, next, opts.only) : null;
    const republish = held && !expired && blocker === null;
    if (Object.keys(changes).length === 0 && !republish) continue;

    const notes: string[] = [];
    if (loc) notes.push(`location: ${loc.reasons.join(', ')}`);
    if (pay) notes.push(`pay: ${pay.reason}${pay.statedInText ? `; posting states ${pay.statedInText}` : '; posting states no pay'}`);
    if (held && expired) notes.push('stays unpublished: past its expiresAt');
    else if (held && blocker) notes.push(`stays held: ${blocker}`);

    const publishChanges: FieldChanges = republish
      ? { isPublished: { from: false, to: true }, isManuallyUnpublished: { from: true, to: false } }
      : {};
    const allChanges: FieldChanges = { ...changes, ...publishChanges };
    printRow(row, republish ? 'CORRECT AND RE-PUBLISH' : 'CORRECT', allChanges, notes, {
      ...(republish ? { unpublishedAt: null } : {}),
      contentChangedAt: 'now',
    });
    if (republish) republished++;

    const data: Record<string, unknown> = {
      ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])),
      ...(republish ? { isPublished: true, isManuallyUnpublished: false, unpublishedAt: null } : {}),
      contentChangedAt: now,
    };
    writes.push({
      id: row.id,
      guard: { ...guardFrom(changes), isPublished: row.isPublished },
      data,
      audit: {
        action: 'indexing_fix.correct_location_pay',
        metadata: { changes: auditChanges(allChanges), notes, script: SCRIPT },
      },
    });
  }

  console.log('');
  console.log(`Re-published: ${republished}`);
  if (opts.apply) await applyPlannedWrites(prisma, writes);
  printFooter(opts, writes.length, SCRIPT);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
