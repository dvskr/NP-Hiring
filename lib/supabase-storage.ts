import { createClient } from '@supabase/supabase-js';
import { scanFileForViruses } from '@/lib/virus-scan';
import { logger } from '@/lib/logger';

// Initialize Supabase client for storage operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for server-side operations
);

const RESUME_BUCKET = 'resumes'; // Private bucket for resumes
const AVATAR_BUCKET = 'avatars'; // Public bucket for avatars
const UPLOAD_PREFIX = process.env.STORAGE_UPLOAD_PREFIX || 'local'; // local, dev, or prod

// Allowed file types
const ALLOWED_RESUME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
];

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

// Max file sizes (in bytes)
const MAX_RESUME_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;  // 2MB

/**
 * Upload a resume file to Supabase Storage
 */
export async function uploadResume(
  file: Buffer,
  fileName: string,
  fileType: string,
  userId: string
): Promise<{ path: string; url: string }> {
  // Validate file type
  if (!ALLOWED_RESUME_TYPES.includes(fileType)) {
    throw new Error('Invalid file type. Only PDF and DOC/DOCX files are allowed.');
  }

  // Validate file size
  if (file.length > MAX_RESUME_SIZE) {
    throw new Error(`File size exceeds maximum of ${MAX_RESUME_SIZE / 1024 / 1024}MB`);
  }

  // Virus scan BEFORE writing to storage. Fails closed by default
  // (see lib/virus-scan.ts for the env knobs). When the scan API key
  // is missing, the scan is skipped with a structured warn — uploads
  // still go through, so dev environments aren't blocked.
  const scan = await scanFileForViruses(file, fileName);
  if (!scan.clean) {
    logger.warn('uploadResume: rejected by virus scanner', {
      userId,
      fileName,
      threats: scan.threats,
      contentRisks: scan.contentRisks,
    });
    throw new Error(scan.message || 'File rejected by virus scanner.');
  }

  // Generate unique path
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const path = `${UPLOAD_PREFIX}/${userId}/${timestamp}-${sanitizedFileName}`;

  // Upload to Supabase Storage (private bucket)
  const { data, error } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(path, file, {
      contentType: fileType,
      upsert: false,
    });

  if (error) {
    logger.error('Supabase upload error', error);
    throw new Error(`Failed to upload resume: ${error.message}`);
  }

  // Get signed URL (valid for 1 hour for resumes — short-lived to protect PII)
  const { data: urlData, error: urlError } = await supabase.storage
    .from(RESUME_BUCKET)
    .createSignedUrl(data.path, 3600); // 1 hour in seconds

  if (urlError) {
    throw new Error(`Failed to generate URL: ${urlError.message}`);
  }

  return {
    path: data.path,
    url: urlData.signedUrl,
  };
}

/**
 * Upload an avatar/profile image to Supabase Storage
 */
export async function uploadAvatar(
  file: Buffer,
  fileName: string,
  fileType: string,
  userId: string
): Promise<{ path: string; url: string }> {
  // Validate file type
  if (!ALLOWED_IMAGE_TYPES.includes(fileType)) {
    throw new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.');
  }

  // Validate file size
  if (file.length > MAX_IMAGE_SIZE) {
    throw new Error(`File size exceeds maximum of ${MAX_IMAGE_SIZE / 1024 / 1024}MB`);
  }

  // Generate unique path
  const timestamp = Date.now();
  const extension = fileName.split('.').pop();
  const path = `${UPLOAD_PREFIX}/${userId}/${timestamp}.${extension}`;

  // Upload to Supabase Storage (public bucket)
  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, {
      contentType: fileType,
      upsert: false,
    });

  if (error) {
    logger.error('Supabase upload error', error);
    throw new Error(`Failed to upload avatar: ${error.message}`);
  }

  // Get public URL (avatars are public)
  const { data: urlData } = supabase.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(data.path);

  return {
    path: data.path,
    url: urlData.publicUrl,
  };
}

/**
 * Delete a file from Supabase Storage
 */
