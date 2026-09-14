/**
 * scripts/backfill-exclusive-work-mode-flags.ts
 *
 * WHY THIS EXISTS
 * ───────────────
 * Two data defects in already-ingested rows, both now prevented at ingest in
 * lib/ingestion-service.ts:
 *
 *   1. isRemote AND isHybrid both true. The inline LLM merge (and the
 *      enrich-jobs cron's copy of it) set isHybrid=true without clearing a
 *      stale isRemote, so the job counted under both work-mode facets on
 *      /jobs (remote + hybrid + onsite > total). Repaired through
 *      planExclusiveWorkModeRepair.
 *   2. Multi-state postings stored one row per licensure state, titled
 *      "... PMHNP — Remote | ... | District of Columbia" while located at the
 *      employer HQ. Titles are rewritten through normalizeIngestedTitle (no
 *      em/en dashes, trailing jurisdiction segment removed); once they share a
 *      title+employer+location identity key, every copy except the oldest
 *      published row is unpublished so the catalog lists the posting once.
 *
 * SAFETY
 * ──────
 *   • Dry run by DEFAULT; nothing is written without --apply.
 *   • --check exits 1 while stale rows remain and writes nothing.
 *   • Only external (aggregated) rows get title rewrites or collapsing;
 *     employer-authored titles are never touched.
 *   • Rows an admin manually unpublished are left alone. Slugs are not
 *     changed, so existing job URLs keep resolving.
 *   • Re-running after --apply plans zero changes.
 *
 * RUN (dev first; a human runs this, it is not wired into any cron)
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/backfill-exclusive-work-mode-flags.ts --env=dev
 *   ... --env=prod            (dry run, review output)
 *   ... --env=prod --apply    (HUMAN-GATED)
 */
import { config as dotenvConfig } from 'dotenv';

type EnvKind = 'dev' | 'prod';

function parseEnvFlag(): EnvKind {
    const flag = process.argv.find((a) => a.startsWith('--env='))?.split('=')[1];
    if (flag === 'dev' || flag === 'prod') return flag;
    return 'dev';
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

// Required AFTER the env is selected: the Prisma client binds DATABASE_URL at
// construction time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('@/lib/prisma') as typeof import('@/lib/prisma');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ingestion = require('@/lib/ingestion-service') as typeof import('@/lib/ingestion-service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildJobIdentityKey } = require('@/lib/deduplicator') as typeof import('@/lib/deduplicator');

const APPLY = process.argv.includes('--apply');
const CHECK_ONLY = process.argv.includes('--check');
const BATCH_SIZE = 500;
const WRITE_CHUNK = 100;

interface Row {
    readonly id: string;
    readonly title: string;
    readonly employer: string;
    readonly location: string;
    readonly mode: string | null;
    readonly isRemote: boolean;
    readonly isHybrid: boolean;
    readonly isPublished: boolean;
    readonly isManuallyUnpublished: boolean;
    readonly sourceType: string | null;
    readonly createdAt: Date;
}

interface Update {
    readonly id: string;
    readonly data: Record<string, unknown>;
    readonly note: string;
}

async function loadRows(): Promise<Row[]> {
    const rows: Row[] = [];
    let cursor: string | undefined;
    for (;;) {
        const page: Row[] = await prisma.job.findMany({
            select: {
                id: true, title: true, employer: true, location: true, mode: true,
                isRemote: true, isHybrid: true, isPublished: true,
                isManuallyUnpublished: true, sourceType: true, createdAt: true,
            },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        rows.push(...page);
        if (page.length < BATCH_SIZE) break;
        cursor = page[page.length - 1].id;
    }
    return rows;
}

function plan(rows: readonly Row[]): Update[] {
    const updates = new Map<string, { data: Record<string, unknown>; notes: string[] }>();
    const add = (id: string, data: Record<string, unknown>, note: string) => {
        const prev = updates.get(id) ?? { data: {}, notes: [] };
        updates.set(id, { data: { ...prev.data, ...data }, notes: [...prev.notes, note] });
    };

    const groups = new Map<string, Row[]>();
    for (const row of rows) {
        const flags = ingestion.planExclusiveWorkModeRepair(row);
        if (flags) add(row.id, flags, `flags remote+hybrid -> remote=${flags.isRemote} hybrid=${flags.isHybrid}`);

        if (row.sourceType === 'employer' || row.sourceType === 'direct') continue;
        const title = ingestion.normalizeIngestedTitle(row.title);
        if (title !== row.title) add(row.id, { title }, `title "${row.title}" -> "${title}"`);

        if (!row.isPublished || row.isManuallyUnpublished || !row.employer || !row.location) continue;
        const key = buildJobIdentityKey(title, row.employer, row.location);
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    for (const members of groups.values()) {
        // Only collapse groups the title rewrite created; pre-existing exact
        // duplicates are the dedup cron's business, not this repair's.
        if (members.length < 2 || !members.some((m) => updates.get(m.id)?.data.title !== undefined)) continue;
        const ordered = [...members].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        for (const extra of ordered.slice(1)) {
            add(extra.id, { isPublished: false }, `unpublished: per-state copy of ${ordered[0].id}`);
        }
    }

    return [...updates.entries()].map(([id, u]) => ({ id, data: u.data, note: u.notes.join('; ') }));
}

async function main(): Promise<void> {
    const runMode = CHECK_ONLY ? 'CHECK' : APPLY ? 'APPLY' : 'DRY RUN';
    console.log(`[backfill-exclusive-work-mode-flags] env=${ENV} mode=${runMode}`);
    const rows = await loadRows();
    const updates = plan(rows);
    console.log(`Scanned ${rows.length} row(s); ${updates.length} need repair.`);
    for (const u of updates.slice(0, 50)) console.log(`  ${u.id}  ${u.note}`);
    if (updates.length > 50) console.log(`  and ${updates.length - 50} more`);

    if (updates.length === 0) return;
    if (CHECK_ONLY) {
        process.exitCode = 1;
        return;
    }
    if (!APPLY) {
        console.log('DRY RUN: nothing written. Rerun with --apply to commit.');
        return;
    }

    for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
        const chunk = updates.slice(i, i + WRITE_CHUNK);
        await prisma.$transaction(chunk.map((u) => prisma.job.update({ where: { id: u.id }, data: u.data })));
        console.log(`Applied ${Math.min(i + WRITE_CHUNK, updates.length)}/${updates.length}`);
    }

    const remaining = plan(await loadRows());
    if (remaining.length > 0) {
        throw new Error(`Post-apply verification failed: ${remaining.length} row(s) still need repair.`);
    }
    console.log('Verified: no stale rows remain.');
}

if (require.main === module) {
    main()
        .catch((error: unknown) => {
            console.error('[backfill-exclusive-work-mode-flags] failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
