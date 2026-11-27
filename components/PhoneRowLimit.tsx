'use client';

/**
 * A long table, cut to its first ten rows on a phone (760 pixels and
 * narrower) with a "Show all" button under it; wider screens show every row
 * and no button. The rows stay in the page either way (Google reads the
 * phone version of a page), so the cut only spares a phone visitor a few
 * screens of scrolling. The rules are in app/globals.css (.phone-rows).
 */
import { useState, type ReactNode } from 'react';

export interface PhoneRowLimitProps {
    /** How many rows the table has. */
    readonly total: number;
    /** What the rows are, for the button: "rows" reads "Show all 51 rows". */
    readonly noun: string;
    readonly children: ReactNode;
}

/** The rows a phone shows before the button. app/globals.css holds the same number. */
export const PHONE_ROW_LIMIT = 10;

export default function PhoneRowLimit({ total, noun, children }: PhoneRowLimitProps) {
    const [all, setAll] = useState(false);
    return (
        <div className="phone-rows" {...(all ? { 'data-phone-rows-all': '' } : {})}>
            {children}
            {total > PHONE_ROW_LIMIT && !all && (
                <button type="button" className="phone-rows-more" onClick={() => setAll(true)}>
                    Show all {total} {noun}
                </button>
            )}
        </div>
    );
}