export async function deleteFile(path: string, fileType: 'resume' | 'avatar'): Promise<void> {
  const bucket = fileType === 'resume' ? RESUME_BUCKET : AVATAR_BUCKET;

  const { error } = await supabase.storage
    .from(bucket)
    .remove([path]);

  if (error) {
    logger.error('Supabase delete error', error);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

const MESSAGE_ATTACHMENT_BUCKET = 'message-attachments';
const FOLDER_PAGE_SIZE = 100;
/** A bound on list rounds per folder, so a store that keeps answering cannot loop a sweep. */
const MAX_FOLDER_ROUNDS = 50;
/**
 * The one word upload prefixes a deployment has used. Ownership accepts a key
 * under any of them (isOwnStoragePath), so the sweeps below read them all.
 */
const KNOWN_UPLOAD_PREFIXES = ['local', 'dev', 'prod'];
/** An upload younger than this is never swept: a cover letter is stored before the application that names it. */
const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

type UploadSweep = { removed: number; failed: string[] };

/** True for an id that is one folder name, as every upload key's uid segment is. */
function isUploadFolderName(supabaseId: string): boolean {
  return UPLOAD_KEY_SEGMENT.test(supabaseId) && supabaseId !== '..';
}

/** `<prefix>/<uid>` under the configured prefix and every known one. */
function prefixedUploadFolders(supabaseId: string): string[] {
  return Array.from(new Set([UPLOAD_PREFIX, ...KNOWN_UPLOAD_PREFIXES])).map((prefix) => `${prefix}/${supabaseId}`);
}

/** The store's answer for a bucket nobody has uploaded to yet (message attachments create theirs on first use). */
function isMissingBucket(message: string): boolean {
  return /bucket not found/i.test(message);
}

/**
 * Every file directly in `folder` (sub-folders are not entered), page by
 * page, and whether the listing reached the end within MAX_FOLDER_ROUNDS.
 */
async function listFolderFiles(
  bucket: string,
  folder: string,
): Promise<{ files: Array<{ path: string; createdAt: string | null }>; complete: boolean }> {
  const files: Array<{ path: string; createdAt: string | null }> = [];
  for (let round = 0; round < MAX_FOLDER_ROUNDS; round++) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(folder, { limit: FOLDER_PAGE_SIZE, offset: round * FOLDER_PAGE_SIZE });
    if (error) {
      if (isMissingBucket(error.message)) return { files, complete: true };
      throw new Error(error.message);
    }
    const page = data ?? [];
    // A folder entry has no id; only files are listed.
    for (const entry of page) {
      if (entry.id !== null) files.push({ path: `${folder}/${entry.name}`, createdAt: entry.created_at ?? null });
    }
    if (page.length < FOLDER_PAGE_SIZE) return { files, complete: true };
  }
  return { files, complete: false };
}

/**
 * Removes every file directly in `folder`, a page at a time from the top
 * until the folder is empty, and says whether it got there within
 * MAX_FOLDER_ROUNDS. Throws when the store refuses.
 */
async function emptyFolder(bucket: string, folder: string): Promise<{ removed: number; complete: boolean }> {
  let removed = 0;
  for (let round = 0; round < MAX_FOLDER_ROUNDS; round++) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: FOLDER_PAGE_SIZE });
    if (error) {
      if (isMissingBucket(error.message)) return { removed, complete: true };
      throw new Error(error.message);
    }
    const page = data ?? [];
    removed += await removePaths(bucket, page.filter((entry) => entry.id !== null).map((entry) => `${folder}/${entry.name}`));
    if (page.length < FOLDER_PAGE_SIZE) return { removed, complete: true };
  }
  return { removed, complete: false };
}

/** Removes `paths` from `bucket`, a page at a time; throws when the store refuses. */
async function removePaths(bucket: string, paths: readonly string[]): Promise<number> {
  for (let start = 0; start < paths.length; start += FOLDER_PAGE_SIZE) {
    const { error } = await supabase.storage.from(bucket).remove(paths.slice(start, start + FOLDER_PAGE_SIZE));
    if (error) throw new Error(error.message);
  }
  return paths.length;
}

/**
 * Remove every object in an account's own upload folders, for account
 * erasure (the purge-soft-deleted cron) only: `<prefix>/<uid>/` in the resume
 * bucket (resumes and the cover letters stored beside them) and the avatar
 * bucket, under every known prefix, and `<uid>/` in the message attachment
 * bucket.
 *
 * The purge deleted only the objects the profile pointed at when it ran, so
 * every earlier upload survived erasure (register 2.26). Every object listed
 * here sits in the account's own folder, so all of them go. A folder that
 * cannot be listed or emptied, or still holds files at the bound, is reported,
 * never thrown, so the rest of the erasure still runs; a bucket that was
 * never created holds nothing to erase.
 * Tests: tests/lib/remove-user-upload-folders.test.ts.
 */
