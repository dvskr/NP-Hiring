/**
 * ContactFAQ: the /contact quick-answers list.
 *
 * SERVER COMPONENT (thin plan defect B4). This used to be a client island
 * whose answer only entered the DOM after a click, while the page shipped a
 * FAQPage block naming every question. Crawlers therefore saw structured
 * data whose answers were nowhere in the served HTML, which is invisible
 * FAQ markup, and a reader with no JavaScript saw six questions and no
 * answers at all. The native <details>/<summary> accordion renders every
 * answer into the server HTML and still opens on tap with no script.
 *
 * The rendering is delegated to CategoryFAQAccordion, the one accordion the
 * rest of the site already uses, so /contact cannot drift into a second
 * clay FAQ look and its answers carry the same `faq-answer` class every
 * other FAQ surface exposes.
 *
 * The prop shape ({ q, a }) is unchanged: app/contact/page.tsx owns the
 * single FAQ_ITEMS array that feeds both this list and the FAQPage JSON-LD,
 * and that array is what makes the two halves impossible to desynchronize.
 */
import CategoryFAQAccordion from '@/components/CategoryFAQAccordion';

interface FAQItem {
    q: string;
    a: string;
}

export default function ContactFAQ({ items }: { items: FAQItem[] }) {
    return (
        <CategoryFAQAccordion
            faqs={items.map((item) => ({ question: item.q, answer: item.a }))}
        />
    );
}
