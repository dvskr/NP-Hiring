/**
 * A client's display name, as the consent page and Connected apps show it.
 *
 * SECURITY: the name comes from a client (a metadata document or a
 * registration body) and is the first thing the consent heading says, so
 * control characters, bidirectional overrides and invisible format
 * characters are removed: they could make "Allow Claude" read as something
 * other than what was registered. React escapes the rest.
 * tests/oauth/cimd.test.ts, tests/oauth/register.test.ts
 */

/** Code point ranges removed from a name (inclusive). */
const REMOVED_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x0000, 0x001f], // C0 controls
    [0x007f, 0x009f], // DEL and C1 controls
    [0x00ad, 0x00ad], // soft hyphen
    [0x061c, 0x061c], // Arabic letter mark
    [0x180e, 0x180e], // Mongolian vowel separator
    [0x200b, 0x200f], // zero width space, joiners, LRM, RLM
    [0x2028, 0x202e], // line and paragraph separators, bidi embeddings and overrides
    [0x2060, 0x206f], // word joiner, invisible operators, bidi isolates
    [0xfeff, 0xfeff], // zero width no-break space
];

function isRemoved(character: string): boolean {
    const codePoint = character.codePointAt(0) ?? 0;
    return REMOVED_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to);
}

/** The name with control and invisible characters removed and whitespace collapsed, or null when nothing is left. */
export function cleanClientName(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const kept = Array.from(raw)
        .filter((character) => !isRemoved(character))
        .join('');
    const cleaned = kept.replace(/\s+/g, ' ').trim();
    return cleaned.length > 0 ? cleaned : null;
}