export async function removeUserUploadFolders(supabaseId: string): Promise<UploadSweep> {
  if (!isUploadFolderName(supabaseId)) return { removed: 0, failed: [] };
  const folders = [
    ...prefixedUploadFolders(supabaseId).map((folder) => ({ bucket: RESUME_BUCKET, folder })),
    ...prefixedUploadFolders(supabaseId).map((folder) => ({ bucket: AVATAR_BUCKET, folder })),
    { bucket: MESSAGE_ATTACHMENT_BUCKET, folder: supabaseId },
  ];
  let removed = 0;
  const failed: string[] = [];
  for (const { bucket, folder } of folders) {
    try {
      const emptied = await emptyFolder(bucket, folder);
      removed += emptied.removed;
      if (!emptied.complete) {
        logger.error('removeUserUploadFolders: an upload folder still holds files at the bound', null, { bucket, folder });
        failed.push(`${bucket}/${folder}`);
      }
    } catch (err) {
      logger.error('removeUserUploadFolders: could not empty an upload folder', err, { bucket, folder });
      failed.push(`${bucket}/${folder}`);
    }
  }
  return { removed, failed };
}

/**
 * Remove the uploads in an account's own resume folders that nothing names:
 * replaced resumes, and cover letters no application holds. For the resume
 * DELETE, which removed only the current resume, so every earlier upload
 * stayed for good (register 2.26).
 *
 * `named` holds the keys the account's applications still name; those stay,
 * because the employer opens the file an application names. An upload less
 * than a day old stays too, and so does one whose age the store does not
 * give. A folder that cannot be read or cleared, or is read only in part at
 * the bound, is reported, never thrown.
 * Tests: tests/lib/remove-user-upload-folders.test.ts.
 */
export async function removeUnreferencedResumeUploads(
  supabaseId: string,
  named: ReadonlySet<string>,
  now: Date = new Date(),
): Promise<UploadSweep> {
  if (!isUploadFolderName(supabaseId)) return { removed: 0, failed: [] };
  const cutoff = now.getTime() - SWEEP_MIN_AGE_MS;
  const isOld = (createdAt: string | null): boolean => {
    const at = createdAt === null ? Number.NaN : Date.parse(createdAt);
    return Number.isFinite(at) && at < cutoff;
  };
  let removed = 0;
  const failed: string[] = [];
  for (const folder of prefixedUploadFolders(supabaseId)) {
    try {
      const listing = await listFolderFiles(RESUME_BUCKET, folder);
      const unnamed = listing.files
        .filter((file) => !named.has(file.path) && isOld(file.createdAt))
        .map((file) => file.path);
      removed += await removePaths(RESUME_BUCKET, unnamed);
      if (!listing.complete) {
        logger.error('removeUnreferencedResumeUploads: a resume folder was read only in part at the bound', null, { folder });
        failed.push(`${RESUME_BUCKET}/${folder}`);
      }
    } catch (err) {
      logger.error('removeUnreferencedResumeUploads: could not sweep a resume folder', err, { folder });
      failed.push(`${RESUME_BUCKET}/${folder}`);
    }
  }
  return { removed, failed };
}

/**
 * One segment of an upload key. uploadResume and uploadAvatar build every key
 * as `<upload prefix>/<uploader's supabase uid>/<timestamped name>`. The prefix
 * ('local', 'dev' or 'prod') and the uid always fit this set, and a resume
 * name is sanitized to it. An avatar name ends in the uploaded file's own
 * extension, unsanitized: an avatar key holding another character fails the
 * ownership rule below, so PATCH /api/auth/profile ignores it and the purge
 * cron leaves that object in storage (the URL /api/upload stored still shows).
 */
const UPLOAD_KEY_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * SECURITY (AUTH-PROFILE-1, RES-1 to RES-4, APP-2, EMP-RES-1): true only for
 * an upload key in `ownerId`'s own folder, exactly `<prefix>/<ownerId>/<file>`.
 *
 * The stored resume and avatar columns were writable by their owner, so a
 * stored value proved nothing about whose object it named, and the readers
 * signed, downloaded or deleted it with the service role. Every writer and
 * reader of those columns now checks this first.
 *
 * Allow-list, not deny-list: storage-js puts the key into the request URL
 * unencoded, where '..', '%2e%2e', a backslash, a tab, '?' or '#' would change
 * which object is addressed, so anything outside UPLOAD_KEY_SEGMENT fails. A
 * one word prefix is not pinned to the current STORAGE_UPLOAD_PREFIX: ownership
 * rests on the uid segment, and a prefix change must not lock owners out of
 * older uploads. A multi-part prefix is accepted only when it is exactly the
 * configured one, so a deployment that set one is not locked out either.
 * Tests: tests/lib/storage-ownership.test.ts.
 */
