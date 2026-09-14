/**
 * Maps failures thrown by lib/supabase-storage.ts uploadResume/uploadAvatar
 * (and the profile write that follows) to specific HTTP answers. Before this
 * every failure collapsed into a generic 500 "Failed to upload file", which
 * hid both user errors (type, size, scanner rejection) and the real
 * environment fault (the storage bucket did not exist).
 */

export interface UploadFailure {
  status: number
  code: string
  error: string
}

export type UploadKind = 'resume' | 'avatar'

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return ''
}

/** Supabase Storage answers "Bucket not found" when the bucket is missing. */
export function isMissingBucketError(err: unknown): boolean {
  return /bucket not found/i.test(messageOf(err))
}

function prismaCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

export function classifyUploadError(err: unknown, kind: UploadKind): UploadFailure {
  const message = messageOf(err)
  const noun = kind === 'resume' ? 'resume' : 'photo'

  if (/^Invalid file type/i.test(message)) {
    return {
      status: 415,
      code: 'invalid_type',
      error: kind === 'resume'
        ? 'Invalid file type. Upload a PDF or Word document.'
        : 'Invalid file type. Upload a JPEG, PNG, or WebP image.',
    }
  }
  if (/^File size exceeds/i.test(message)) {
    return { status: 413, code: 'too_large', error: message }
  }
  // Scanner verdicts (lib/virus-scan.ts). A service outage is not the
  // user's fault: answer 503 so they retry instead of changing the file.
  if (/^Virus scanner (returned|failure)/i.test(message)) {
    return {
      status: 503,
      code: 'scanner_unavailable',
      error: `We could not scan your ${noun} right now. Please try again in a few minutes.`,
    }
  }
  if (/^Threat detected/i.test(message) || /disallowed content/i.test(message) || /rejected by virus scanner/i.test(message)) {
    return {
      status: 422,
      code: 'rejected_by_scanner',
      error: `This file was rejected by our security scan. Upload a different ${noun} without macros, scripts, or password protection.`,
    }
  }
  if (isMissingBucketError(err)) {
    return {
      status: 503,
      code: 'storage_unavailable',
      error: 'File storage is temporarily unavailable. Please try again later.',
    }
  }
  // Prisma: record to update not found (no UserProfile row yet).
  if (prismaCode(err) === 'P2025') {
    return {
      status: 409,
      code: 'profile_missing',
      error: 'Your profile is not set up yet. Reload the page and try again.',
    }
  }
  return { status: 500, code: 'upload_failed', error: 'Failed to upload file' }
}
