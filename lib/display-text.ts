/**
 * Render-time separator normaliser for employer-authored text.
 *
 * Job titles, employer names and location strings come from the listings
 * themselves and often carry dashes as separators ("NP — Remote |
 * Telehealth", "Remote - USA", "NP/PA - Studio City"). They are DATA: the
 * stored row and every structured-data surface (JobPosting / BreadcrumbList
 * JSON-LD) keep the original string. Owner direction (2026-09-12): no dashes
 * in visible text, so every candidate-facing render point passes the value
 * through this helper before printing it.
 *
 * Rules:
 *   - every em dash (U+2014) and en dash (U+2013), with any whitespace around
 *     it, becomes a single middle-dot separator " · ";
 *   - a hyphen surrounded by whitespace ("Remote - USA") becomes " · " too;
 *   - hyphens inside words ("Full-Time", "Part-time", "1099-vs-W2") are left
 *     alone;
 *   - idempotent: a string that already uses " · " is returned unchanged;
 *   - null, undefined and the empty string return null.
 */

const SEPARATOR = ' · ';

// Em/en dash with any surrounding whitespace, OR a hyphen that has whitespace
// on BOTH sides. The hyphen branch requires \s+ on each side so compound
// words and negative numbers are never touched.
const DASH_SEPARATOR_PATTERN = /\s*[–—]\s*|\s+-\s+/g;

export function normalizeDisplayText(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value.replace(DASH_SEPARATOR_PATTERN, SEPARATOR);
}

/**
 * String-returning variant for template literals and attribute values, where
 * a null would otherwise print as the text "null". Empty input yields ''.
 */
export function displayText(value: string | null | undefined): string {
  return normalizeDisplayText(value) ?? '';
}