export function isOwnStoragePath(
  path: string | null | undefined,
  ownerId: string | null | undefined,
): boolean {
  if (typeof path !== 'string' || typeof ownerId !== 'string' || ownerId === '') return false;
  const segments = path.split('/');
  if (segments.length < 3 || !segments.every((segment) => UPLOAD_KEY_SEGMENT.test(segment))) return false;
  const prefixSegments = segments.slice(0, -2);
  const isKnownPrefix = prefixSegments.length === 1 || prefixSegments.join('/') === UPLOAD_PREFIX;
  return isKnownPrefix && segments[segments.length - 2] === ownerId;
}

/**
 * The key of a stored avatar URL when it names an object in `ownerId`'s own
 * upload folder, otherwise null (another user's avatar, a sign-in provider
 * picture, any other link, a non-string).
 */
export function toOwnAvatarPath(stored: unknown, ownerId: string): string | null {
  if (typeof stored !== 'string') return null;
  const path = getPathFromUrl(stored);
  return isOwnStoragePath(path, ownerId) ? path : null;
}

/**
 * Get a public URL for an avatar file
 */
export function getAvatarUrl(path: string): string {
  const { data } = supabase.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(path);

  return data.publicUrl;
}

/**
 * Extract the storage path from a full URL
 */
export function getPathFromUrl(url: string): string | null {
  try {
    // For signed URLs (resumes): https://xxx.supabase.co/storage/v1/object/sign/resumes/path?token=...
    const signMatch = url.match(/\/storage\/v1\/object\/sign\/[^/]+\/(.+?)(?:\?|$)/);
    if (signMatch) return signMatch[1];

    // For public URLs (avatars): https://xxx.supabase.co/storage/v1/object/public/avatars/path
    const publicMatch = url.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)$/);
    return publicMatch ? publicMatch[1] : null;
  } catch {
    return null;
  }
}

/**
 * Magic byte signatures for file type verification.
 * Prevents attackers from uploading malicious files with spoofed MIME types.
 */
const MAGIC_BYTES: Record<string, { offset: number; bytes: number[] }[]> = {
  // PDF: starts with %PDF
  'application/pdf': [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }],
  // DOCX/XLSX/PPTX (ZIP-based): starts with PK
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    { offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] },
    { offset: 0, bytes: [0x50, 0x4B, 0x05, 0x06] },
  ],
  // Legacy DOC: starts with D0 CF 11 E0
  'application/msword': [
    { offset: 0, bytes: [0xD0, 0xCF, 0x11, 0xE0] },
    // Some .doc files are actually DOCX (PK signature)
    { offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] },
  ],
  // JPEG: starts with FF D8 FF
  'image/jpeg': [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF] }],
  'image/jpg': [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF] }],
  // PNG: starts with 89 50 4E 47
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47] }],
  // WebP: starts with RIFF....WEBP
  'image/webp': [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }],
};

function verifyMagicBytes(buffer: Buffer, fileType: string): boolean {
  const signatures = MAGIC_BYTES[fileType];
  if (!signatures) return true; // Unknown type — skip magic byte check

  return signatures.some(sig => {
    if (buffer.length < sig.offset + sig.bytes.length) return false;
    return sig.bytes.every((byte, i) => buffer[sig.offset + i] === byte);
  });
}

/**
 * Validate file before upload
 */
export function validateFile(
  buffer: Buffer,
  fileName: string,
  fileType: string,
  uploadType: 'resume' | 'avatar'
): { valid: boolean; error?: string } {
  const maxSize = uploadType === 'resume' ? MAX_RESUME_SIZE : MAX_IMAGE_SIZE;
  const allowedTypes = uploadType === 'resume' ? ALLOWED_RESUME_TYPES : ALLOWED_IMAGE_TYPES;

  if (buffer.length > maxSize) {
    return {
      valid: false,
      error: `File size exceeds maximum of ${maxSize / 1024 / 1024}MB`,
    };
  }

  if (!allowedTypes.includes(fileType)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`,
    };
  }

  // Verify magic bytes to prevent MIME type spoofing
  if (!verifyMagicBytes(buffer, fileType)) {
    return {
      valid: false,
      error: 'File content does not match declared file type',
    };
  }

  return { valid: true };
}

