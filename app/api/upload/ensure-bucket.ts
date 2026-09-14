import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { UploadKind } from './upload-errors'

/**
 * Bucket definitions matching lib/supabase-storage.ts: resumes are PRIVATE
 * (served only through short-lived signed URLs), avatars are public.
 * Limits mirror validateFile there.
 */
export const UPLOAD_BUCKETS: Record<UploadKind, { name: string; public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] }> = {
  resume: {
    name: 'resumes',
    public: false,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },
  avatar: {
    name: 'avatars',
    public: true,
    fileSizeLimit: 2 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  },
}

/**
 * Creates the storage bucket for an upload kind when it does not exist
 * (a fresh or reset Supabase project has none; the dev project was missing
 * both, so every resume upload failed with "Bucket not found"). Same
 * self-healing approach as /api/upload/message-attachment. Only called
 * after an upload already failed with "Bucket not found", so production
 * pays nothing. Returns true when the bucket exists afterwards.
 */
export async function ensureUploadBucket(kind: UploadKind): Promise<boolean> {
  const bucket = UPLOAD_BUCKETS[kind]
  try {
    const admin = createAdminClient()
    const { error } = await admin.storage.createBucket(bucket.name, {
      public: bucket.public,
      fileSizeLimit: bucket.fileSizeLimit,
      allowedMimeTypes: bucket.allowedMimeTypes,
    })
    if (error && !/already exists/i.test(error.message)) {
      logger.error('upload: could not create missing storage bucket', error, { bucket: bucket.name })
      return false
    }
    logger.warn('upload: storage bucket was missing and has been created', { bucket: bucket.name, public: bucket.public })
    return true
  } catch (err) {
    logger.error('upload: bucket bootstrap threw', err, { bucket: bucket.name })
    return false
  }
}
