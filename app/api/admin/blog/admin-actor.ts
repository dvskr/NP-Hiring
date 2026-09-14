import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * Supabase id of the signed-in admin, for the audit trail. requireApiAdmin
 * only answers pass/fail, so the session is read again here rather than
 * trusting anything client-supplied. Returns null when the session cannot be
 * resolved; callers refuse the write in that case (fail closed: no
 * unattributed content change).
 */
export async function resolveAdminActorId(): Promise<string | null> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        return user?.id ?? null;
    } catch (err) {
        logger.error('[Admin Blog] could not resolve the acting admin', err);
        return null;
    }
}
