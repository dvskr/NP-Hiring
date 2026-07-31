/**
 * scripts/repair-city-slug-diacritics-db.ts — P4, the DB half of P3 #9
 *
 * WHY THIS EXISTS
 * ───────────────
 * scripts/repair-city-slug-diacritics.ts repaired three diacritic-garbled slugs
 * in lib/pseo/city-data/cities.ts (the dataset half), and next.config.ts carries
 * the matching 301s (the URL half):
 *
 *   La Cañada Flintridge, CA   la-caada-flintridge-ca → la-canada-flintridge-ca
 *   Cañon City, CO             caon-co                → canon-city-co
 *   Española, NM               espaola-nm             → espanola-nm
 *
 * Three DATABASE columns are still keyed on the OLD strings and were out of that
 * change's scope:
 *
 *   PseoStats.locationSlug        written as `locationSlug: city.slug`
 *                                 (app/api/cron/aggregate-pseo/route.ts, the
 *                                 'category-city' upsert)
 *   CitySnippet.citySlug          human-approved editorial for /jobs/city/<slug>
 *   CategoryCitySnippet.citySlug  human-approved editorial for the
 *                                 category×city pages
 *
 * BLAST RADIUS — read this before deciding urgency
 * ────────────────────────────────────────────────
 * This is NOT a "sitemap advertises 410s" bug. Both consumers skip slugs that
 * are absent from the dataset before emitting anything:
 *   • app/api/sitemaps/cities/[batch]/route.ts looks each locationSlug up in
 *     CITY_POPULATION_LOOKUP and `continue`s when it is missing, so the retired
 *     slugs are never submitted.
 *   • the page templates read snippets by the CURRENT slug, so a row filed under
 *     the old slug is simply never found.
 * The real consequence is narrower: these three cities drop out of the sitemap
 * and lose any approved snippet until the aggregator rewrites a fresh row under
 * the new slug (at which point the old rows become permanent dead weight, and
 * the approved snippet bodies are gone for good unless they are renamed first).
 * Renaming is therefore worth doing, and worth doing BEFORE the next
 * aggregate-pseo run — but nothing is on fire.
 *
 * SAFETY / IDEMPOTENCY
 * ────────────────────
 *   • Dry run by DEFAULT. Nothing is written without --apply.
 *   • The rename table is validated against the live dataset before any query:
 *     every `to` slug must resolve through getCityBySlug and every `from` slug
 *     must NOT. A typo cannot rename a row onto a slug that does not exist.
 *   • Every target table has a uniqueness constraint on the slug
 *     (PseoStats @@unique([type, categorySlug, locationSlug]);
 *      CitySnippet.citySlug @unique;
 *      CategoryCitySnippet @@unique([categorySlug, citySlug])). When a row
 *     ALREADY exists under the new slug, the old row is SUPERSEDED — it is
 *     reported and skipped, never deleted, and never renamed over the top of
 *     live data. Cleaning superseded rows is a separate, human decision.
 *   • Re-running finds zero old-slug rows and exits 0. Safe to run twice.
 *   • No schema change: this is a data rename, not a Prisma migration.
 *
 * RUN (a human runs this; it is not wired into CI or any cron)
 * ───────────────────────────────────────────────────────────
 *   # 1. dry run against PROD — prints exactly what would change, writes nothing
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/repair-city-slug-diacritics-db.ts --env=prod
 *
 *   # 2. same, but commit the renames
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/repair-city-slug-diacritics-db.ts --env=prod --apply
 *
 *   # assert-only (exit 1 while any old-slug row survives) — the CI shape,
 *   # mirroring the --check flag on scripts/repair-city-slug-diacritics.ts
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/repair-city-slug-diacritics-db.ts --env=prod --check
 *
 * Swap --env=prod for --env=dev to target the local database. --env selection
 * mirrors scripts/check-schema.ts and scripts/backfill-missing-state-region.ts:
 * prod reads .env.prod and promotes PROD_DATABASE_URL / PROD_DIRECT_URL.
 * The default is prod, because the dev database usually holds stale fixtures —
 * which is exactly why the default MODE is a dry run.
 */
import { config as dotenvConfig } from 'dotenv';

