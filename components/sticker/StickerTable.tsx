import type { ReactNode } from 'react';

export interface StickerTableColumn {
  label: string;
  /** Right aligned with tabular figures. */
  numeric?: boolean;
}

interface StickerTableProps {
  /** Visible caption above the header row (uppercase berry eyebrow). */
  caption: string;
  columns: (string | StickerTableColumn)[];
  /** One array per row, one cell per column, already formatted and gated. */
  rows: ReactNode[][];
  /** The first cell of each row is a row header (default). */
  rowHeader?: boolean;
  className?: string;
}

function normalize(column: string | StickerTableColumn): StickerTableColumn {
  return typeof column === 'string' ? { label: column } : column;
}

/** A plain table inside one sticker. Renders nothing without rows. */
export default function StickerTable({ caption, columns, rows, rowHeader = true, className }: StickerTableProps) {
  if (rows.length === 0) return null;
  const cols = columns.map(normalize);
  const cellClass = (i: number) => (cols[i]?.numeric ? 'stk-num' : undefined);
  return (
    <div className={['stk-table-wrap', className].filter(Boolean).join(' ')}>
      <table className="stk-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {cols.map((col, i) => (
              <th key={col.label} scope="col" className={cellClass(i)}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) =>
                c === 0 && rowHeader ? (
                  <th key={c} scope="row" className={cellClass(c)}>{cell}</th>
                ) : (
                  <td key={c} className={cellClass(c)}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
