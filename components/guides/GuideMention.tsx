import LinkedText from '@/components/guides/LinkedText';
import type { BlogGuideMention } from '@/lib/guides/blog-guide';

/**
 * The one-sentence pointer to a guide's preview page that a blog post
 * carries after its article (lib/guides/blog-guide.ts). A single text link on
 * descriptive words, inside the post's own column. No hooks, so it renders
 * anywhere.
 */
const MENTION_CSS = `
.gd-mention .gd-inline-link { color: #9D174D; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
.gd-mention .gd-inline-link:hover { color: #BE185D; }
.gd-mention .gd-inline-link:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
`;

export default function GuideMention({ mention }: { readonly mention: BlogGuideMention }) {
    return (
        <aside
            className="gd-mention"
            aria-label="From the career guides"
            style={{
                margin: '28px 0 0',
                padding: '16px 20px',
                background: '#FBF2E6',
                border: '1px solid rgba(122,28,43,0.18)',
                borderLeft: '4px solid #BE185D',
                fontSize: '15px',
                lineHeight: 1.65,
                color: '#2b1a1e',
            }}
        >
            <style href="guide-mention" precedence="default">{MENTION_CSS}</style>
            <p style={{ margin: 0 }}>
                <LinkedText text={mention.text} link={{ phrase: mention.phrase, href: `/guides/${mention.guide}` }} />
            </p>
        </aside>
    );
}
