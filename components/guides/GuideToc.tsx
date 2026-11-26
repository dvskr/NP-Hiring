import type { GuideTocEntry } from '@/lib/guides/previews';

/**
 * A guide's full table of contents: every chapter with its sections and
 * printed page, as the PDF's bookmarks list them. A chapter the page shows
 * in full is marked and links back up to the excerpt.
 */
export default function GuideToc({ toc, excerptId }: { readonly toc: readonly GuideTocEntry[]; readonly excerptId: string }) {
    return (
        <ol className="guide-toc">
            {toc.map((entry) => (
                <li key={entry.title} className={entry.inExcerpt ? 'guide-toc-entry guide-toc-entry-shown' : 'guide-toc-entry'}>
                    <p className="guide-toc-title">
                        <span>
                            {entry.chapter !== undefined ? <span className="guide-toc-number">{`Chapter ${entry.chapter}: `}</span> : null}
                            {entry.title}
                        </span>
                        <span className="guide-toc-page">{`p. ${entry.page}`}</span>
                    </p>
                    {entry.inExcerpt ? (
                        <a href={`#${excerptId}`} className="guide-toc-shown">Read it above</a>
                    ) : null}
                    {entry.sections.length > 0 ? (
                        <ul className="guide-toc-sections">
                            {entry.sections.map((section) => (
                                <li key={section}>{section}</li>
                            ))}
                        </ul>
                    ) : null}
                </li>
            ))}
        </ol>
    );
}
