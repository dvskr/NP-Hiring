import LinkedText from '@/components/guides/LinkedText';
import type { GuideFaqItem } from '@/lib/guides/previews';

/**
 * A guide's FAQ, answers open: a third-level heading per question and the
 * answer under it. lib/guides/schema.ts builds the FAQPage markup from the
 * same items, so the markup and the page cannot disagree.
 */
export default function GuideFaq({ items }: { readonly items: readonly GuideFaqItem[] }) {
    return (
        <div className="guide-faq">
            {items.map((item) => (
                <div key={item.question} className="guide-faq-item">
                    <h3>{item.question}</h3>
                    <p>
                        <LinkedText text={item.answer} link={item.link} />
                    </p>
                </div>
            ))}
        </div>
    );
}
