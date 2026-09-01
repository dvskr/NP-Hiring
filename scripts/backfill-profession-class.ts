/**
 * scripts/backfill-profession-class.ts — live-review fix #1 (quarantine WP),
 * the data half of the profession-classification layer.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Migration 20260821000000_add_job_profession_class added
 * `jobs.profession_class` / `jobs.profession_confidence` as NULLABLE columns
 * with NO backfill — every pre-existing row is NULL ("not yet classified"),
 * and every query-time gate deliberately lets NULL pass so the migration
 * could deploy without mass-hiding inventory. New rows are classified at
 * ingest (lib/ingestion-service.ts → lib/profession-classifier.ts).
 *
 * This script closes the gap for EXISTING rows:
 *   1. Runs the same deterministic classifier (title+description rules,
 *      no LLM, no network) over every jobs row.
 *   2. Reports the class histogram and the would-quarantine list — the
 *      known leaked populations from the 2026-08-17 live review: 6
 *      published Podiatrist rows, 207 published psychiatrist rows, the
 *      Ascend '(PA),' posting, 'Clinical Nurse Manager – CNM', 'Clinical
 *      Educator', 'Nurse Manager - Homeless Services'.
 *   3. With --apply: stamps profession_class/profession_confidence on every
 *      classifiable row, and quarantines PUBLISHED rows whose class is
 *      non-NP (pa_only / physician / other_clinical / nonclinical):
 *      is_published=false AND is_manually_unpublished=true (so the ingest
 *      renewal path can never silently revive them — see renewJob's
 *      isManuallyUnpublished guard in lib/ingestion-service.ts) plus one
 *      JobHealthCheck audit row per quarantined job. NOTHING is deleted.
 *
 * WHAT THIS SCRIPT WILL NEVER DO
 * ──────────────────────────────
 *   • Touch the publish state of NULL-class (unclassifiable) rows or of
 *     NP/APRN rows — quarantine applies ONLY to confident non-NP classes.
 *     The ingest-time confidence floor is deliberately NOT applied here:
 *     mass-unpublishing existing inventory on low confidence would be the
 *     exact deploy hazard the migration was designed to avoid.
 *   • Delete rows, touch expiry, or rewrite any other column.
 *   • Run from CI, cron, or postinstall — a human runs it, twice
 *     (dry-run, review, then --apply).
 *
 * SAFETY / IDEMPOTENCY (mirrors scripts/repair-city-slug-diacritics-db.ts)
 * ────────────────────────────────────────────────────────────────────────
 *   • Dry run by DEFAULT. Nothing is written without --apply.
 *   • --check is the assert-only CI shape: exit 1 while any published row
 *     still classifies as a non-NP profession.
 *   • Re-running after --apply finds zero pending changes and exits 0.
 *   • Batched cursor scan (500 rows/page) + batched writes, so the run is
 *     safe on the full catalog.
 *
 * RUN (a human runs this; review the dry-run list before --apply)
 * ───────────────────────────────────────────────────────────────
 *   # 1. dry run against PROD — histogram + full quarantine CSV, writes nothing
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/backfill-profession-class.ts --env=prod
 *
 *   # 2. same, but stamp classes + quarantine non-NP published rows
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/backfill-profession-class.ts --env=prod --apply
 *
 *   # assert-only (exit 1 while any published non-NP row survives)
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/backfill-profession-class.ts --env=prod --check
 *
 * Swap --env=prod for --env=dev to target the local database. Default is
 * prod because the default MODE is a dry run (same rationale as the
 * repair-city-slug script). Genuinely ambiguous dual-role titles
 * ('Psychiatrist/PMHNP') classify np_eligible and are never auto-quarantined;
 * anything in the CSV you disagree with is a classifier-rule conversation,
 * not a reason to hand-edit the database.
 */
import { config as dotenvConfig } from 'dotenv';

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
    classifyProfession,
    NON_NP_PROFESSION_CLASSES,
    PROFESSION_CLASSIFIER_VERSION,
    type ProfessionClass,
} from '@/lib/profession-classifier';

const APPLY = process.argv.includes('--apply');
const CHECK_ONLY = process.argv.includes('--check');

const SCAN_PAGE_SIZE = 500;
const WRITE_BATCH_SIZE = 100;

