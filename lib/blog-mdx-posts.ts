/**
 * Code fallback for the authored .mdx posts in content/blog/.
 *
 * WHY: the guides in content/blog/*.mdx (certification series, application
 * funnel pillars, salary guide, and the rest) are wired into
 * config/niche/content-map.ts, but they only reached readers once
 * scripts/sync-blog-to-db.ts had copied them into blog_posts. Until that
 * sync runs (the live site runs unsynced today) every one of them 404ed,
 * while the license-guide series already rendered from code.
 *
 * This module turns each .mdx file into the SAME BlogPost row the sync
 * script would write (title, body, meta description, category, publish and
 * review dates, tags as target keyword, FAQ extracted from the visible
 * "Frequently asked questions" section), so lib/blog.ts can serve it when no
 * DB row exists. A DB row always wins: a published row is an editorial
 * override, an unpublished row is an editorial takedown.
 *
 * Nothing here invents data: a file without a valid category or a publish
 * date is skipped (and logged) rather than given a made-up value.
 *
 * Server only (reads the filesystem). Parity with the sync script is pinned
 * by tests/regressions/p10-blog-mdx-fallback.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BlogPost } from '@/lib/blog';
import { BLOG_CATEGORIES, type BlogCategory } from '@/lib/blog-categories';

const MDX_BLOG_DIR = path.join(process.cwd(), 'content', 'blog');
const MDX_EXTENSION = '.mdx';

const VALID_CATEGORIES = new Set<string>(BLOG_CATEGORIES.map((c) => c.id));

type Frontmatter = Record<string, unknown>;

/** Frontmatter parser with the same semantics as scripts/sync-blog-to-db.ts. */
export function parseMdxFrontmatter(fileContent: string): { data: Frontmatter; content: string } {
    const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { data: {}, content: fileContent };

    const data: Frontmatter = {};
    for (const line of match[1].split(/\r?\n/)) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (value === 'true' || value === 'false') {
            data[key] = value === 'true';
            continue;
        }
        if (value.startsWith('[')) {
            try { data[key] = JSON.parse(value); } catch { data[key] = value; }
            continue;
        }
        data[key] = value;
    }
    return { data, content: match[2] };
}

function markdownInlineToText(md: string): string {
    return md
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

/** FAQ extraction with the same semantics as the sync script's extractFaqFromMarkdown. */
export function extractMdxFaq(markdown: string): Array<{ name: string; text: string }> | null {
    const faqHeading = markdown.match(/^##\s+Frequently asked questions\s*$/im);
    if (!faqHeading || faqHeading.index === undefined) return null;

    const after = markdown.slice(faqHeading.index + faqHeading[0].length);
    const nextH2 = after.match(/^##\s+[^#]/m);
    const section = nextH2 && nextH2.index !== undefined ? after.slice(0, nextH2.index) : after;

    const questions: Array<{ name: string; start: number }> = [];
    const qaRegex = /^###\s+(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = qaRegex.exec(section)) !== null) {
        questions.push({ name: m[1].trim(), start: m.index + m[0].length });
    }
    const faqs = questions.flatMap((q, i) => {
        const end = i + 1 < questions.length ? section.indexOf('###', q.start) : section.length;
        const text = markdownInlineToText(section.slice(q.start, end));
        return text ? [{ name: markdownInlineToText(q.name), text }] : [];
    });
    return faqs.length > 0 ? faqs : null;
}

function toIsoDate(value: unknown): string | null {
    if (typeof value !== 'string' || !value) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * Build the BlogPost row for one .mdx file, or null when the file lacks the
 * fields a row needs (a valid category and a publish date).
 */
export function mdxFileToBlogPost(fileName: string, raw: string): BlogPost | null {
    const { data, content } = parseMdxFrontmatter(raw);
    const slug = (typeof data.slug === 'string' && data.slug) || fileName.replace(MDX_EXTENSION, '');
    const category = typeof data.category === 'string' ? data.category : '';
    const publishDate = toIsoDate(data.date) ?? toIsoDate(data.lastUpdated);
    if (!VALID_CATEGORIES.has(category) || !publishDate) {
        console.error(`content/blog/${fileName}: skipped by the code fallback (needs a valid category and a date)`);
        return null;
    }
    const reviewedAt = toIsoDate(data.reviewed);
    const tags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : [];
    const body = content.trim();
    return {
        id: `mdx-${slug}`,
        title: (typeof data.title === 'string' && data.title) || slug,
        slug,
        content: body,
        meta_description: (typeof data.description === 'string' && data.description) || null,
        target_keyword: tags.length > 0 ? tags.join(', ') : null,
        category: category as BlogCategory,
        status: 'published',
        publish_date: publishDate,
        image_url: null,
        youtube_video_id: null,
        video_url: null,
        reviewed_at: reviewedAt,
        faq_json: extractMdxFaq(body),
        created_at: publishDate,
        updated_at: reviewedAt ?? publishDate,
    };
}

let cache: readonly BlogPost[] | null = null;

function loadMdxPosts(): readonly BlogPost[] {
    let files: string[];
    try {
        files = fs.readdirSync(MDX_BLOG_DIR).filter((f) => f.endsWith(MDX_EXTENSION)).sort();
    } catch (error) {
        console.error('Error reading content/blog for the MDX fallback:', error);
        return [];
    }
    const seen = new Set<string>();
    return files.flatMap((file) => {
        try {
            const post = mdxFileToBlogPost(file, fs.readFileSync(path.join(MDX_BLOG_DIR, file), 'utf-8'));
            if (!post || seen.has(post.slug)) return [];
            seen.add(post.slug);
            return [post];
        } catch (error) {
            console.error(`Error reading content/blog/${file}:`, error);
            return [];
        }
    });
}

/** Every authored .mdx post, in file-name order (callers sort by date). */
export function getAllMdxPosts(): readonly BlogPost[] {
    if (!cache) cache = loadMdxPosts();
    return cache;
}

export function getMdxPost(slug: string): BlogPost | null {
    return getAllMdxPosts().find((post) => post.slug === slug) ?? null;
}
