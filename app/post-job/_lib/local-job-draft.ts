/**
 * Which copy of a /post-job draft is the newer work.
 *
 * The form keeps a copy of itself in the browser ('jobFormData') as the
 * employer types, and a signed-in employer's copy is also saved on the
 * server (/api/job-draft). Since 2026-11-25 a visitor can fill the form
 * signed out, so the two can disagree: someone fills a post on this device,
 * then logs in to an account that holds an older server draft. These helpers
 * decide which copy is the newer work, so logging in never throws away what
 * was just typed.
 *
 * Pure and client-safe: the storage is passed in.
 */
import { hasMeaningfulDraftContent, type DraftValues } from './draft-hydration';

/** The browser copy of the form, read by the form, the preview and checkout. */
export const LOCAL_DRAFT_KEY = 'jobFormData';

/** When the browser copy last changed (ISO time), written with the copy. */
export const LOCAL_DRAFT_SAVED_AT_KEY = 'jobFormDataSavedAt';

/**
 * Milliseconds when a meaningful browser copy last changed, or null when
 * there is no such copy or no usable time. Never throws: storage can be
 * disabled, full or hold anything.
 */
export function localDraftSavedAt(storage: Pick<Storage, 'getItem'>): number | null {
  try {
    const raw = storage.getItem(LOCAL_DRAFT_KEY);
    if (!raw || !hasMeaningfulDraftContent(JSON.parse(raw) as DraftValues)) return null;
    const at = Date.parse(storage.getItem(LOCAL_DRAFT_SAVED_AT_KEY) ?? '');
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/**
 * True when the browser copy should win over the account's server draft: it
 * exists and changed after the server draft was saved, or the server draft
 * carries no usable time.
 */
export function deviceDraftIsNewer(localSavedAt: number | null, serverSavedAt: unknown): boolean {
  if (localSavedAt === null) return false;
  const server = typeof serverSavedAt === 'string' ? Date.parse(serverSavedAt) : NaN;
  return !Number.isFinite(server) || localSavedAt > server;
}
