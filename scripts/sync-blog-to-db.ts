/**
 * Sync Blog Content → Database
 *
 * Two modes:
 *   1. (default) Reads all .mdx files from content/blog/, parses
 *      frontmatter, extracts the "Frequently asked questions" section
 *      into faq_json, and inserts each post into blog_posts as
 *      'published'. Existing slugs are skipped unless --update is
 *      passed (then title/content/meta/faq are refreshed in place).
 *   2. --license-guides: generates all 51 state licensure posts from
 *      lib/blog-license-guides.ts and upserts them in a single
 *      transaction — all-or-nothing, so the DB can never hold a
 *      partial series. (Rendering never depends on this sync: lib/blog.ts
 *      falls back to the generator for license slugs with no DB row.
 *      Syncing makes the series visible to DB-reading listings such as
 *      /resources' state grid and the /blog index.)
 *
 * Usage:
 *   npx tsx scripts/sync-blog-to-db.ts [--update]
 *   npx tsx scripts/sync-blog-to-db.ts --license-guides
 */

import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import {
    getAllLicenseGuideSlugs,
    getLicenseGuidePost,
    LICENSE_GUIDE_STATES,
} from '../lib/blog-license-guides';
import { BLOG_CATEGORIES } from '../lib/blog-categories';

const connectionString = process.env.PROD_DATABASE_URL;
if (!connectionString) {
    throw new Error('PROD_DATABASE_URL must be set in .env');
}

const pool = new Pool({ connectionString, max: 3 });
const adapter = new PrismaPg(pool);
// The driver-adapter option isn't in the generated client's constructor
// type here, so it needs a cast — routed through `unknown` rather than
// `any` so the file passes `npm run lint` (no-explicit-any is an error).
const prisma = new PrismaClient(
    { adapter } as unknown as ConstructorParameters<typeof PrismaClient>[0],
);

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog');

/**
 * Valid public blog categories — DERIVED from the shared taxonomy rather
 * than mirrored by hand. lib/blog-categories.ts is import-free, so this
 * CLI script picks up the ids without dragging in the app's
 * supabase/sanitize-html graph (the reason the list used to be a literal
 * copy, which is exactly the kind of mirror that silently drifts).
 * The blog index filter pills and category colors are keyed to these
 * exact values; a post synced with any other value renders with a
 * fallback style and an unfilterable raw id, so unknown categories fail
 * the sync instead.
 */
const VALID_CATEGORIES = new Set<string>(BLOG_CATEGORIES.map((c) => c.id));

// Map legacy MDX category slugs → valid DB category values. (The previous
// map emitted three category ids that exist nowhere in the public taxonomy,
// so posts synced under them were unfilterable on /blog — every target
// below is now a real BLOG_CATEGORIES id, enforced by VALID_CATEGORIES.)
const CATEGORY_MAP: Record<string, string> = {
    'states': 'state_spotlight',
    'new-grad': 'job_seeker_attraction',
    'career': 'career_opportunities',
    'salary': 'salary_negotiation',
    'interview': 'job_seeker_attraction',
    'telehealth': 'career_opportunities',
    'remote': 'career_opportunities',
    'guide': 'job_seeker_attraction',
    'comparison': 'career_opportunities',
};

function parseFrontmatter(fileContent: string): {
    data: Record<string, unknown>;
    content: string;
} {
    const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
    const match = fileContent.match(fmRegex);
    if (!match) return { data: {}, content: fileContent };

    const raw = match[1];
    const content = match[2];
    const data: Record<string, unknown> = {};

    for (const line of raw.split(/\r?\n/)) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        // Remove surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        // Handle booleans
        if (value === 'true') { data[key] = true; continue; }
        if (value === 'false') { data[key] = false; continue; }
        // Handle arrays (simple single-line)
        if (value.startsWith('[')) {
            try { data[key] = JSON.parse(value); } catch { data[key] = value; }
            continue;
        }
        data[key] = value;
    }

    return { data, content };
}