const NON_NP_SET: ReadonlySet<ProfessionClass> = new Set(NON_NP_PROFESSION_CLASSES);

// ─── planning ───────────────────────────────────────────────────────────────

interface PlannedRow {
    readonly id: string;
    readonly title: string;
    readonly employer: string | null;
    readonly sourceProvider: string | null;
    readonly isPublished: boolean;
    readonly professionClass: ProfessionClass | null;
    readonly confidence: number;
    readonly rule: string;
    /** Class/confidence differs from what is stored → needs a stamp write. */
    readonly needsStamp: boolean;
    /** Published + non-NP class → unpublish with audit row. */
    readonly quarantine: boolean;
}

interface ScanResult {
    readonly scanned: number;
    readonly histogram: Map<string, { published: number; unpublished: number }>;
    readonly stamps: PlannedRow[];
    readonly quarantines: PlannedRow[];
    readonly unclassified: number;
}

async function scanAll(): Promise<ScanResult> {
    const histogram = new Map<string, { published: number; unpublished: number }>();
    const stamps: PlannedRow[] = [];
    const quarantines: PlannedRow[] = [];
    let scanned = 0;
    let unclassified = 0;
    let cursor: string | null = null;

    for (;;) {
        const page: Array<{
            id: string;
            title: string;
            description: string;
            employer: string | null;
            sourceProvider: string | null;
            isPublished: boolean;
            professionClass: string | null;
            professionConfidence: number | null;
        }> = await prisma.job.findMany({
            take: SCAN_PAGE_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: 'asc' },
            select: {
                id: true,
                title: true,
                description: true,
                employer: true,
                sourceProvider: true,
                isPublished: true,
                professionClass: true,
                professionConfidence: true,
            },
        });
        if (page.length === 0) break;
        cursor = page[page.length - 1].id;

        for (const row of page) {
            scanned++;
            const result = classifyProfession(row.title, row.description ?? '');
            const cls = result.professionClass;

            const key = cls ?? 'NULL (unclassified)';
            const bucket = histogram.get(key) ?? { published: 0, unpublished: 0 };
            histogram.set(key, {
                published: bucket.published + (row.isPublished ? 1 : 0),
                unpublished: bucket.unpublished + (row.isPublished ? 0 : 1),
            });
            if (cls === null) {
                unclassified++;
                continue; // never stamp or quarantine an unclassifiable row
            }

            const quarantine = row.isPublished && NON_NP_SET.has(cls);
            const needsStamp =
                row.professionClass !== cls || row.professionConfidence !== result.confidence;
            if (!needsStamp && !quarantine) continue;

            const planned: PlannedRow = {
                id: row.id,
                title: row.title,
                employer: row.employer,
                sourceProvider: row.sourceProvider,
                isPublished: row.isPublished,
                professionClass: cls,
                confidence: result.confidence,
                rule: result.rule,
                needsStamp,
                quarantine,
            };
            if (needsStamp) stamps.push(planned);
            if (quarantine) quarantines.push(planned);
        }
    }

    return { scanned, histogram, stamps, quarantines, unclassified };
}

// ─── reporting ──────────────────────────────────────────────────────────────

function csvEscape(value: string | null): string {
    const s = value ?? '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function printReport(result: ScanResult): void {
    console.log(`Scanned ${result.scanned} jobs rows.\n`);

    console.log('Class histogram (computed by the current classifier):');
    const keys = [...result.histogram.keys()].sort();
    for (const key of keys) {
        const b = result.histogram.get(key)!;
        console.log(
            `  ${key.padEnd(22)} published=${String(b.published).padStart(5)}  unpublished=${String(b.unpublished).padStart(5)}`,
        );
    }
    console.log(`\n${result.stamps.length} row(s) need a class/confidence stamp.`);
    console.log(
        `${result.quarantines.length} PUBLISHED row(s) classify as a non-NP profession and would be quarantined ` +
        '(is_published=false, is_manually_unpublished=true, audit row — never deleted).',
    );
    console.log(`${result.unclassified} row(s) are unclassifiable (stay NULL, publish state untouched).\n`);

    if (result.quarantines.length > 0) {
        console.log('Quarantine candidates (CSV — review before --apply):');
        console.log('id,title,employer,source,class,confidence,rule');
        for (const row of result.quarantines) {
            console.log(
                [
                    row.id,
                    csvEscape(row.title),
                    csvEscape(row.employer),
                    csvEscape(row.sourceProvider),
                    row.professionClass,
                    String(row.confidence),
                    row.rule,
                ].join(','),
            );
        }
        console.log('');
    }
}

