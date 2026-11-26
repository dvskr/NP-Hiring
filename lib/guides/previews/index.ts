import { brand } from '@/config/brand';
import { isGuideSlug, type Guide, type GuideSlug, type OwnGuideSlug } from '@/lib/guides/catalog';
import { SERP_TITLE_MAX } from '@/lib/pseo/category-metadata';
import { COMPENSATION_REPORT_PREVIEW } from './compensation-report';
import { FIRST_YEAR_PLAYBOOK_PREVIEW } from './first-year-playbook';
import { INTERVIEW_PREP_PACK_PREVIEW } from './interview-prep-pack';
import { LAUNCH_YOUR_PRACTICE_PREVIEW } from './launch-your-practice';
import { NEGOTIATE_LIKE_AN_NP_PREVIEW } from './negotiate-like-an-np';
import { TELEHEALTH_PLAYBOOK_PREVIEW } from './telehealth-playbook';
import type { GuidePreview } from './types';

export type * from './types';

/**
 * Preview copy for this board's own six guides. A guide listed here gets the
 * deep page on /guides/[slug] (answer intro, the excerpt, table of contents,
 * key figures, FAQ); the bundles and the psych editions keep the plain
 * product page (an edition's page names the other board's page as its
 * canonical, and that page carries the preview). One file per guide, so each
 * stays readable.
 */
export const GUIDE_PREVIEWS: Readonly<Record<OwnGuideSlug, GuidePreview>> = {
    'compensation-report': COMPENSATION_REPORT_PREVIEW,
    'first-year-playbook': FIRST_YEAR_PLAYBOOK_PREVIEW,
    'interview-prep-pack': INTERVIEW_PREP_PACK_PREVIEW,
    'negotiate-like-an-np': NEGOTIATE_LIKE_AN_NP_PREVIEW,
    'telehealth-playbook': TELEHEALTH_PLAYBOOK_PREVIEW,
    'launch-your-practice': LAUNCH_YOUR_PRACTICE_PREVIEW,
};

/** The preview for a guide slug, or null for a bundle, a psych edition or anything else. */
export function getGuidePreview(slug: string): GuidePreview | null {
    if (!isGuideSlug(slug) || !Object.hasOwn(GUIDE_PREVIEWS, slug)) return null;
    return GUIDE_PREVIEWS[slug as Extract<GuideSlug, OwnGuideSlug>];
}

/** Numbered chapters in the table of contents, the count the page quotes. */
export function previewChapterCount(preview: GuidePreview): number {
    return preview.toc.filter((entry) => entry.chapter !== undefined).length;
}

/** What the preview page says the guide is: its own summary when it has one, else the catalog's. */
export function previewSummary(guide: Guide, preview: GuidePreview): string {
    return preview.summary ?? guide.summary;
}

/**
 * The page's search title: the preview's own title with the brand suffix
 * when the whole still fits the SERP budget, else the title alone. The page
 * sets it absolute, so the layout's template cannot add the suffix twice.
 */
export function previewSearchTitle(preview: GuidePreview): string {
    const branded = `${preview.seo.title} | ${brand.name}`;
    return branded.length <= SERP_TITLE_MAX ? branded : preview.seo.title;
}
