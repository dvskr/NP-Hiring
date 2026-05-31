/**
 * Backfill / re-tag Job.categoryTags using the CURRENT classifier.
 *
 * Why: categoryTags is computed at ingest by lib/job-normalizer.ts via
 * classifyJobTags(). When the classifier RULES change (e.g. the remote rule
 * gaining matchDescription:false), existing rows keep their STALE tags until
 * re-run. This script re-classifies every job with the live classifier and
 * writes back only the rows whose tag set actually changed.
 *
 * It passes the exact same fields the normalizer feeds classifyJobTags, so the
 * result is identical to what a fresh ingest would produce — no drift.
 *
 * Usage:
 *   npx tsx scripts/backfill-category-tags.ts            # DRY RUN (preview)
 *   npx tsx scripts/backfill-category-tags.ts --apply    # write changes
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { classifyJobTags } from '../lib/pseo/category-tagger';

async function main() {
    const apply = process.argv.includes('--apply');

    const jobs = await prisma.job.findMany({
        select: {
            id: true,
            title: true,
            description: true,
            descriptionSummary: true,
            jobType: true,
            isRemote: true,
            setting: true,
            population: true,
            categoryTags: true,
        },
    });

    console.log(`Scanning ${jobs.length} jobs (${apply ? 'APPLY' : 'DRY RUN'})...`);

    let changed = 0;
    const sample: { id: string; title: string; removed: string; added: string }[] = [];

    for (const j of jobs) {
        const tags = classifyJobTags({
            title: j.title,
            description: j.description,
            descriptionSummary: j.descriptionSummary,
            jobType: j.jobType,
            isRemote: j.isRemote,
            setting: j.setting,
            population: j.population,
        });

        const before = new Set(j.categoryTags ?? []);
        const after = new Set(tags);
        const removed = [...before].filter((t) => !after.has(t));
        const added = [...after].filter((t) => !before.has(t));

        if (removed.length === 0 && added.length === 0) continue;

        changed++;
        if (sample.length < 15) {
            sample.push({
                id: j.id.slice(0, 8),
                title: j.title.slice(0, 34),
                removed: removed.join(',') || '—',
                added: added.join(',') || '—',
            });
        }

        if (apply) {
            await prisma.job.update({
                where: { id: j.id },
                data: { categoryTags: tags },
            });
        }
    }

    console.log(`\nJobs needing re-tag: ${changed}/${jobs.length}`);
    if (sample.length > 0) console.table(sample);

    if (!apply) {
        console.log('\nDRY RUN — re-run with --apply to write the changes above.');
    } else {
        console.log(`\n✅ Re-tagged ${changed} jobs.`);
    }

    await prisma.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
