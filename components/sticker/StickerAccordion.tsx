import { ChevronDown } from 'lucide-react';

export interface StickerAccordionItem {
  question: string;
  answer: string;
}

interface StickerAccordionProps {
  items: StickerAccordionItem[];
  /** Level of the question headings inside each summary. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/**
 * FAQ accordion on native <details>/<summary>: no client JS, aria-expanded
 * semantics for free, and every answer in the server HTML so crawlers and
 * the Speakable selector see it (city spec P6). The first item is open.
 *
 * `faq-answer` is the Speakable hook every FAQ surface shares: the templates
 * list '.faq-answer' in SpeakableSpecification.cssSelector, and the parity
 * tests pin `<p className="faq-answer"` next to `{faq.answer}`. Keep both.
 */
export default function StickerAccordion({ items, headingLevel = 3, className }: StickerAccordionProps) {
  if (items.length === 0) return null;
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={['stk-acc-list', className].filter(Boolean).join(' ')}>
      {items.map((faq, i) => (
        <details key={faq.question} className="stk-acc" open={i === 0}>
          <summary>
            <Heading className="stk-acc-q font-heading">{faq.question}</Heading>
            <span className="stk-icon stk-acc-chevron" aria-hidden="true">
              <ChevronDown size={18} strokeWidth={2.25} />
            </span>
          </summary>
          <div className="stk-acc-body">
            <p className="faq-answer">{faq.answer}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