// ─── apply ──────────────────────────────────────────────────────────────────

async function applyChanges(result: ScanResult): Promise<void> {
    const quarantineIds = new Set(result.quarantines.map((r) => r.id));

    // 1. Stamp classes/confidence (and the quarantine flip in the same write
    //    for quarantined rows — one UPDATE per row, batched transactions).
    const allWrites = new Map<string, PlannedRow>();
    for (const row of result.stamps) allWrites.set(row.id, row);
    for (const row of result.quarantines) allWrites.set(row.id, row);
    const writeRows = [...allWrites.values()];

    let written = 0;
    for (let i = 0; i < writeRows.length; i += WRITE_BATCH_SIZE) {
        const batch = writeRows.slice(i, i + WRITE_BATCH_SIZE);
        await prisma.$transaction(
            batch.map((row) =>
                prisma.job.update({
                    where: { id: row.id },
                    data: {
                        professionClass: row.professionClass!,
                        professionConfidence: row.confidence,
                        ...(quarantineIds.has(row.id)
                            ? { isPublished: false, isManuallyUnpublished: true }
                            : {}),
                    },
                }),
            ),
        );
        written += batch.length;
        console.log(`  …stamped ${written}/${writeRows.length}`);
    }

    // 2. Audit rows for every quarantined job — same append-only table the
    //    dead-link/expiry unpublish paths write, so "why is this job hidden?"
    //    has one answer surface. createMany in batches; non-unique, no upsert
    //    needed (a re-run quarantines nothing the second time, so no dupes).
    for (let i = 0; i < result.quarantines.length; i += WRITE_BATCH_SIZE) {
        const batch = result.quarantines.slice(i, i + WRITE_BATCH_SIZE);
        await prisma.jobHealthCheck.createMany({
            data: batch.map((row) => ({
                jobId: row.id,
                checkType: 'profession_class',
                outcome: 'profession_quarantined_backfill',
                // The listing is alive at the source; this is an editorial
                // out-of-scope quarantine, not a dead-link kill.
                alive: true,
                errorMessage: `class=${row.professionClass} confidence=${row.confidence} rule=${row.rule}`,
                checkerVersion: PROFESSION_CLASSIFIER_VERSION,
            })),
        });
    }

    console.log(
        `\nApplied: ${writeRows.length} row(s) stamped, ${result.quarantines.length} quarantined ` +
        `(${result.quarantines.length} audit rows written).`,
    );
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const mode = CHECK_ONLY ? 'CHECK (assert only)' : APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)';
    console.log(`[backfill-profession-class] env=${ENV}  mode: ${mode}`);
    console.log(`classifier: ${PROFESSION_CLASSIFIER_VERSION}\n`);

    const result = await scanAll();
    printReport(result);

    if (CHECK_ONLY) {
        if (result.quarantines.length > 0) {
            console.error(
                `${result.quarantines.length} published row(s) still classify as a non-NP profession. Rerun with --apply.`,
            );
            process.exitCode = 1;
        } else {
            console.log('OK — no published row classifies as a non-NP profession.');
        }
        return;
    }

    if (!APPLY) {
        console.log('DRY RUN — nothing was written. Rerun with --apply to commit.');
        return;
    }

    await applyChanges(result);

    // Self-verify: a second scan must find zero pending quarantines and zero
    // pending stamps.
    const after = await scanAll();
    if (after.quarantines.length > 0 || after.stamps.length > 0) {
        throw new Error(
            `Post-apply verification failed: ${after.quarantines.length} quarantine(s) / ` +
            `${after.stamps.length} stamp(s) still pending.`,
        );
    }
    console.log('Verified — no published non-NP row and no unstamped classifiable row remains.');
}

if (require.main === module) {
    main()
        .catch((error: unknown) => {
            console.error('[backfill-profession-class] failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
