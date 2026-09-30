/**
 * scripts/backfill-remote-flags.ts — WP-1D / live-review item 1e
 *
 * WHY THIS EXISTS
 * ───────────────
 * Three inference defects let verifiably onsite rows ship isRemote=true (and
 * therefore JobPosting jobLocationType TELECOMMUTE) — recon counted 111
 * published isRemote rows with on-site language, including five Tia
 * '… - Onsite' listings stored as mode='In-Person' + is_remote=true:
 *
 *   1. lib/location-parser.ts treated 'united states' / 'nationwide' /
 *      'telehealth' / 'virtual' as remote-proving SUBSTRINGS of the location
 *      ('Los Angeles, CA, United States' → remote).
 *   2. lib/job-normalizer.ts MODE_REMOTE_RE carried a bare `|remote` tail that
 *      matched any mention of the word in description boilerplate.
 *   3. The mode↔flags sync only ratcheted TOWARD remote — a detected
 *      'In-Person' mode could never clear a location-parser false positive.
 *
 * All three are fixed at ingest (parseLocation, MODE_REMOTE_RE,
 * reconcileWorkMode). This script re-derives mode/isRemote/isHybrid for
 * ALREADY-INGESTED rows through the SAME fixed code paths, so the stored
 * flags converge on exactly what a fresh ingest would produce. No heuristics
 * live here — if the shared functions change, re-running converges again.
 *
 * SAFETY / IDEMPOTENCY
 * ────────────────────
 *   • Dry run by DEFAULT. Nothing is written without --apply.
 *   • --check is the assert-only CI shape: exit 1 while any row still carries
 *     stale flags, writes nothing.
 *   • Employer-declared modes are AUTHORITATIVE: for sourceType
 *     'employer'/'direct' rows the stored mode is passed as structuredMode,
 *     so this script never overrides what an employer explicitly selected.
 *   • Never publishes/unpublishes, never deletes — only mode, isRemote,
 *     isHybrid on rows whose derived values differ, plus contentChangedAt on
 *     those rows so the corrected pages are resubmitted.
 *   • Re-running after --apply plans zero changes and exits 0.
 *
 * RUN (a human runs this). The same check runs daily without it: the
 * job-posting-integrity cron (app/api/cron/job-posting-integrity, the
 * 'daily' batch in config/cron-schedule.ts) plans every published row with
 * lib/work-mode-integrity.ts planWorkModeRepair, reads only, and posts a
 * Discord alert while stale rows survive (indexing audit GFJ-01). Both
 * env branches below read the repo .env, which is the PRODUCTION database.
 * ───────────────────────────────────────────────────────────
 *   # 1. dry run against dev — prints the plan + writes the CSV, changes nothing
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/backfill-remote-flags.ts --env=dev
 *
 *   # 2. dry run against PROD (review the CSV before any apply)
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/backfill-remote-flags.ts --env=prod
 *
 *   # 3. commit the repairs (HUMAN-GATED — only after the CSV is reviewed)
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/backfill-remote-flags.ts --env=prod --apply
 *
 *   # assert-only (exit 1 while stale rows survive) — the CI shape
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/backfill-remote-flags.ts --env=prod --check
 *
 * Flags: --all includes unpublished rows (default: published only);
 * --csv=path overrides the report location.
 */
import { config as dotenvConfig } from 'dotenv';
import { writeFileSync } from 'fs';

// ─── env selection (mirrors scripts/repair-city-slug-diacritics-db.ts) ──────

type EnvKind = 'dev' | 'prod';

function parseEnvFlag(): EnvKind {
    const flag = process.argv.find((a) => a.startsWith('--env='))?.split('=')[1];
    if (flag === 'dev' || flag === 'prod') return flag;
    if (process.argv.includes('--dev')) return 'dev';
    if (process.argv.includes('--prod')) return 'prod';
    return 'prod';
}

const ENV: EnvKind = parseEnvFlag();
if (ENV === 'prod') {
    dotenvConfig({ path: '.env.prod' });
    if (process.env.PROD_DATABASE_URL && !process.env.DATABASE_URL) {
        process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
    }
    if (process.env.PROD_DIRECT_URL && !process.env.DIRECT_URL) {
        process.env.DIRECT_URL = process.env.PROD_DIRECT_URL;
    }
} else {
    dotenvConfig({ path: '.env' });
}

// Required AFTER the env is selected — the Prisma client reads DATABASE_URL at
// construction time, so a top-level import would bind the wrong database.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('@/lib/prisma') as typeof import('@/lib/prisma');
import {
    planWorkModeRepair,
    type PlannedWorkModeRepair,
    type WorkModeRow,
} from '@/lib/work-mode-integrity';

const APPLY = process.argv.includes('--apply');
const CHECK_ONLY = process.argv.includes('--check');
const INCLUDE_UNPUBLISHED = process.argv.includes('--all');
const CSV_PATH =
    process.argv.find((a) => a.startsWith('--csv='))?.split('=')[1] ||
    `backfill-remote-flags.${ENV}.csv`;

type JobRow = WorkModeRow;
export type PlannedRepair = PlannedWorkModeRepair;

/**
 * Pure planner: run one stored row through the fixed ingest-time derivation
 * and report the repair when the stored values differ. It lives in
 * lib/work-mode-integrity.ts (planWorkModeRepair) so the daily
 * job-posting-integrity cron runs the same check as --check (indexing audit
 * GFJ-01: drift fails loudly). Employer-declared modes stay authoritative
 * there (STRUCTURED_MODE_SOURCE_TYPES). Exported for tests.
 */
