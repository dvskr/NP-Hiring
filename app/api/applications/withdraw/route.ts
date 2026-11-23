import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { readJsonObject } from '@/lib/request-body';
import { withdrawApplication } from '@/lib/applications/withdraw';

/**
 * DELETE /api/applications/withdraw
 * Withdraw an application and scrub applicant data (GDPR right to erasure).
 * Body: { applicationId: string }
 *
 * The scrub itself lives in lib/applications/withdraw.ts, shared with the
 * AI app's withdraw_application tool.
 */
export async function DELETE(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await readJsonObject(request);
        const outcome = await withdrawApplication(user.id, body?.applicationId);
        if (!outcome.ok) {
            return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Error withdrawing application:', error);
        return NextResponse.json(
            { error: 'Failed to withdraw application' },
            { status: 500 }
        );
    }
}
