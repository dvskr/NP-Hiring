/**
 * Data model, metadata and JSON-LD for the two definition guides:
 * /resources/what-is-a-nurse-practitioner and /resources/np-vs-pa.
 *
 * Not a route file. Each guide's content.ts holds all of its copy as data of
 * the shapes below, guide-view.tsx renders that data, and the builders here
 * turn the same objects into metadata and structured data. The visible FAQ
 * and the FAQPage answers are therefore one array, so they cannot drift.
 */
import type { Metadata } from 'next';
import { ldJson } from '@/app/compare/comparison-shared';
import { editorialSchemaFields } from '@/components/EditorialByline';
import { brand } from '@/config/brand';

/** A run of copy: plain text, or a link with its anchor text. */
export type Inline = string | { readonly text: string; readonly href: string };

/** A paragraph's worth of runs. */
export type Rich = readonly Inline[];

export interface LinkItem {
    readonly text: string;
    readonly href: string;
}

export interface StepItem {
    readonly title: string;
    readonly detail: Rich;
}

export interface TermItem {
    readonly term: string;
    readonly detail: Rich;
}

export interface StatItem {
    readonly value: string;
    readonly label: string;
}

export interface FocusCard {
    readonly abbreviation: string;
    readonly name: string;
    readonly focus: string;
    readonly link: LinkItem;
}

export interface TableRow {
    readonly label: string;
    readonly cells: readonly Rich[];
}

export interface ChoiceColumn {
    readonly heading: string;
    readonly items: readonly Rich[];
}

export type Block =
    | { readonly kind: 'paragraph'; readonly content: Rich }
    | { readonly kind: 'checklist'; readonly items: readonly Rich[] }
    | { readonly kind: 'steps'; readonly items: readonly StepItem[] }
    | { readonly kind: 'terms'; readonly items: readonly TermItem[] }
    | { readonly kind: 'stats'; readonly items: readonly StatItem[]; readonly caption: Rich }
    | {
          readonly kind: 'table';
          readonly caption: string;
          /** The first column labels the row headers; it renders for screen readers only. */
          readonly columns: readonly string[];
          readonly rows: readonly TableRow[];
      }
    | { readonly kind: 'cards'; readonly items: readonly FocusCard[] }
    | { readonly kind: 'links'; readonly items: readonly LinkItem[] }
    | { readonly kind: 'choices'; readonly columns: readonly ChoiceColumn[] };

export type SectionIcon =
    | 'award'
    | 'book'
    | 'compass'
    | 'graduation'
    | 'layers'
    | 'listChecks'
    | 'mapPin'
    | 'scale'
    | 'shield'
    | 'stethoscope'
    | 'trending'
    | 'wallet';

export interface GuideSection {
    readonly id: string;
    readonly heading: string;
    readonly icon: SectionIcon;
    readonly blocks: readonly Block[];
}

export interface FaqItem {
    readonly question: string;
    readonly answer: Rich;
}

export interface SourceLink {
    readonly label: string;
    readonly url: string;
    readonly note: string;
}

/**
 * A figure the copy prints that does not come from lib/stats-sources.ts,
 * with the primary source it was verified against. `text` is the figure
 * exactly as the copy prints it; `sourceUrl` must be in the page's sources.
 */
export interface VerifiedFigure {
    readonly text: string;
    readonly claim: string;
    readonly sourceUrl: string;
}

export interface RelatedLink {
    readonly href: string;
    readonly title: string;
    readonly description: string;
}

