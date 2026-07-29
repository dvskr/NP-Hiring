/**
 * One-shot backfill: populate Job.categoryTags for every existing row.
 *
 * Run AFTER `prisma migrate deploy` adds the column. Idempotent — safe to
 * re-run; rows that already have non-empty tags are skipped unless
 * --force is passed.
 *
 * Default target: prod (.env.prod). Pass --env=local to target the
 * local DATABASE_URL instead.
 *
 * SCOPE OF THE EXPLICIT-FIELD PATH (P1 #20)
 * This script is the ONLY live caller that feeds the classifier's
 * employer-declared fields, so a `--force --apply` run is what actually
 * activates EMPLOYER_SETTING_TAGS / EMPLOYER_POPULATION_TAGS and the
 * LEGACY_SETTING_ALIASES / LEGACY_POPULATION_ALIASES maps in
 * lib/pseo/category-tagger.ts. What it can and cannot rescue:
 *   ✔ Job.setting / Job.population — read from the row, so both the
 *     pre-P1-#20 /post-job option strings and the LLM enrichment
 *     vocabulary (lib/llm-enrichment.ts:57-58) resolve to canonical tags.
 *   ✘ specialty — Job has NO specialty column. The /post-job picker's
 *     value is dropped by both create routes AND unstorable, so it can
 *     never be recovered here. Only wiring classifyJobTags() into
 *     app/api/jobs/post-free/route.ts + app/api/create-checkout/route.ts
 *     (which compute tags at insert, where the submitted value is still
 *     in hand) closes that gap. See the PENDING API WIRING block in
 *     app/post-job/page.tsx.
 * Neither create route writes Job.categoryTags either, so employer posts
 * made between backfill runs stay untagged until the next run.
 *
 * Usage:
 *   npx tsx scripts/backfill-category-tags.ts            # prod, dry-run preview first
 *   npx tsx scripts/backfill-category-tags.ts --apply    # prod, actually write
 *   npx tsx scripts/backfill-category-tags.ts --apply --force  # re-tag all rows
 *   npx tsx scripts/backfill-category-tags.ts --env=local --apply
 */
import { config as dotenvConfig } from 'dotenv';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');
const force = args.has('--force');
const env = args.has('--env=local') ? 'local' : 'prod';

if (env === 'prod') {
    dotenvConfig({ path: '.env.prod' });
    if (process.env.PROD_DATABASE_URL && !process.env.DATABASE_URL) {
        process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
    }
    if (process.env.PROD_DIRECT_URL && !process.env.DIRECT_URL) {
        process.env.DIRECT_URL = process.env.PROD_DIRECT_URL;
    }
} else {
    dotenvConfig();
}

async function main() {
    const { prisma } = await import('@/lib/prisma');
    const { classifyJobTags, CANONICAL_CATEGORY_SLUGS } = await import('@/lib/pseo/category-tagger');

    console.log(`\n=== CATEGORY TAG BACKFILL (${env}) ===`);
    console.log(`Mode: ${isApply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}${force ? ' --force (re-tag all)' : ''}\n`);

    // Pull every job; backfill is whole-table, but we stream in batches so we
    // don't OOM on large prod datasets.
    const BATCH = 500;
    let cursor: string | undefined;
    let scanned = 0;
    let written = 0;
    let skipped = 0;
    const tagFreq: Record<string, number> = {};

    while (true) {
        const rows: Array<{
            id: string;
            title: string;
            description: string;
            descriptionSummary: string | null;
            jobType: string | null;
            isRemote: boolean;
            setting: string | null;
            population: string | null;
            categoryTags: string[];
        }> = await prisma.job.findMany({
            where: force ? {} : { OR: [{ categoryTags: { isEmpty: true } }] },
            select: {
                id: true,
                title: true,
                description: true,
                descriptionSummary: true,
                jobType: true,
                isRemote: true,
                // Employer-declared / LLM-enriched structured signals. These
                // are the ONLY inputs that reach the classifier's explicit-
                // field path (EMPLOYER_SETTING_TAGS / EMPLOYER_POPULATION_TAGS
                // + the LEGACY_* alias maps) — selecting them here is what
                // makes this backfill the activation step for that path.
                // There is deliberately no `specialty` here: Job has no such
                // column (see prisma/schema.prisma `model Job`), so the
                // /post-job specialty picker can only ever be resolved at
                // insert time by the create routes, never retroactively.
                setting: true,
                population: true,
                categoryTags: true,
            },
            orderBy: { id: 'asc' },
            take: BATCH,
            ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        });
        if (rows.length === 0) break;

        for (const row of rows) {
            scanned++;
            const tags = classifyJobTags({
                title: row.title,
                description: row.description,
                descriptionSummary: row.descriptionSummary,
                jobType: row.jobType,
                isRemote: row.isRemote,
                // Explicit employer/LLM fields beat substring guessing and are
                // exempt from the mutual-exclusion pass — see classifyJobTags.
                setting: row.setting,
                population: row.population,
            });

            // Tag-frequency stats (works in dry-run too)
            for (const t of tags) tagFreq[t] = (tagFreq[t] || 0) + 1;

            // No-op when tags identical to current (sorted-array compare).
            const same =
                row.categoryTags.length === tags.length &&
                row.categoryTags.every((t, i) => t === tags[i]);
            if (same) {
                skipped++;
                continue;
            }

            if (isApply) {
                await prisma.job.update({
                    where: { id: row.id },
                    data: { categoryTags: tags },
                });
            }
            written++;
        }

        cursor = rows[rows.length - 1].id;
        if (scanned % 2000 === 0) {
            console.log(`  ... scanned=${scanned} written=${written} skipped=${skipped}`);
        }
    }

    console.log(`\nDone. scanned=${scanned}  ${isApply ? 'written' : 'would-write'}=${written}  skipped=${skipped}`);
    console.log(`\nTag distribution:`);
    for (const slug of CANONICAL_CATEGORY_SLUGS) {
        const n = tagFreq[slug] || 0;
        if (n === 0) continue;
        console.log(`  ${String(n).padStart(5)}  ${slug}`);
    }
    if (!isApply) {
        console.log(`\n(dry run — pass --apply to write)`);
    }

    await prisma.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
