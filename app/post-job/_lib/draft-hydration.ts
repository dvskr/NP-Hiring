/**
 * Pure helpers behind the /post-job "Resumed your unfinished post" banner.
 *
 * The banner appears whenever a draft is restored (resume token, server
 * draft, or the localStorage mirror) and stays until the employer actually
 * changes something. An autosave that merely echoes the restored values back
 * to the server must not dismiss it.
 */

export type DraftValues = Readonly<Record<string, unknown>>;

const visibleText = (html: unknown): string =>
  typeof html === 'string' ? html.replace(/<[^>]*>/g, '').trim() : '';

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** True when a restored draft holds content the employer typed, not just form defaults. */
export function hasMeaningfulDraftContent(values: DraftValues | null | undefined): boolean {
  if (!values) return false;
  return (
    trimmed(values.title).length > 0 ||
    trimmed(values.companyName).length > 0 ||
    visibleText(values.description).length > 0
  );
}

/** JSON with object keys sorted and undefined members dropped, so key order never matters. */
function stableSerialize(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          const member = (v as Record<string, unknown>)[k];
          return member === undefined ? acc : { ...acc, [k]: member };
        }, {});
    }
    return v;
  });
}

/** Content equality between two form value objects (key order and undefined members ignored). */
export function isSameDraftContent(a: DraftValues | null | undefined, b: DraftValues | null | undefined): boolean {
  return stableSerialize(a ?? null) === stableSerialize(b ?? null);
}

/**
 * Whether an autosave of `current` should dismiss the resume banner.
 * No snapshot means nothing was restored, so there is no banner to protect.
 */
export function shouldDismissResumeBanner(
  restoredSnapshot: DraftValues | null,
  current: DraftValues,
): boolean {
  if (!restoredSnapshot) return true;
  // The rich text editor normalises markup on mount ("" becomes
  // "<p><br></p>"), which is not an employer edit; compare visible text.
  const normalise = (values: DraftValues): DraftValues => ({ ...values, description: visibleText(values.description) });
  return !isSameDraftContent(normalise(restoredSnapshot), normalise(current));
}
