import { brand } from '@/config/brand';
import { BLOG_CATEGORIES, getPostBySlug, getPublishedPosts, type BlogPost } from '@/lib/blog';
import { logger } from '@/lib/logger';

/**
 * Keyword search over the published blog, for the AI app connector. The blog
 * pages list posts by date and category and have no search of their own, so
 * this is the one place a post is found by its words.
 *
 * The blog is three sources merged (lib/blog.ts): blog_posts, the generated
 * state license guides and the MDX posts in content/blog. getPublishedPosts
 * already merges them, so the search reads that merged list and never a
 * source of its own: a draft, or a superseded license guide row, is
 * invisible here exactly as it is on /blog.
 */

export interface ArticleSummary {
  slug: string;
  title: string;
  description: string | null;
  category: string;
  categoryLabel: string;
  /** ISO date, or null when the post carries none. */
  publishedAt: string | null;
}

export interface ArticleDetail extends ArticleSummary {
  /** The post's markdown. */
  content: string;
  reviewedAt: string | null;
}

/** More than every post the blog has; the listing's own merged read is capped well below. */
const ALL_POSTS = 5000;
/** The merged list changes when a post is published; ten minutes is fresh enough for search. */
const LIST_TTL_MS = 10 * 60 * 1000;

const CATEGORY_LABELS = new Map<string, string>(BLOG_CATEGORIES.map((c) => [c.id, c.label]));

let listCache: { posts: ArticleSummary[]; at: number } | null = null;

function toSummary(post: Pick<BlogPost, 'slug' | 'title' | 'meta_description' | 'category' | 'publish_date' | 'created_at'>): ArticleSummary {
  return {
    slug: post.slug,
    title: post.title,
    description: post.meta_description,
    category: post.category,
    categoryLabel: CATEGORY_LABELS.get(post.category) ?? 'Article',
    publishedAt: post.publish_date ?? post.created_at ?? null,
  };
}

/** Every published post, newest first (the slug breaks a tie, so pages keep one order), through the blog's own merge. */
async function publishedPosts(): Promise<ArticleSummary[]> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.posts;
  const rows = await getPublishedPosts(1, ALL_POSTS);
  const posts = rows
    .map(toSummary)
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.slug.localeCompare(b.slug));
  listCache = { posts, at: Date.now() };
  return posts;
}

/** For tests: forget the cached list. */
export function resetBlogSearchCacheForTests(): void {
  listCache = null;
}

/**
 * The site's role token and the role's name in lower case: nearly every post
 * names them, so they say nothing about which post is meant.
 */
const ROLE_WORDS: readonly string[] = [
  brand.niche.short.toLowerCase(),
  `${brand.niche.short.toLowerCase()}s`,
  ...brand.niche.descriptor.toLowerCase().split(/\s+/).flatMap((word) => [word, `${word}s`]),
];

/** Words that say nothing about a post's subject. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it',
  'me', 'my', 'of', 'on', 'or', 'should', 'the', 'to', 'what', 'when', 'which', 'with', 'you', 'your',
  ...ROLE_WORDS,
]);

/** A signed-out caller chooses the words, so the search uses the first four. */
const MAX_TERMS = 4;

export function searchTerms(query: string | null | undefined): string[] {
  const words = (query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return Array.from(new Set(words)).slice(0, MAX_TERMS);
}

function haystack(post: ArticleSummary): string {
  return `${post.title} ${post.description ?? ''}`.toLowerCase();
}

export interface ArticleSearch {
  query?: string | null;
  category?: string | null;
  limit: number;
  /** Matches to pass over before the first one returned: (page - 1) * limit. */
  offset?: number;
}

export interface ArticlePage {
  /** The page asked for. Empty when the offset is past the last match. */
  articles: ArticleSummary[];
  /** Every published post the search matches, on this page or not. */
  total: number;
}

/**
 * One page of the posts whose title or description contain every search
 * word, newest first, with how many there are in all. When no post has every
 * word, posts with any of them are returned instead, so a long question still
 * finds its nearest posts. With no usable words it is the latest posts.
 *
 * Which of the two rules applies is decided by the count, never by the page:
 * a later page of a search that matched on every word must not fall back to
 * "any word" because that page happens to be empty.
 */
export async function searchPublishedArticles(search: ArticleSearch): Promise<ArticlePage> {
  const terms = searchTerms(search.query);
  const all = await publishedPosts();
  const inSection = search.category ? all.filter((post) => post.category === search.category) : all;
  const offset = Math.max(0, search.offset ?? 0);
  const page = (found: ArticleSummary[]): ArticlePage => ({ articles: found.slice(offset, offset + search.limit), total: found.length });

  if (terms.length === 0) return page(inSection);
  const every = inSection.filter((post) => terms.every((term) => haystack(post).includes(term)));
  if (every.length > 0 || terms.length === 1) return page(every);
  return page(inSection.filter((post) => terms.some((term) => haystack(post).includes(term))));
}

export interface SectionCount {
  category: string;
  label: string;
  articles: number;
}

/** How many published posts each section of the blog holds, the largest first. Sections with none are left out. */
export async function publishedSectionCounts(): Promise<SectionCount[]> {
  const all = await publishedPosts();
  return BLOG_CATEGORIES.map((c) => ({ category: c.id, label: c.label, articles: all.filter((post) => post.category === c.id).length }))
    .filter((section) => section.articles > 0)
    .sort((a, b) => b.articles - a.articles || a.label.localeCompare(b.label));
}

/** One published post in full, by slug, from whichever source serves it on /blog. */
export async function getPublishedArticle(slug: string): Promise<ArticleDetail | null> {
  try {
    // getPostBySlug answers published posts only, from every source.
    const post = await getPostBySlug(slug);
    if (!post) return null;
    return { ...toSummary(post), content: post.content ?? '', reviewedAt: post.reviewed_at ?? null };
  } catch (error) {
    logger.error('Blog search: reading a post failed', error, { slug });
    return null;
  }
}
