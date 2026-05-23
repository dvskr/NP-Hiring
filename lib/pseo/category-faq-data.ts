/**
 * Category FAQ data — extracted so both the server-rendered schema component
 * (components/CategoryFAQ.tsx) and the client-rendered accordion
 * (components/CategoryFAQAccordion.tsx) can share the same source of truth.
 *
 * Keeping this in a non-'use client' module also means the data never ends
 * up in the client JS bundle for routes that only need the schema.
 *
 * Forked from the PMHNP version (2026-05-23): slugs broadened to the
 * NP / APRN taxonomy in lib/pseo/category-tagger.ts. FAQ content stubbed
 * for now — Phase 8 will populate niche-specific Q&A per category.
 */

export interface FAQItem {
    question: string;
    answer: string;
}

/**
 * Categories that can render an FAQPage schema. Keep in sync with
 * CANONICAL_CATEGORY_SLUGS in lib/pseo/category-tagger.ts when adding
 * new long-form pSEO categories. The `metro` slug is a sentinel for
 * city-level pages that always supply customFaqs at render time.
 */
export type CategorySlug =
    | 'remote'
    | 'telehealth'
    | 'travel'
    | 'inpatient'
    | 'outpatient'
    | 'hospital'
    | 'private-practice'
    | 'community-health'
    | 'va'
    | 'urgent-care'
    | 'home-health'
    | 'family-practice'
    | 'adult-gerontology'
    | 'pediatric'
    | 'neonatal'
    | 'women-health'
    | 'acute-care'
    | 'emergency'
    | 'psychiatric-mental-health'
    | 'geriatric'
    | 'oncology'
    | 'cardiology'
    | 'primary-care'
    | 'hospitalist'
    | 'anesthesia'
    | 'midwifery'
    | 'new-grad'
    | 'per-diem'
    | 'locum-tenens'
    | 'metro';

export interface CategoryFaqInput {
    category: CategorySlug;
    totalJobs: number;
    avgSalary?: number;
    customFaqs?: FAQItem[];
}

export const CATEGORY_LABELS: Record<CategorySlug, string> = {
    remote: 'Remote',
    telehealth: 'Telehealth',
    travel: 'Travel',
    inpatient: 'Inpatient',
    outpatient: 'Outpatient',
    hospital: 'Hospital',
    'private-practice': 'Private Practice',
    'community-health': 'Community Health',
    va: 'VA',
    'urgent-care': 'Urgent Care',
    'home-health': 'Home Health',
    'family-practice': 'Family Practice',
    'adult-gerontology': 'Adult-Gerontology',
    pediatric: 'Pediatric',
    neonatal: 'Neonatal',
    'women-health': "Women's Health",
    'acute-care': 'Acute Care',
    emergency: 'Emergency',
    'psychiatric-mental-health': 'Psychiatric Mental Health',
    geriatric: 'Geriatric',
    oncology: 'Oncology',
    cardiology: 'Cardiology',
    'primary-care': 'Primary Care',
    hospitalist: 'Hospitalist',
    anesthesia: 'Anesthesia (CRNA)',
    midwifery: 'Midwifery (CNM)',
    'new-grad': 'New Grad',
    'per-diem': 'Per Diem',
    'locum-tenens': 'Locum Tenens',
    metro: 'Metro',
};

/**
 * Built-in FAQ generators per category.
 *
 * Empty stub for now — Phase 8 will write niche-specific Q&A per category
 * (e.g. "What does an Emergency NP earn?", "How do CRNA jobs differ from
 * other anesthesia roles?"). Until then, any caller without `customFaqs`
 * gets an empty FAQ section (the component already handles this case).
 */
const CATEGORY_FAQS: Partial<Record<CategorySlug, (props: CategoryFaqInput) => FAQItem[]>> = {};

export function buildCategoryFaqs(input: CategoryFaqInput): FAQItem[] {
    const builtin = CATEGORY_FAQS[input.category]?.(input) ?? [];
    return [...builtin, ...(input.customFaqs ?? [])];
}

/** Legacy alias — components/CategoryFAQ.tsx imports this name. */
export const getCategoryFaqs = buildCategoryFaqs;
