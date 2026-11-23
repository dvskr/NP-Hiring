/**
 * One employer under any capitals, punctuation or legal form.
 *
 * A comparison key, never a display name. It is deliberately small and has no
 * imports, so browser code can use it as well as the server. Ported from the
 * sister board's helper of the same name on 2026-11-23.
 */

/** Legal forms dropped before two names are compared. */
const LEGAL_FORM_WORDS: ReadonlySet<string> = new Set(['inc', 'llc', 'corp', 'corporation', 'company', 'co', 'ltd']);

/**
 * What a source writes when it withholds the employer, after the same
 * normalization ("Company Not Listed" reads "not listed"). Postings under
 * one of these belong to different employers.
 */
const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set([
  'confidential',
  'confidential employer',
  'not listed',
  'undisclosed',
  'anonymous',
  'unknown',
  'private practice',
  'hiring organization',
  // "Hiring Company" and "Employer" once the legal-form words are dropped.
  'hiring',
  'employer',
]);

/**
 * '' for a missing, empty or placeholder name, which callers treat as
 * "matches no other posting".
 */
export function employerKey(name: string | null | undefined): string {
  if (!name) return '';
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word !== '' && !LEGAL_FORM_WORDS.has(word))
    .join(' ');
  return PLACEHOLDER_NAMES.has(key) ? '' : key;
}
