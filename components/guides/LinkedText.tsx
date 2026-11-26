import Link from 'next/link';
import type { PreviewLink } from '@/lib/guides/previews';

/**
 * A sentence of preview copy with one phrase linked to another page on the
 * site. The text itself is unchanged, so the FAQPage markup that carries the
 * same answer as plain text still matches what a reader sees. The link's
 * look is .gd-inline-link in components/guides/preview-styles.ts; the blog's
 * guide mention prints its own copy of that rule.
 */
export default function LinkedText({ text, link }: { readonly text: string; readonly link?: PreviewLink }) {
    const at = link ? text.indexOf(link.phrase) : -1;
    if (!link || at < 0) return <>{text}</>;
    return (
        <>
            {text.slice(0, at)}
            <Link href={link.href} className="gd-inline-link">
                {link.phrase}
            </Link>
            {text.slice(at + link.phrase.length)}
        </>
    );
}
