import 'dotenv/config';
import { prisma } from '../lib/prisma';

async function main() {
  const total = await prisma.job.count({ where: { isPublished: true } });
  const bySource = await prisma.job.groupBy({
    by: ['sourceProvider'],
    where: { isPublished: true },
    _count: { _all: true },
  });
  const rejectedByReason = await prisma.rejectedJob.groupBy({
    by: ['rejectionReason'],
    _count: { _all: true },
    orderBy: { _count: { rejectionReason: 'desc' } },
  });
  const tagCounts = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
    SELECT unnest(category_tags) AS tag, COUNT(*) AS count
    FROM jobs WHERE is_published = true
    GROUP BY tag ORDER BY count DESC LIMIT 30
  `;

  console.log('\n=== TOTAL ===');
  console.log(`Active published: ${total}`);
  console.log('\n=== BY SOURCE ===');
  bySource.forEach(s => console.log(`  ${s.sourceProvider}: ${s._count._all}`));
  console.log('\n=== REJECTION REASONS (this run) ===');
  rejectedByReason.forEach(r => console.log(`  ${r.rejectionReason}: ${r._count._all}`));
  console.log('\n=== TAG DISTRIBUTION (top 30) ===');
  tagCounts.forEach(t => console.log(`  ${t.tag}: ${t.count}`));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