// ─── env selection (mirrors scripts/backfill-missing-state-region.ts) ────────

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
import type { Prisma } from '@prisma/client';
import { getCityBySlug } from '@/lib/pseo/city-data/cities';

const APPLY = process.argv.includes('--apply');
const CHECK_ONLY = process.argv.includes('--check');

// ─── the rename table ───────────────────────────────────────────────────────

export interface SlugRename {
    /** The garbled slug the dead generator produced and the DB still holds. */
    readonly from: string;
    /** The folded slug now shipping in lib/pseo/city-data/cities.ts. */
    readonly to: string;
    /** Human label for the log — the city this row is about. */
    readonly label: string;
}

/**
 * Frozen, deliberately explicit — three known strings, not a re-derivation.
 *
 * Recomputing `from` would mean re-implementing the BROKEN generator (which
 * deleted non-ASCII characters instead of folding them), and shipping a second
 * copy of a bug in order to undo it is worse than writing the three strings
 * down. The pairs are the same ones pinned by
 * tests/regressions/p3-city-slug-integrity.test.ts and redirected in
 * next.config.ts; assertRenamesMatchDataset below re-checks both halves against
 * the live dataset on every run, so a stale table fails loudly instead of
 * renaming rows onto a slug that does not exist.
 */
export const SLUG_RENAMES: readonly SlugRename[] = [
    { label: 'La Cañada Flintridge, CA', from: 'la-caada-flintridge-ca', to: 'la-canada-flintridge-ca' },
    { label: 'Cañon City, CO', from: 'caon-co', to: 'canon-city-co' },
    { label: 'Española, NM', from: 'espaola-nm', to: 'espanola-nm' },
];

/**
 * Fail before touching the database if the table has drifted from the dataset:
 * the new slug must be a real city and the old slug must be genuinely retired.
 */
export function assertRenamesMatchDataset(
    renames: readonly SlugRename[] = SLUG_RENAMES,
    lookup: (slug: string) => unknown = getCityBySlug,
): void {
    for (const { label, from, to } of renames) {
        if (!lookup(to)) {
            throw new Error(
                `Rename target "${to}" (${label}) is not in lib/pseo/city-data/cities.ts. ` +
                'Refusing to rename rows onto a slug no route can resolve.',
            );
        }
        if (lookup(from)) {
            throw new Error(
                `Rename source "${from}" (${label}) is STILL a live dataset slug. ` +
                'The dataset repair was reverted or this table is stale — resolve before running.',
            );
        }
    }
}

// ─── planning ───────────────────────────────────────────────────────────────

type Action = 'rename' | 'superseded';

export interface PlannedChange {
    readonly table: string;
    readonly action: Action;
    /** Row identity for the log — enough for a human to find it again. */
    readonly key: string;
    readonly from: string;
    readonly to: string;
    /**
     * Applied only for action === 'rename'. Typed as a PrismaPromise so the
     * whole batch can go through prisma.$transaction() unchanged.
     */
    readonly apply: () => Prisma.PrismaPromise<unknown>;
}

const SUPERSEDED_NOTE =
    'a row already exists under the new slug — skipping (the aggregator has ' +
    'already rewritten this one; the old row is dead weight, deleting it is a ' +
    'separate decision)';

async function planPseoStats(rename: SlugRename): Promise<PlannedChange[]> {
    const rows = await prisma.pseoStats.findMany({
        where: { locationSlug: rename.from },
        select: { id: true, type: true, categorySlug: true },
    });

    const changes: PlannedChange[] = [];
    for (const row of rows) {
        const collision = await prisma.pseoStats.findUnique({
            where: {
                type_categorySlug_locationSlug: {
                    type: row.type,
                    categorySlug: row.categorySlug,
                    locationSlug: rename.to,
                },
            },
            select: { id: true },
        });
        changes.push({
            table: 'PseoStats.locationSlug',
            action: collision ? 'superseded' : 'rename',
            key: `${row.type} × ${row.categorySlug}`,
            from: rename.from,
            to: rename.to,
            apply: () =>
                prisma.pseoStats.update({
                    where: { id: row.id },
                    data: { locationSlug: rename.to },
                }),
        });
    }
    return changes;
}

