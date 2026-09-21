/**
 * CategoryFAQAccordion: the FAQ list, one native <details>/<summary> per item.
 *
 * Server component: no client JS, and every answer is in the server HTML
 * for crawlers and the Speakable selector. The first item is open; the
 * others open on tap, which the browser handles without a script.
 *
 * `faq-answer` is the Speakable hook every FAQ surface shares. The answer
 * renders as
 *
 *     <p className="faq-answer">{faq.answer}</p>
 *
 * inside the open or closed <details>, and the setting-state template lists
 * '.faq-answer' in SpeakableSpecification.cssSelector on the strength of
 * it (tests/regressions/p2-pseo-parity-templates.test.ts pins both halves).
 * Do not drop the class or put other attributes on that <p>.
 *
 * The look is the clay card the client version had: white face, 16px
 * radius, soft neumorphic shadow that deepens when open, and a berry
 * chevron well that fills when open. The rules live in ACCORDION_CSS, one
 * static string with no interpolation, rendered once per list.
 */
import { ChevronDown } from 'lucide-react';
import type { FAQItem } from '@/lib/pseo/category-faq-data';

interface CategoryFAQAccordionProps {
    faqs: FAQItem[];
}

const ACCORDION_CSS = `
.cfaq-list { display: flex; flex-direction: column; gap: 12px; }
.cfaq-item {
  background: #FFFFFF;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.5);
  box-shadow: 4px 4px 12px rgba(0,0,0,0.04), -2px -2px 8px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6);
  overflow: hidden;
  transition: box-shadow 0.3s ease;
}
.cfaq-item[open] {
  box-shadow: 6px 6px 20px rgba(0,0,0,0.08), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6);
}
.cfaq-q {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  cursor: pointer;
  list-style: none;
  font-size: 15px;
  font-weight: 600;
  color: #1A2E35;
  line-height: 1.4;
}
.cfaq-q::-webkit-details-marker { display: none; }
.cfaq-q:focus-visible { outline: 2px solid #BE185D; outline-offset: -2px; border-radius: 16px; }
.cfaq-chevron {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: #FDF2F8;
  color: #BE185D;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.2s ease, transform 0.2s ease;
}
.cfaq-item[open] .cfaq-chevron { background: #BE185D; color: #FFFFFF; transform: rotate(180deg); }
.cfaq-body { padding: 0 24px 20px; border-top: 1px solid rgba(0,0,0,0.04); }
.cfaq-body .faq-answer { font-size: 14px; color: #5A4A42; line-height: 1.7; margin: 16px 0 0; }
@media (prefers-reduced-motion: reduce) {
  .cfaq-item, .cfaq-chevron { transition: none; }
}
`;

export default function CategoryFAQAccordion({ faqs }: CategoryFAQAccordionProps) {
    if (faqs.length === 0) return null;

    return (
        <div className="cfaq-list">
            <style>{ACCORDION_CSS}</style>
            {faqs.map((faq, index) => (
                <details key={index} className="cfaq-item" open={index === 0}>
                    <summary className="cfaq-q">
                        <span>{faq.question}</span>
                        <span className="cfaq-chevron" aria-hidden="true">
                            <ChevronDown size={16} />
                        </span>
                    </summary>
                    <div className="cfaq-body">
                        <p className="faq-answer">{faq.answer}</p>
                    </div>
                </details>
            ))}
        </div>
    );
}
