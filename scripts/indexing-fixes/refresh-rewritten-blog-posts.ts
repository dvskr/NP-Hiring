/**
 * Indexing audit CQ-13: refresh blog_posts mirrors of the posts this fix
 * rewrote or relinked, so the live pages serve the new copy.
 *
 * WHY: lib/blog.ts serves a PUBLISHED blog_posts row in preference to the
 * content/blog/*.mdx file (editorial override). If scripts/sync-blog-to-db.ts
 * ever mirrored these posts, the old title and body (the "1099 vs W-2" and
 * "NP salary guide" versions that competed with /resources/1099-vs-w2 and
 * /salary-guide, and the comparison anchors pointing at the blog post) keep
 * serving until the rows are refreshed. With no row, the .mdx already serves
 * and nothing needs to change.
 *
 * SAFE BY DEFAULT: without --apply this only READS and prints, per slug,
 * exactly what it would change. With --apply it updates only published rows
 * whose copy differs, all in one transaction. Unpublished rows are editorial
 * takedowns and are never touched; no row is ever created.
 *
 * Usage (reviewed by the owner first; .env points at production):
 *   npx tsx scripts/indexing-fixes/refresh-rewritten-blog-posts.ts           # dry run
 *   npx tsx scripts/indexing-fixes/refresh-rewritten-blog-posts.ts --apply   # write
 */

import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { mdxFileToBlogPost } from '../../lib/blog-mdx-posts';
import type { BlogPost } from '../../lib/blog';

/** The posts CQ-13 rewrote (the first two) or relinked (the rest). */
const SLUGS = [
    'np-1099-vs-w2',
    'np-salary-guide',
    'np-salary-negotiation-guide',
    'highest-paying-np-specialties',
    'remote-telehealth-np-jobs-guide',
    'np-malpractice-insurance-guide',
    'np-ceu-requirements-by-state',
    'how-to-evaluate-np-programs',
] as const;

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog');

interface Planned {
    slug: string;
    id: string;
    post: BlogPost;
    changed: string[];
}

function codePost(slug: string): BlogPost {
    const file = `${slug}.mdx`;
    const post = mdxFileToBlogPost(file, fs.readFileSync(path.join(BLOG_DIR, file), 'utf-8'));
    if (!post) throw new Error(`content/blog/${file} did not parse; aborting before any read`);
    return post;
}

function sameJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function main(): Promise<void> {
    const apply = process.argv.includes('--apply');
    const connectionString = process.env.PROD_DATABASE_URL;
    if (!connectionString) throw new Error('PROD_DATABASE_URL must be set in .env');

    // Parse every file first, so a bad file aborts before the database is touched.
    const posts = new Map(SLUGS.map((slug) => [slug, codePost(slug)]));

    const pool = new Pool({ connectionString, max: 2 });
    const prisma = new PrismaClient(
        { adapter: new PrismaPg(pool) } as unknown as ConstructorParameters<typeof PrismaClient>[0],
    );
    try {
        const rows = await prisma.blogPost.findMany({
            where: { slug: { in: [...SLUGS] } },
            select: { id: true, slug: true, status: true, title: true, content: true, metaDescription: true, targetKeyword: true, faqJson: true, reviewedAt: true },
        });
        const bySlug = new Map(rows.map((row) => [row.slug, row]));
        const planned: Planned[] = [];

        console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${SLUGS.length} posts\n`);
        for (const slug of SLUGS) {
            const post = posts.get(slug)!;
            const row = bySlug.get(slug);
            if (!row) {
                console.log(`  NONE      ${slug}: no blog_posts row; content/blog serves the new copy already`);
                continue;
            }
            if (row.status !== 'published') {
                console.log(`  TAKEDOWN  ${slug}: row is '${row.status}'; left alone`);
                continue;
            }
            const changed = [
                row.title !== post.title ? 'title' : null,
                row.content !== post.content ? 'content' : null,
                row.metaDescription !== post.meta_description ? 'meta_description' : null,
                row.targetKeyword !== post.target_keyword ? 'target_keyword' : null,
                !sameJson(row.faqJson, post.faq_json) ? 'faq_json' : null,
                row.reviewedAt?.toISOString() !== post.reviewed_at ? 'reviewed_at' : null,
            ].filter((field): field is string => field !== null);
            if (changed.length === 0) {
                console.log(`  CURRENT   ${slug}: row already matches content/blog`);
                continue;
            }
            planned.push({ slug, id: row.id, post, changed });
            console.log(`  STALE     ${slug}: would update ${changed.join(', ')}`);
            if (changed.includes('title')) console.log(`              title: "${row.title}" -> "${post.title}"`);
            if (changed.includes('content')) console.log(`              content: ${row.content.length} -> ${post.content.length} characters`);
            if (changed.includes('reviewed_at')) console.log(`              reviewed_at: ${row.reviewedAt?.toISOString() ?? 'null'} -> ${post.reviewed_at}`);
        }

        if (planned.length === 0) {
            console.log('\nNothing to change.');
            return;
        }
        if (!apply) {
            console.log(`\nDry run only: ${planned.length} row(s) would change. Re-run with --apply to write them.`);
            return;
        }

        await prisma.$transaction(
            planned.map(({ id, post }) =>
                prisma.blogPost.update({
                    where: { id },
                    data: {
                        title: post.title,
                        content: post.content,
                        metaDescription: post.meta_description,
                        targetKeyword: post.target_keyword,
                        faqJson: post.faq_json ?? Prisma.DbNull,
                        reviewedAt: post.reviewed_at ? new Date(post.reviewed_at) : null,
                    },
                }),
            ),
        );
        for (const { slug } of planned) console.log(`  UPDATED   ${slug}`);
        console.log(`\nDone: ${planned.length} row(s) refreshed in one transaction.`);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main().catch((error: unknown) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
