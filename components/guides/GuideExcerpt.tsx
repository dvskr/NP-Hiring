import type { ExcerptBlock, ExcerptRun } from '@/lib/guides/excerpt';

/**
 * The part of a guide a preview page shows, rendered on the server as
 * ordinary HTML: headings, paragraphs, lists, templates and tables with a
 * header row. Every word is in the page a crawler and a reader both receive;
 * nothing waits on a click or a script. Styles live in GUIDE_PREVIEW_CSS
 * (components/guides/preview-styles.ts).
 */
export default function GuideExcerpt({ blocks }: { readonly blocks: readonly ExcerptBlock[] }) {
    return (
        <div className="guide-excerpt">
            {blocks.map((block, index) => (
                <ExcerptPart key={index} block={block} />
            ))}
        </div>
    );
}

/** A paragraph or list item, with its bold run-in lead when the guide sets one. */
function Run({ run }: { readonly run: ExcerptRun }) {
    return (
        <>
            {run.lead ? <strong>{run.lead}</strong> : null}
            {run.lead && run.text ? ' ' : null}
            {run.text}
        </>
    );
}

function ExcerptPart({ block }: { readonly block: ExcerptBlock }) {
    switch (block.kind) {
        case 'heading':
            return block.level === 2 ? <h2 id={block.id} className="font-heading">{block.text}</h2> : <h3 id={block.id}>{block.text}</h3>;
        case 'paragraph':
            return (
                <p>
                    <Run run={block} />
                </p>
            );
        case 'list': {
            const items = block.items.map((item, index) => (
                <li key={index}>
                    <Run run={item} />
                </li>
            ));
            return block.ordered ? <ol start={block.start === 1 ? undefined : block.start}>{items}</ol> : <ul>{items}</ul>;
        }
        case 'template':
            // A note template or a script, line for line, set apart the way
            // the guide boxes it. pre-wrap keeps the lines and still wraps on
            // a phone, so the page never scrolls sideways.
            return <pre className="guide-excerpt-template">{block.lines.join('\n')}</pre>;
        case 'table':
            return (
                // A wide table scrolls inside its own box on a phone, so the
                // page never scrolls sideways; the box takes focus so a
                // keyboard can scroll it too.
                <div
                    className="guide-excerpt-table"
                    role={block.labelledBy ? 'region' : undefined}
                    aria-labelledby={block.labelledBy ?? undefined}
                    tabIndex={0}
                >
                    <table aria-labelledby={block.labelledBy ?? undefined}>
                        <thead>
                            <tr>
                                {block.header.map((cell, index) => (
                                    <th key={index} scope="col">{cell}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {block.rows.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                    {row.map((cell, index) => (
                                        <td key={index}>{cell}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
    }
}