export interface GuideContent {
    /** Route path, e.g. '/resources/np-vs-pa'. */
    readonly path: string;
    readonly datePublished: string;
    readonly dateModified: string;
    /** Page part of the title; the root layout appends " | {brand.name}". */
    readonly title: string;
    readonly description: string;
    readonly keywords: readonly string[];
    readonly h1: string;
    /** Last breadcrumb label. */
    readonly crumb: string;
    /** Title printed on the /api/og share card. */
    readonly ogTitle: string;
    /** The direct answer printed first under the H1. */
    readonly quickAnswer: string;
    readonly heroTone: 'pink' | 'pinkBlue';
    readonly heroIcon: SectionIcon;
    readonly sections: readonly GuideSection[];
    readonly faqHeading: string;
    readonly faqs: readonly FaqItem[];
    readonly sources: readonly SourceLink[];
    readonly sourcesNote: string;
    readonly figures: readonly VerifiedFigure[];
    readonly related: readonly RelatedLink[];
    readonly cta: { readonly heading: string; readonly primary: LinkItem; readonly secondary: LinkItem };
}

/** The site Organization node (app/layout.tsx), by @id, for Article author and publisher. */
export const SITE_ORGANIZATION = {
    '@type': 'Organization',
    '@id': `${brand.baseUrl}/#organization`,
    name: brand.name,
    url: brand.baseUrl,
} as const;

/** The repo's JSON-LD serializer: `<` and `>` escaped so no value can close the script element. */
export const serializeJsonLd = ldJson;

/** The text of a run list, links reduced to their anchor text. */
export function plainText(rich: Rich): string {
    return rich.map((run) => (typeof run === 'string' ? run : run.text)).join('');
}

/** "November 23, 2026" from '2026-11-23', in UTC so server and reader agree. */
export function formatGuideDate(isoDate: string): string {
    return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

/** "May 2025" from a STAT_SOURCES-style '2025-05'; any other shape is returned as is. */
export function monthYear(asOf: string): string {
    const match = /^(\d{4})-(\d{2})$/.exec(asOf);
    if (!match) return asOf;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

export function canonicalUrl(guide: GuideContent): string {
    return `${brand.baseUrl}${guide.path}`;
}

/** The board's edge-rendered share card (app/api/og), absolute for JSON-LD. */
export function ogImageUrl(guide: GuideContent): string {
    return `${brand.baseUrl}/api/og?title=${encodeURIComponent(guide.ogTitle)}&type=page`;
}

export function guideMetadata(guide: GuideContent): Metadata {
    const canonical = canonicalUrl(guide);
    const image = { url: ogImageUrl(guide), width: 1200, height: 630, alt: guide.ogTitle };
    return {
        title: guide.title,
        description: guide.description,
        keywords: [...guide.keywords],
        alternates: { canonical },
        openGraph: {
            title: guide.title,
            description: guide.description,
            type: 'article',
            url: canonical,
            siteName: brand.name,
            publishedTime: guide.datePublished,
            modifiedTime: guide.dateModified,
            images: [image],
        },
        twitter: {
            card: 'summary_large_image',
            title: guide.title,
            description: guide.description,
            images: [image.url],
        },
    };
}

export function articleJsonLd(guide: GuideContent): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: guide.title,
        description: guide.description,
        image: ogImageUrl(guide),
        datePublished: guide.datePublished,
        dateModified: guide.dateModified,
        author: SITE_ORGANIZATION,
        publisher: SITE_ORGANIZATION,
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl(guide) },
        // {} while brand.editorial.author and reviewer are null, as today. A
        // real, configured author replaces the Organization author here, the
        // same as on every other guide (components/EditorialByline.tsx).
        ...editorialSchemaFields(),
    };
}

/** FAQPage from the same array the visible FAQ renders. */
export function faqPageJsonLd(faqs: readonly FaqItem[]): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map((faq) => ({
            '@type': 'Question',
            name: faq.question,
            acceptedAnswer: { '@type': 'Answer', text: plainText(faq.answer) },
        })),
    };
}

export function breadcrumbItems(guide: GuideContent): { name: string; url: string }[] {
    return [
        { name: 'Home', url: brand.baseUrl },
        { name: 'Resources', url: `${brand.baseUrl}/resources` },
        { name: guide.crumb, url: canonicalUrl(guide) },
    ];
}
