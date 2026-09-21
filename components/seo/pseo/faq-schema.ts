/**
 * FAQPage JSON-LD from the same array that feeds the visible accordion, so
 * the schema and the markup can never disagree (PLAN C.0). Emitted only at
 * 2 or more entries; angle brackets are escaped so no value can close the
 * surrounding <script> element (repo convention).
 */
import type { FaqEntry } from '@/lib/pseo/listing-narrative';

export const FAQ_SCHEMA_MIN_ENTRIES = 2;

export function faqPageJsonLd(items: readonly FaqEntry[]): string | null {
  if (items.length < FAQ_SCHEMA_MIN_ENTRIES) return null;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
  return JSON.stringify(schema).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
