/**
 * Resume-specific helpers — thin wrappers over lib/document-storage.ts
 * that pin the docType to 'resume'. Lets the existing import sites
 * keep working while the underlying module handles every PII doc type.
 *
 * New code should import directly from `lib/document-storage.ts`
 * and pick the docType explicitly. This module exists for ergonomic
 * call sites that ONLY ever deal with resumes (e.g. /api/resume/parse).
 */

import {
    mintDocReadUrl,
    downloadDocBytes,
    toBareDocPath,
    logDocAccess,
    extractRequestContext,
    type DocReadContext,
    type DocReadAudience,
} from '@/lib/document-storage';
import { isOwnStoragePath } from '@/lib/supabase-storage';

/** Default TTL for resume signed URLs — 15 minutes. */
export const DEFAULT_RESUME_URL_TTL_SECONDS = 15 * 60;

export type ResumeReadAudience = DocReadAudience;
export type ResumeReadContext = DocReadContext;

export function toBareResumePath(stored: string | null | undefined): string | null {
    return toBareDocPath(stored, 'resume');
}

/**
 * SECURITY (AUTH-PROFILE-1, RES-1 to RES-4, APP-2, EMP-RES-1): the bare key
 * of a stored or submitted resume value when it names an object in
 * `ownerId`'s own upload folder, otherwise null. One normalizer
 * (toBareResumePath) followed by the one ownership rule (isOwnStoragePath).
 *
 * A resume reference is writable by its owner, so the value alone never
 * proves whose object it names. Writers store only what this returns, and
 * readers sign, download or delete only what this returns, with `ownerId`
 * the document owner's supabaseId. Non-string input answers null.
 * Tests: tests/lib/storage-ownership.test.ts.
 */
export function toOwnResumePath(stored: unknown, ownerId: string | null | undefined): string | null {
    const path = typeof stored === 'string' ? toBareResumePath(stored) : null;
    return isOwnStoragePath(path, ownerId) ? path : null;
}

export async function mintResumeReadUrl(
    storedPath: string | null | undefined,
    ctx: ResumeReadContext,
    opts: { ttlSeconds?: number } = {},
): Promise<string | null> {
    return mintDocReadUrl(storedPath, 'resume', ctx, opts);
}

export async function downloadResumeBytes(
    storedPath: string | null | undefined,
    ctx: ResumeReadContext,
): Promise<{ buffer: Buffer; contentType: string } | null> {
    return downloadDocBytes(storedPath, 'resume', ctx);
}

export async function logResumeAccess(ctx: ResumeReadContext): Promise<void> {
    return logDocAccess('resume', ctx);
}

export { extractRequestContext };
