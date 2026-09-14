import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

interface UpdateAlertBody {
  frequency?: string;
  isActive?: boolean;
}

// PATCH - Update alert by token
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token is required' },
        { status: 400 }
      );
    }

    // Parse JSON separately: a malformed body is a 400, not the catch-all 500.
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json(
        { success: false, error: 'Request body must be a JSON object' },
        { status: 400 }
      );
    }
    const { frequency, isActive } = parsed as Record<keyof UpdateAlertBody, unknown>;

    // Type-check every field before it reaches Prisma (a non-boolean isActive
    // made the update throw, which surfaced as a 500).
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'isActive must be true or false' },
        { status: 400 }
      );
    }

    // Validate frequency if provided
    if (
      frequency !== undefined &&
      (typeof frequency !== 'string' || !['daily', 'weekly'].includes(frequency))
    ) {
      return NextResponse.json(
        { success: false, error: 'Frequency must be "daily" or "weekly"' },
        { status: 400 }
      );
    }

    const jobAlert = await prisma.jobAlert.findUnique({
      where: { token },
    });

    if (!jobAlert) {
      return NextResponse.json(
        { success: false, error: 'Job alert not found' },
        { status: 404 }
      );
    }

    const updatedAlert = await prisma.jobAlert.update({
      where: { token },
      data: {
        ...(frequency !== undefined && { frequency }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return NextResponse.json({
      success: true,
      alert: {
        id: updatedAlert.id,
        token: updatedAlert.token,
        frequency: updatedAlert.frequency,
        isActive: updatedAlert.isActive,
      },
    });
  } catch (error) {
    logger.error('Error updating job alert', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update job alert' },
      { status: 500 }
    );
  }
}