/** Strip markdown inline syntax so FAQ answers are schema-safe plain text. */
function markdownInlineToText(md: string): string {
    return md
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label
        .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extract the "## Frequently asked questions" section into faq_json rows
 * ({ name, text }[]) — the SAME visible Q&As become the FAQPage JSON-LD
 * emitted by app/blog/[slug]/page.tsx, so schema can never diverge from
 * the on-page content (invisible FAQ markup is a spam-policy violation).
 * Returns null when the post has no FAQ section.
 */
export function extractFaqFromMarkdown(
    markdown: string,
): Array<{ name: string; text: string }> | null {
    const faqHeading = markdown.match(/^##\s+Frequently asked questions\s*$/im);
    if (!faqHeading || faqHeading.index === undefined) return null;

    const after = markdown.slice(faqHeading.index + faqHeading[0].length);
    // FAQ section ends at the next H2 (or end of document).
    const nextH2 = after.match(/^##\s+[^#]/m);
    const section = nextH2 && nextH2.index !== undefined
        ? after.slice(0, nextH2.index)
        : after;

    const faqs: Array<{ name: string; text: string }> = [];
    const qaRegex = /^###\s+(.+)$/gm;
    let m: RegExpExecArray | null;
    const questions: Array<{ name: string; start: number }> = [];
    while ((m = qaRegex.exec(section)) !== null) {
        questions.push({ name: m[1].trim(), start: m.index + m[0].length });
    }
    for (let i = 0; i < questions.length; i++) {
        const end = i + 1 < questions.length
            ? section.indexOf('###', questions[i].start)
            : section.length;
        const answer = markdownInlineToText(section.slice(questions[i].start, end));
        if (answer) {
            faqs.push({ name: markdownInlineToText(questions[i].name), text: answer });
        }
    }
    return faqs.length > 0 ? faqs : null;
}

async function syncMdxPosts(update: boolean): Promise<void> {
    const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.mdx'));
    console.log(`Found ${files.length} MDX files in ${BLOG_DIR}\n`);

    let synced = 0;
    let updated = 0;
    let skipped = 0;

    for (const file of files) {
        const filePath = path.join(BLOG_DIR, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const { data, content } = parseFrontmatter(raw);

        const slug = (data.slug as string) || file.replace('.mdx', '');
        const title = (data.title as string) || slug;
        const description = (data.description as string) || null;
        const rawCategory = (data.category as string) || '';
        const category = CATEGORY_MAP[rawCategory] || rawCategory || 'job_seeker_attraction';
        if (!VALID_CATEGORIES.has(category)) {
            throw new Error(
                `content/blog/${file}: category '${rawCategory}' does not map to a ` +
                `valid blog category (see BLOG_CATEGORIES in lib/blog.ts)`,
            );
        }
        const dateStr = (data.date as string) || (data.lastUpdated as string) || null;
        const reviewedStr = (data.reviewed as string) || null;
        const targetKeyword = (data.tags as string[])?.join(', ') || null;
        const faqJson = extractFaqFromMarkdown(content);

        const existing = await prisma.blogPost.findFirst({ where: { slug } });

        const postData = {
            title,
            content: content.trim(),
            metaDescription: description,
            targetKeyword,
            category,
            status: 'published',
            publishDate: dateStr ? new Date(dateStr) : new Date(),
            reviewedAt: reviewedStr ? new Date(reviewedStr) : null,
            // Prisma treats `undefined` as "leave this column alone", so
            // `?? undefined` on the --update path STRANDED the previous
            // faq_json: an .mdx post whose FAQ section was edited down or
            // removed kept emitting the old FAQPage JSON-LD — invisible
            // structured data that no longer matches the page (a
            // spam-policy violation, and the exact divergence the
            // extract-from-markdown design exists to prevent). DbNull
            // clears the nullable Json column instead.
            faqJson: faqJson ?? Prisma.DbNull,
        };

        if (existing) {
            if (!update) {
                console.log(`  SKIP  ${slug} (already in DB — pass --update to refresh)`);
                skipped++;
                continue;
            }
            await prisma.blogPost.update({ where: { id: existing.id }, data: postData });
            console.log(`  UPDT  ${slug} → refreshed`);
            updated++;
            continue;
        }

        await prisma.blogPost.create({ data: { slug, ...postData } });
        console.log(`  SYNC  ${slug} → published`);
        synced++;
    }

    console.log(`\nDone! Synced: ${synced}, Updated: ${updated}, Skipped: ${skipped}`);
}

/**
 * Upsert all 51 generated license guides in ONE transaction. If any
 * state fails to generate or write, nothing is committed — the DB can
 * never hold a partial series (the all-or-nothing gate the
 * LICENSE_GUIDE_SERIES_PUBLISHED flag depends on).
 */
async function syncLicenseGuides(): Promise<void> {
    const slugs = getAllLicenseGuideSlugs();
    console.log(`Generating ${slugs.length} state licensure guides (expected ${LICENSE_GUIDE_STATES.length})\n`);

    const posts = LICENSE_GUIDE_STATES.map((s) => {
        const post = getLicenseGuidePost(s.stateSlug);
        if (!post) {
            throw new Error(`License guide failed to generate for state slug '${s.stateSlug}' — aborting (all-or-nothing)`);
        }
        return post;
    });
    if (posts.length !== 51) {
        throw new Error(`Expected 51 license guides, generated ${posts.length} — aborting (all-or-nothing)`);
    }

    await prisma.$transaction(
        posts.map((post) =>
            prisma.blogPost.upsert({
                where: { slug: post.slug },
                create: {
                    title: post.title,
                    slug: post.slug,
                    content: post.content,
                    metaDescription: post.meta_description,
                    targetKeyword: post.target_keyword,
                    category: post.category,
                    status: 'published',
                    publishDate: new Date(post.publish_date!),
                    reviewedAt: new Date(post.reviewed_at!),
                    faqJson: post.faq_json ?? Prisma.DbNull,
                },
                update: {
                    title: post.title,
                    content: post.content,
                    metaDescription: post.meta_description,
                    targetKeyword: post.target_keyword,
                    category: post.category,
                    status: 'published',
                    reviewedAt: new Date(post.reviewed_at!),
                    faqJson: post.faq_json ?? Prisma.DbNull,
                },
            }),
        ),
    );

    for (const post of posts) console.log(`  UPSERT  ${post.slug}`);
    console.log(`\nDone! All ${posts.length} license guides committed atomically.`);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--license-guides')) {
        await syncLicenseGuides();
    } else {
        await syncMdxPosts(args.includes('--update'));
    }
    await prisma.$disconnect();
    await pool.end();
}

// Guard so importing extractFaqFromMarkdown doesn't hit the DB (repo
// precedent: scripts/generate-city-snippets.ts).
if (typeof require !== 'undefined' && require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}
