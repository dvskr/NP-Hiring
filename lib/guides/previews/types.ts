/**
 * The shape of a guide preview: the copy that turns one of this board's own
 * guide pages into a page that shows part of the guide, answers the search
 * that brings a reader there and leads to the claim form or the buy button.
 *
 * Prices never live here, and neither does phase copy. The page reads the
 * price block and the action from lib/guides/phase.ts (guidePriceCopy for
 * the phase it read once per render) and every figure the store charges
 * from lib/guides/catalog.ts.
 */

/** A phrase inside a sentence that links to another page on the site. */
export interface PreviewLink {
    /** Must occur in the text it belongs to; the first occurrence is linked. */
    readonly phrase: string;
    /** Site path, starting with '/'. */
    readonly href: string;
}

export interface GuidePreviewSeo {
    /** The search title without the brand; the page adds the brand suffix only when the whole title fits in 60 characters. */
    readonly title: string;
    /** 120 to 155 characters, no price, no phase copy and no date that expires. */
    readonly description: string;
}

export interface GuidePreviewEdition {
    /** "October 2026": the edition the PDF prints on its cover. */
    readonly name: string;
    /** ISO date of the latest entry in the guide's update log. */
    readonly updated: string;
}

export interface GuidePreviewExcerpt {
    readonly heading: string;
    /** One line under the heading: which pages these are and what they cover. */
    readonly note: string;
    /**
     * The part of the guide shown on the page, in the light markup
     * lib/guides/excerpt.ts parses: "## " and "### " lines are headings, "|"
     * rows a table whose first row is the header, "- " lines a list, "1. "
     * lines a numbered list, lines between "```" fences a template kept line
     * for line, anything else a paragraph. A paragraph or list item that
     * opens with **bold** text keeps it as a run-in lead.
     */
    readonly body: string;
    /**
     * The printed pages (the "Page N of M" footer, the PDF page minus the
     * cover) the body quotes. The paid-chapter overlap check
     * (tests/lib/guides-preview-paid-overlap.test.ts) treats these pages as
     * shown and every other chapter page as sold.
     */
    readonly pages: readonly number[];
    /** After the excerpt: how much of the guide that was, and what the rest holds. */
    readonly bridge: string;
}

export interface GuideTocEntry {
    /** The chapter number; absent for front matter and the source list. */
    readonly chapter?: number;
    /** As the PDF's bookmarks print it. */
    readonly title: string;
    /** Printed page number (the PDF page minus the cover). */
    readonly page: number;
    readonly sections: readonly string[];
    /** Shown in full in the excerpt on this page. */
    readonly inExcerpt?: boolean;
}

export interface GuideKeyFigureTable {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly string[])[];
}

export interface GuideKeyFigure {
    readonly title: string;
    /** The headline number, shown large. */
    readonly figure?: string;
    readonly text: string;
    readonly link?: PreviewLink;
    readonly table?: GuideKeyFigureTable;
    /** Where the figure comes from and how old it is, printed under the card. */
    readonly source: string;
}

export interface GuideFaqItem {
    readonly question: string;
    /** Plain text: the FAQPage markup carries exactly this answer. */
    readonly answer: string;
    readonly link?: PreviewLink;
}

export interface GuidePreview {
    /** What the guide calls itself in its own pages: "report", "playbook", "guide" or "pack". */
    readonly noun: string;
    readonly seo: GuidePreviewSeo;
    readonly h1: string;
    /** The first paragraph under the H1: 2 to 4 sentences, 45 to 80 words, answering the primary search. */
    readonly intro: string;
    readonly edition: GuidePreviewEdition;
    /**
     * The page's "In short" line and its Product description, in place of the
     * catalog summary, for a guide whose catalog summary names a dated rule
     * the preview must not repeat (the telehealth playbook's prescribing
     * date). Absent, the page uses the catalog summary.
     */
    readonly summary?: string;
    /**
     * ISO date the page's content last changed, for the sitemap. Bump it with
     * each new edition of the guide or change of its preview.
     */
    readonly contentDate: string;
    readonly excerpt: GuidePreviewExcerpt;
    /** The guide's own disclaimer sentence, word for word. */
    readonly disclaimer: string;
    readonly toc: readonly GuideTocEntry[];
    readonly keyFigures: readonly GuideKeyFigure[];
    readonly faqHeading: string;
    readonly faq: readonly GuideFaqItem[];
}
