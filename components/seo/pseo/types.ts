/**
 * Shared prop shapes for the pSEO data sections (components/seo/pseo/*).
 *
 * Every link a section renders is typed as a LinkTarget: the href AND the
 * result of the target page's render gate (lib/pseo/render-gate.ts). A
 * section never decides on its own whether a page exists; it renders plain
 * text whenever `renders` is false, so a caller cannot link a URL that
 * would 404 or 410 without lying in the prop.
 */
export interface LinkTarget {
  href: string;
  /** The target's render-gate result. False renders the label as plain text. */
  renders: boolean;
}

/** The href to link, or null when the target would not render. */
export function linkHref(target: LinkTarget | null | undefined): string | null {
  return target && target.renders ? target.href : null;
}

/** Heading levels a section card accepts (the band head owns h2). */
export type SectionHeadingLevel = 2 | 3 | 4;
