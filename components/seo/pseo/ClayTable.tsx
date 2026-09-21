import type { CSSProperties, ReactNode } from 'react';
import { CLAY_BODY, CLAY_INK, CLAY_MUTED, clayCard, cx } from './clay';

export type ClayTableColumn = string | { label: string; numeric?: boolean };

interface ClayTableProps {
  /** Visible caption above the table (the source line for figures). */
  caption: string;
  columns: ClayTableColumn[];
  rows: ReactNode[][];
  /** First cell of every row is a `th scope="row"` (default). */
  rowHeader?: boolean;
  className?: string;
}

interface Column {
  label: string;
  numeric: boolean;
}

function columnOf(column: ClayTableColumn): Column {
  return typeof column === 'string'
    ? { label: column, numeric: false }
    : { label: column.label, numeric: column.numeric === true };
}

const RULE = '1px solid rgba(0,0,0,0.06)';

const headCell: CSSProperties = {
  padding: '10px 8px',
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: CLAY_MUTED,
  borderBottom: RULE,
  whiteSpace: 'nowrap',
};

function bodyCell(column: Column, isLast: boolean): CSSProperties {
  return {
    padding: '10px 8px',
    textAlign: column.numeric ? 'right' : 'left',
    verticalAlign: 'top',
    borderBottom: isLast ? undefined : RULE,
  };
}

/**
 * A simple table in a clay card: caption on top, column headers with
 * scope, the first cell of each row a row header, numeric columns right
 * aligned, rows divided by the 1px rule. Renders nothing without rows.
 */
export default function ClayTable({ caption, columns, rows, rowHeader = true, className }: ClayTableProps) {
  if (rows.length === 0) return null;
  const cols = columns.map(columnOf);
  return (
    <div className={cx('pseo-clay-table', className)} style={{ ...clayCard, padding: '8px 24px 12px', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <caption style={{ captionSide: 'top', textAlign: 'left', padding: '12px 0', fontSize: '12px', color: CLAY_MUTED, lineHeight: 1.5 }}>
          {caption}
        </caption>
        <thead>
          <tr>
            {cols.map((column) => (
              <th key={column.label} scope="col" style={{ ...headCell, textAlign: column.numeric ? 'right' : 'left' }}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r}>
              {cells.map((cell, c) => {
                const style = bodyCell(cols[c] ?? { label: '', numeric: false }, r === rows.length - 1);
                return rowHeader && c === 0 ? (
                  <th key={c} scope="row" style={{ ...style, fontWeight: 600, color: CLAY_INK }}>
                    {cell}
                  </th>
                ) : (
                  <td key={c} style={{ ...style, color: CLAY_BODY }}>
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
