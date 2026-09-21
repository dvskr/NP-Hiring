import { NextRequest, NextResponse } from 'next/server';
import { uploadResume, uploadAvatar, validateFile } from '@/lib/supabase-storage';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';
import { classifyUploadError, isMissingBucketError, type UploadKind } from './upload-errors';
import { ensureUploadBucket } from './ensure-bucket';

type StoredFile = { path: string; url: string };

/**
 * Stores the file, self-healing a missing storage bucket once (see
 * ensureUploadBucket). Any other failure propagates to the caller.
 */
async function storeFile(buffer: Buffer, file: File, kind: UploadKind, userId: string): Promise<StoredFile> {
  const upload = () => kind === 'resume'
    ? uploadResume(buffer, file.name, file.type, userId)
    : uploadAvatar(buffer, file.name, file.type, userId);
  try {
    return await upload();
  } catch (err) {
    if (!isMissingBucketError(err) || !(await ensureUploadBucket(kind))) throw err;
    return upload();
  }
}

export async function POST(request: NextRequest) {
  // Rate limiting for uploads (stricter)
  const rateLimitResult = await rateLimit(request, 'upload', { limit: 10, windowSeconds: 60 });
  if (rateLimitResult) return rateLimitResult;

  let userId: string | undefined;
  let uploadType: UploadKind | undefined;

  try {
    // Get authenticated user from Supabase session
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }
    userId = user.id;

    // Get the form data
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: 'Expected a multipart form upload' }, { status: 400 });
    }
    const file = formData.get('file');
    const rawType = formData.get('type');

    // Validate required fields
    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (rawType !== 'resume' && rawType !== 'avatar') {
      return NextResponse.json(
        { error: 'Invalid upload type. Must be "resume" or "avatar"' },
        { status: 400 }
      );
    }
    uploadType = rawType;

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate file
    const validation = validateFile(buffer, file.name, file.type, uploadType);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // The upload is recorded on the profile. Check it exists BEFORE storing
    // anything so a missing profile never leaves an orphaned document.
    const profile = await prisma.userProfile.findUnique({
      where: { supabaseId: user.id },
      select: { id: true },
    });
    if (!profile) {
      return NextResponse.json(
        { error: 'Your profile is not set up yet. Reload the page and try again.', code: 'profile_missing' },
        { status: 409 }
      );
    }

    // Upload based on type (using authenticated user's ID)
    const result = await storeFile(buffer, file, uploadType, user.id);

    if (uploadType === 'resume') {
      // Store the permanent storage path (not the signed URL which expires).
      // Sprint 2.1.P5: status stays 'pending' until the client commits the
      // preview via the ResumeAutofillReview modal (`/api/resume/parse`
      // without `?preview=1`). We removed the fire-and-forget background
      // trigger here so the user reviews the extraction before any
      // profile/license/cert rows are written.
      await prisma.userProfile.update({
        where: { supabaseId: user.id },
        data: {
          resumeUrl: result.path,
          resumeParseStatus: 'pending'
        },
      });
    } else {
      // Update user profile with avatar URL
      await prisma.userProfile.update({
        where: { supabaseId: user.id },
        data: { avatarUrl: result.url },
      });
    }

    return NextResponse.json({
      success: true,
      url: result.url,
      path: result.path,
    });
  } catch (error) {
    const failure = classifyUploadError(error, uploadType ?? 'resume');
    const context = { userId, uploadType, status: failure.status, code: failure.code };
    if (failure.status >= 500) {
      logger.error('Error uploading file', error, context);
    } else {
      logger.warn('Upload rejected', context, error);
    }
    return NextResponse.json(
      { error: failure.error, code: failure.code },
      { status: failure.status }
    );
  }
}
