/**
 * Where the guide PDFs live: the private Supabase Storage bucket
 * GUIDES_BUCKET, one object per guide at `<slug>.pdf`, put there by
 * scripts/guides/upload-guides.ts. Nothing in the bucket is public: a reader
 * gets a 60-second signed link per download (app/api/guides/download).
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { GUIDES, GUIDES_BUCKET, type GuideSlug } from './catalog';

/** Seconds a download link works for. The library mints a fresh one per click. */
export const DOWNLOAD_LINK_TTL_SECONDS = 60;

/** The object key a guide is stored under in the private bucket. */
export function guideObjectKey(slug: GuideSlug): string {
    return `${slug}.pdf`;
}

/**
 * A short-lived signed URL for one guide, served as an attachment under its
 * published file name. Null when storage is unreachable or the file is
 * missing, which the caller turns into a message, never a broken download.
 */
export async function signedGuideUrl(slug: GuideSlug): Promise<string | null> {
    try {
        const { data, error } = await createAdminClient()
            .storage.from(GUIDES_BUCKET)
            .createSignedUrl(guideObjectKey(slug), DOWNLOAD_LINK_TTL_SECONDS, { download: GUIDES[slug].sourceFile });
        if (error || !data?.signedUrl) {
            logger.error('Could not sign a guide download', null, { slug, error: error?.message ?? 'no url' });
            return null;
        }
        return data.signedUrl;
    } catch (error) {
        logger.error('Guide storage unavailable', error, { slug });
        return null;
    }
}