export function planRow(row: JobRow): PlannedRepair | null {
    return planWorkModeRepair(row);
}

const BATCH_SIZE = 500;

async function planAll(): Promise<{ scanned: number; repairs: PlannedRepair[] }> {
    const repairs: PlannedRepair[] = [];
    let scanned = 0;
    let cursor: string | undefined;

    for (;;) {
        const rows: JobRow[] = await prisma.job.findMany({
            where: INCLUDE_UNPUBLISHED ? {} : { isPublished: true },
            select: {
                id: true,
                title: true,
                employer: true,
                location: true,
                description: true,
                mode: true,
                isRemote: true,
                isHybrid: true,
                isPublished: true,
                sourceType: true,
            },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (rows.length === 0) break;

        for (const row of rows) {
            scanned += 1;
            const repair = planRow(row);
            if (repair) repairs.push(repair);
        }
        cursor = rows[rows.length - 1].id;
        if (rows.length < BATCH_SIZE) break;
    }

    return { scanned, repairs };
}

function csvEscape(value: string): string {
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function writeCsv(repairs: PlannedRepair[]): void {
    const header =
        'id,title,employer,location,source_type,is_published,mode_old,mode_new,is_remote_old,is_remote_new,is_hybrid_old,is_hybrid_new';
    const lines = repairs.map((r) =>
        [
            r.id,
            r.title,
            r.employer,
            r.location,
            r.sourceType,
            String(r.isPublished),
            r.oldMode ?? '',
            r.newMode ?? '',
            String(r.oldIsRemote),
            String(r.newIsRemote),
            String(r.oldIsHybrid),
            String(r.newIsHybrid),
        ]
            .map(csvEscape)
            .join(','),
    );
    writeFileSync(CSV_PATH, [header, ...lines].join('\n'), 'utf8');
}

async function main(): Promise<void> {
    const mode = CHECK_ONLY ? 'CHECK (assert only)' : APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)';
    console.log(
        `[backfill-remote-flags] env=${ENV}  mode: ${mode}  scope: ${INCLUDE_UNPUBLISHED ? 'all rows' : 'published only'}`,
    );

    const { scanned, repairs } = await planAll();
    console.log(`Scanned ${scanned} row(s); ${repairs.length} carry stale mode/remote flags.`);

    if (repairs.length === 0) {
        console.log('OK — every row already matches the fixed ingest-time derivation.');
        return;
    }

    const falseRemote = repairs.filter((r) => r.oldIsRemote && !r.newIsRemote);
    const gainedRemote = repairs.filter((r) => !r.oldIsRemote && r.newIsRemote);
    for (const r of repairs.slice(0, 40)) {
        console.log(
            `  ${r.id}  ${r.title.slice(0, 60)} @ ${r.employer.slice(0, 30)}  ` +
            `[${r.location.slice(0, 40)}]  mode ${r.oldMode ?? '∅'} → ${r.newMode ?? '∅'}  ` +
            `remote ${r.oldIsRemote} → ${r.newIsRemote}  hybrid ${r.oldIsHybrid} → ${r.newIsHybrid}`,
        );
    }
    if (repairs.length > 40) console.log(`  … and ${repairs.length - 40} more (full list in the CSV).`);
    console.log(
        `\nBreakdown: ${falseRemote.length} row(s) lose a false remote flag, ` +
        `${gainedRemote.length} gain one, ${repairs.length - falseRemote.length - gainedRemote.length} mode/hybrid-only.`,
    );

    if (!CHECK_ONLY) {
        writeCsv(repairs);
        console.log(`CSV written: ${CSV_PATH}`);
    }

    if (CHECK_ONLY) {
        console.error(`\n${repairs.length} row(s) still carry stale flags. Rerun with --apply.`);
        process.exitCode = 1;
        return;
    }

    if (!APPLY) {
        console.log('\nDRY RUN — nothing was written. Review the CSV, then rerun with --apply to commit.');
        return;
    }

    // Chunked transactions: each chunk either fully lands or fully rolls back.
    // mode, isRemote and isHybrid are rendered fields (lib/job-content-change.ts
    // RENDERED_JOB_FIELDS: the work-mode chip, the <title> and the JobPosting
    // jobLocationType), so every corrected row stamps contentChangedAt, as the
    // scripts/indexing-fixes repairs do: the sitemap lastmod moves and the
    // index-urls cron resubmits the corrected page.
    const CHUNK = 100;
    const contentChangedAt = new Date();
    let applied = 0;
    for (let i = 0; i < repairs.length; i += CHUNK) {
        const chunk = repairs.slice(i, i + CHUNK);
        await prisma.$transaction(
            chunk.map((r) =>
                prisma.job.update({
                    where: { id: r.id },
                    data: { mode: r.newMode, isRemote: r.newIsRemote, isHybrid: r.newIsHybrid, contentChangedAt },
                }),
            ),
        );
        applied += chunk.length;
        console.log(`Applied ${applied}/${repairs.length}…`);
    }

    // Self-verify: a second plan must be empty.
    const remaining = await planAll();
    if (remaining.repairs.length > 0) {
        throw new Error(
            `Post-apply verification failed: ${remaining.repairs.length} row(s) still stale.`,
        );
    }
    console.log('Verified — every row now matches the fixed derivation.');
}

if (require.main === module) {
    main()
        .catch((error: unknown) => {
            console.error('[backfill-remote-flags] failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
