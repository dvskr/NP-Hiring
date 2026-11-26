import LinkedText from '@/components/guides/LinkedText';
import type { GuideKeyFigure } from '@/lib/guides/previews';

/**
 * Three to five figures from a guide, each with its source and vintage
 * printed under it, so a number never appears on the page without where it
 * came from.
 */
export default function GuideKeyFigures({ figures }: { readonly figures: readonly GuideKeyFigure[] }) {
    return (
        <div className="guide-figures">
            {figures.map((item) => (
                <div key={item.title} className={item.table ? 'guide-figure guide-figure-wide' : 'guide-figure'}>
                    <h3>{item.title}</h3>
                    {item.figure ? <p className="guide-figure-number font-heading">{item.figure}</p> : null}
                    <p className="guide-figure-text">
                        <LinkedText text={item.text} link={item.link} />
                    </p>
                    {item.table ? (
                        <div className="guide-figure-table" role="region" aria-label={item.title} tabIndex={0}>
                            <table>
                                <thead>
                                    <tr>
                                        {item.table.columns.map((column) => (
                                            <th key={column} scope="col">{column}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {item.table.rows.map((row) => (
                                        <tr key={row[0]}>
                                            <th scope="row">{row[0]}</th>
                                            {row.slice(1).map((cell, index) => (
                                                <td key={index}>{cell}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                    <p className="guide-figure-source">{`Source: ${item.source}`}</p>
                </div>
            ))}
        </div>
    );
}
