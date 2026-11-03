/**
 * Pure formatting helpers for the widget: numbers, calendar days, initials and
 * description paragraphs. No DOM and no host calls, so the vitest suite
 * (node environment) covers them directly (tests/mcp/widgets/format.test.ts).
 */

const DAY_MS = 86_400_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions, timeZone: string | undefined): Intl.DateTimeFormat {
    const key = `${JSON.stringify(options)}|${timeZone ?? ''}`;
    const cached = formatterCache.get(key);
    if (cached) return cached;
    const created = new Intl.DateTimeFormat('en-US', { ...options, timeZone });
    formatterCache.set(key, created);
    return created;
}

/** "1,234" style counts; negative or fractional input is clamped to a whole number. */
export function formatCount(value: number): string {
    const safe = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    return safe.toLocaleString('en-US');
}

/** The host's IANA time zone when the runtime knows it; undefined falls back to the browser's own. */
export function safeTimeZone(timeZone: string | undefined): string | undefined {
    if (!timeZone) return undefined;
    try {
        formatter({ year: 'numeric' }, timeZone);
        return timeZone;
    } catch {
        return undefined;
    }
}

export function parseDate(iso: string): Date | null {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole calendar days since the epoch for the date as seen in `timeZone`. */
function calendarDay(date: Date, timeZone: string | undefined): number {
    const parts = formatter({ year: 'numeric', month: 'numeric', day: 'numeric' }, timeZone).formatToParts(date);
    const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(read('year'), read('month') - 1, read('day')) / DAY_MS;
}

/**
 * Calendar days between `iso` and `now` in the viewer's time zone: 0 for the
 * same day, 1 for yesterday. A future date (clock skew) counts as today.
 */
export function daysAgo(iso: string, now: Date, timeZone?: string): number | null {
    const date = parseDate(iso);
    if (!date) return null;
    return Math.max(0, Math.round(calendarDay(now, timeZone) - calendarDay(date, timeZone)));
}

/** "Oct 5" */
export function formatMonthDay(iso: string, timeZone?: string): string | null {
    const date = parseDate(iso);
    return date ? formatter({ month: 'short', day: 'numeric' }, timeZone).format(date) : null;
}

/** "Oct 5, 2026" */
export function formatFullDate(iso: string, timeZone?: string): string | null {
    const date = parseDate(iso);
    return date ? formatter({ month: 'short', day: 'numeric', year: 'numeric' }, timeZone).format(date) : null;
}

const INITIALS_SKIP = new Set(['the', 'of', 'and', 'for', 'at', 'a', 'an', 'inc', 'llc', 'pc', 'pllc']);

/** Two initials for the employer tile: "Acme Behavioral Health" gives "AB", "Talkiatry" gives "TA". */
export function initials(name: string): string {
    const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const significant = words.filter((word) => !INITIALS_SKIP.has(word.toLowerCase()));
    const pool = significant.length > 0 ? significant : words;
    if (pool.length === 0) return '';
    if (pool.length === 1) return Array.from(pool[0]).slice(0, 2).join('').toUpperCase();
    return (Array.from(pool[0])[0] + Array.from(pool[1])[0]).toUpperCase();
}

/** Plain-text description to paragraphs: every non-empty line is one paragraph. */
export function toParagraphs(text: string): string[] {
    return text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}