async function planCitySnippets(rename: SlugRename): Promise<PlannedChange[]> {
    const row = await prisma.citySnippet.findUnique({
        where: { citySlug: rename.from },
        select: { id: true, approvedAt: true },
    });
    if (!row) return [];

    const collision = await prisma.citySnippet.findUnique({
        where: { citySlug: rename.to },
        select: { id: true },
    });
    return [{
        table: 'CitySnippet.citySlug',
        action: collision ? 'superseded' : 'rename',
        key: row.approvedAt ? 'approved' : 'unapproved',
        from: rename.from,
        to: rename.to,
        apply: () =>
            prisma.citySnippet.update({
                where: { id: row.id },
                data: { citySlug: rename.to },
            }),
    }];
}

async function planCategoryCitySnippets(rename: SlugRename): Promise<PlannedChange[]> {
    const rows = await prisma.categoryCitySnippet.findMany({
        where: { citySlug: rename.from },
        select: { id: true, categorySlug: true, approvedAt: true },
    });

    const changes: PlannedChange[] = [];
    for (const row of rows) {
        const collision = await prisma.categoryCitySnippet.findUnique({
            where: {
                categorySlug_citySlug: {
                    categorySlug: row.categorySlug,
                    citySlug: rename.to,
                },
            },
            select: { id: true },
        });
        changes.push({
            table: 'CategoryCitySnippet.citySlug',
            action: collision ? 'superseded' : 'rename',
            key: `${row.categorySlug} (${row.approvedAt ? 'approved' : 'unapproved'})`,
            from: rename.from,
            to: rename.to,
            apply: () =>
                prisma.categoryCitySnippet.update({
                    where: { id: row.id },
                    data: { citySlug: rename.to },
                }),
        });
    }
    return changes;
}

export async function planAll(): Promise<PlannedChange[]> {
    const changes: PlannedChange[] = [];
    for (const rename of SLUG_RENAMES) {
        changes.push(
            ...(await planPseoStats(rename)),
            ...(await planCitySnippets(rename)),
            ...(await planCategoryCitySnippets(rename)),
        );
    }
    return changes;
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    assertRenamesMatchDataset();

    const mode = CHECK_ONLY ? 'CHECK (assert only)' : APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)';
    console.log(`[repair-city-slug-diacritics-db] env=${ENV}  mode: ${mode}`);
    console.log(
        `Renames: ${SLUG_RENAMES.map((r) => `${r.from} → ${r.to}`).join(', ')}\n`,
    );

    const changes = await planAll();

    if (changes.length === 0) {
        console.log('OK — no row in PseoStats, CitySnippet or CategoryCitySnippet still uses a retired slug.');
        return;
    }

    const renames = changes.filter((c) => c.action === 'rename');
    const superseded = changes.filter((c) => c.action === 'superseded');

    for (const change of changes) {
        const suffix = change.action === 'superseded' ? `  [SKIP: ${SUPERSEDED_NOTE}]` : '';
        console.log(`  ${change.table}  ${change.key}: ${change.from} → ${change.to}${suffix}`);
    }
    console.log(`\n${renames.length} row(s) to rename, ${superseded.length} superseded.`);

    if (CHECK_ONLY) {
        console.error(
            `\n${changes.length} row(s) still keyed on a retired city slug. Rerun with --apply.`,
        );
        process.exitCode = 1;
        return;
    }

    if (!APPLY) {
        console.log('\nDRY RUN — nothing was written. Rerun with --apply to commit.');
        return;
    }

    // One transaction: either every rename lands or none does. The row counts
    // here are tiny (three cities), so there is no batching concern.
    await prisma.$transaction(renames.map((change) => change.apply()));
    console.log(`\nApplied ${renames.length} rename(s).`);

    // Self-verify: a second plan must contain nothing but the superseded rows.
    const remaining = (await planAll()).filter((c) => c.action === 'rename');
    if (remaining.length > 0) {
        throw new Error(
            `Post-apply verification failed: ${remaining.length} row(s) still carry a retired slug.`,
        );
    }
    console.log('Verified — no renameable row still carries a retired slug.');
    if (superseded.length > 0) {
        console.log(
            `${superseded.length} superseded row(s) were left in place on purpose. ` +
            'Review them by hand before deleting anything.',
        );
    }
}

if (require.main === module) {
    main()
        .catch((error: unknown) => {
            console.error('[repair-city-slug-diacritics-db] failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
