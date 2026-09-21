'use client';

import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface FAQItem {
  question: string;
  answer: string;
}

interface FAQAccordionProps {
  items: FAQItem[];
}

/**
 * Panel id for one item. /faq mounts several accordions on one page, so the
 * id is namespaced per instance (React useId, stripped to id-safe characters);
 * the item index alone repeated across groups and pointed every aria-controls
 * at the first group's panel.
 */
export function faqAnswerId(instanceId: string, index: number): string {
  const namespace = instanceId.replace(/[^A-Za-z0-9_-]/g, '');
  return `faq-answer-${namespace}-${index}`;
}

export default function FAQAccordion({ items }: FAQAccordionProps) {
  const instanceId = useId();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleItem = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleItem(index);
    }
  };

  return (
    <div className="divide-y divide-gray-200">
      {items.map((item: FAQItem, index: number) => {
        const isOpen = openIndex === index;

        return (
          <div key={index} className="border-b border-gray-200 last:border-b-0">
            {/* Question Button.
                SEO Fix H8: removed `focus:outline-none` so the global
                focus-visible ring renders for keyboard users (WCAG 2.4.7). */}
            <button
              onClick={() => toggleItem(index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className="w-full flex items-center justify-between py-4 text-left font-medium text-gray-900 hover:text-primary-600 transition-colors duration-200 focus:text-primary-600"
              aria-expanded={isOpen}
              aria-controls={faqAnswerId(instanceId, index)}
            >
              <span className="flex-1 pr-4">{item.question}</span>
              <ChevronDown
                aria-hidden="true"
                className={`w-5 h-5 text-gray-500 transition-transform duration-300 flex-shrink-0 ${
                  isOpen ? 'rotate-180 text-primary-600' : ''
                }`}
              />
            </button>

            {/* Answer.
                SEO Fix H8: previously used `max-h-0; opacity-0; aria-hidden`
                which keeps text in the tab order if a focusable child were
                ever added. The native `hidden` attribute (a) takes the
                element out of the accessibility tree completely when closed
                and (b) prevents tab focus on any child. The visual transition
                is preserved by only animating when open. */}
            <div
              id={faqAnswerId(instanceId, index)}
              hidden={!isOpen}
              className={isOpen ? 'overflow-hidden transition-all duration-300 ease-in-out max-h-96 opacity-100' : ''}
            >
              <div className="pb-4 text-gray-600 leading-relaxed">
                {item.answer}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

