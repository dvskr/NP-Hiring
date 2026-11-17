import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';

/**
 * Refresh one job page's cached render after an edit.
 *
 * Job pages are ISR with a 24-hour window (`revalidate` in
 * app/jobs/[slug]/page.tsx), so without this an employer's or an admin's
 * edit would show only when that window ends. Closing a job needs no
 * refresh: middleware.ts answers a closed job's URL with a 410 before the
 * cache is read.
 *
 * Runs after the database write has committed and never throws: the edit is
 * saved either way, and the cache window is the fallback.
 */
export function revalidateJobPage(slug: string | null | undefined, context: string): void {
    if (typeof slug !== 'string' || slug.trim() === '') return;
    const path = `/jobs/${slug}`;
    try {
        revalidatePath(path);
    } catch (error) {
        logger.error(`[${context}] revalidatePath failed`, error, { path });
    }
}
