// Smoke test: ingest from one ATS source, audit results.
//
// Picks Lever (smallest tenant list ~73 companies, no API key needed,
// HTTP-only). Counts what was fetched/added/rejected and prints the
// first 20 added jobs so you can eyeball NP-relevance.
//
// Usage:
//   npm run smoke
//   # or with custom source:
//   npx tsx scripts/smoke-test.ts greenhouse

import 'dotenv/config';

import { prisma } from '../lib/prisma';
import { ingestJobs, type JobSource } from '../lib/ingestion-service';

async function main(): Promise<void> {
    const source = (process.argv[2] as JobSource) || 'lever';
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🔬 SMOKE TEST — single source: ${source}`);
    console.log(`${'='.repeat(70)}\n`);

    const start = Date.now();
    const results = await ingestJobs([source]);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    const r = results[0];
    if (!r) {
        console.log('No result returned. Did the source key match?');
        process.exit(1);
    }

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📊 INGESTION RESULT (${elapsed}s)`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`  Source:       ${r.source}`);
    console.log(`  Fetched:      ${r.fetched}`);
    console.log(`  Added:        ${r.added}`);
    console.log(`  Duplicates:   ${r.duplicates}`);
    console.log(`  Errors:       ${r.errors}`);
    if (r.rejectedByReason && Object.keys(r.rejectedByReason).length > 0) {
        console.log(`  Rejected by reason:`);
        for (const [reason, count] of Object.entries(r.rejectedByReason).sort((a, b) => b[1] - a[1])) {
            console.log(`    - ${reason}: ${count}`);
        }
    }
    if (r.errorsByKind && Object.keys(r.errorsByKind).length > 0) {
        console.log(`  Errors by kind:`);
        for (const [kind, count] of Object.entries(r.errorsByKind)) {
            console.log(`    - ${kind}: ${count}`);
        }
    }

    // Pull the most-recently-added jobs to eyeball
    const recent = await prisma.job.findMany({
        where: { sourceProvider: source, isPublished: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
            id: true,
            title: true,
            employer: true,
            location: true,
            categoryTags: true,
            displaySalary: true,
        },
    });

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`🔎 FIRST 20 ADDED JOBS — audit for NP relevance`);
    console.log(`${'─'.repeat(70)}`);
    if (recent.length === 0) {
        console.log('  (none — 0 jobs added by this run)');
    } else {
        recent.forEach((j, i) => {
            console.log(`\n  ${i + 1}. ${j.title}`);
            console.log(`     ${j.employer} · ${j.location}`);
            console.log(`     salary: ${j.displaySalary ?? '—'}`);
            console.log(`     tags: ${(j.categoryTags || []).join(', ') || '(none)'}`);
        });
    }

    // Overall DB stats
    const totalActive = await prisma.job.count({ where: { isPublished: true } });
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📈 DATABASE TOTAL (after this run)`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`  Active published jobs: ${totalActive}`);

    await prisma.$disconnect();
}

main().catch((err) => {
    console.error('Smoke test failed:', err);
    process.exit(1);
});
