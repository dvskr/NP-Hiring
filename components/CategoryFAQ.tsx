/**
 * CategoryFAQ: the FAQ band (server component).
 *
 * One array feeds both halves: the FAQPage JSON-LD (static server HTML, so
 * the schema is present on first byte with no hydration dependency) and the
 * visible accordion rendered through CategoryFAQAccordion. An entry that
 * fails its render condition therefore disappears from the page and the
 * schema together, and the schema is emitted only with two or more entries
 * (a single question is a paragraph with a heading, not a FAQ page).
 *
 * Same import path and props as before; `heading` is an optional addition,
 * so consumers do not need to change. The band keeps the clay look every
 * pSEO page already has: cream ground, berry eyebrow, Lora heading, and the
 * white clay cards of the accordion below it.
 */
import type { CSSProperties } from 'react';
import CategoryFAQAccordion from './CategoryFAQAccordion';
import {
    getCategoryFaqs,
    CATEGORY_LABELS,
    type CategorySlug,
    type FAQItem,
} from '@/lib/pseo/category-faq-data';
import { brand } from '@/config/brand';

interface CategoryFAQProps {
    category: CategorySlug;
    totalJobs: number;
    /** The gated median in whole dollars (the name is kept for the callers). */
    avgSalary?: number;
    /** Pass custom FAQs (e.g. from metro data) instead of using built-in ones */
    customFaqs?: FAQItem[];
    /**
     * Band heading. Defaults to "{category label} {niche} Jobs FAQ", which is
     * what the accordion used to print; a city page passes its own so it
     * stops announcing the category it borrowed its questions from.
     */
    heading?: string;
}

/** FAQPage rich results need more than one question; below this the band renders without schema. */
const MIN_FAQ_ENTRIES_FOR_SCHEMA = 2;

const HEADING_ID = 'category-faq-heading';

const bandStyle: CSSProperties = { background: '#FDFBF7' };

const sectionStyle: CSSProperties = { maxWidth: '1000px', margin: '0 auto', padding: '56px 20px' };

const eyebrowStyle: CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: '#BE185D',
    textTransform: 'uppercase',
    letterSpacing: '0.15em',
    textAlign: 'center',
    marginBottom: '8px',
};

const headingStyle: CSSProperties = {
    fontSize: 'clamp(24px, 3.2vw, 34px)',
    fontWeight: 700,
    color: '#1A2E35',
    textAlign: 'center',
    marginBottom: '40px',
};

function buildFaqPageSchema(faqs: readonly FAQItem[]): string {
    const faqSchema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map((faq) => ({
            '@type': 'Question',
            name: faq.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: faq.answer,
            },
        })),
    };
    // Escape "<" so an answer can never close the script element early.
    return JSON.stringify(faqSchema).replace(/</g, '\\u003c');
}

export default function CategoryFAQ({
    category,
    totalJobs,
    avgSalary,
    customFaqs,
    heading,
}: CategoryFAQProps) {
    const faqs = getCategoryFaqs({ category, totalJobs, avgSalary, customFaqs });
    if (faqs.length === 0) return null;

    const title = heading ?? `${CATEGORY_LABELS[category]} ${brand.niche.short} Jobs FAQ`;
    const schema = faqs.length >= MIN_FAQ_ENTRIES_FOR_SCHEMA ? buildFaqPageSchema(faqs) : null;

    return (
        <div style={bandStyle}>
            <section aria-labelledby={HEADING_ID} style={sectionStyle}>
                {schema && (
                    <script
                        type="application/ld+json"
                        dangerouslySetInnerHTML={{ __html: schema }}
                    />
                )}
                <p style={eyebrowStyle}>Common Questions</p>
                <h2 id={HEADING_ID} className="font-lora" style={headingStyle}>
                    {title}
                </h2>
                <CategoryFAQAccordion faqs={faqs} />
            </section>
        </div>
    );
}
