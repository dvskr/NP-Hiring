import { ChevronDown } from 'lucide-react';
import { CLAY_ACCENT, CLAY_BODY, CLAY_INK, clayCard, cx } from './clay';
import ClayStyles from './ClayStyles';
import type { SectionHeadingLevel } from './types';

export interface ClayAccordionItem {
  question: string;
  answer: string;
}

interface ClayAccordionProps {
  items: ClayAccordionItem[];
  /** Level of the question headings inside each summary. */
  headingLevel?: SectionHeadingLevel;
  className?: string;
}

/**
 * FAQ accordion on native <details>/<summary>, one clay card per question:
 * no client JS, the first item open, and every answer in the server HTML so
 * crawlers and the Speakable selector see it. `faq-answer` is the Speakable
 * hook every FAQ surface shares (the templates list '.faq-answer' in
 * SpeakableSpecification.cssSelector); keep the class on the answer <p>.
 */
export default function ClayAccordion({ items, headingLevel = 3, className }: ClayAccordionProps) {
  if (items.length === 0) return null;
  const Heading = `h${headingLevel}` as const;
  return (
    <>
      <ClayStyles />
      <div className={cx('pseo-clay-faq', className)} style={{ display: 'grid', gap: '12px' }}>
        {items.map((faq, i) => (
          <details key={faq.question} style={{ ...clayCard, borderRadius: '16px', overflow: 'hidden' }} open={i === 0}>
            <summary
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                padding: '18px 24px',
                cursor: 'pointer',
              }}
            >
              <Heading style={{ fontSize: '15px', fontWeight: 600, color: CLAY_INK, lineHeight: 1.4, margin: 0 }}>
                {faq.question}
              </Heading>
              <span
                className="pseo-clay-chevron"
                aria-hidden="true"
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '8px',
                  background: '#FDF2F8',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <ChevronDown size={16} color={CLAY_ACCENT} />
              </span>
            </summary>
            <div style={{ padding: '0 24px 20px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
              <p className="faq-answer" style={{ fontSize: '14px', color: CLAY_BODY, lineHeight: 1.7, margin: '16px 0 0' }}>
                {faq.answer}
              </p>
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
