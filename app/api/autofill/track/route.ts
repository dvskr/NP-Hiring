import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { cleanText, clampInt, isRecord } from '../_lib/input';

// SECURITY (AUTOFILL-TRACK-1): this handler stored aiGenerations, fieldsFilled,
// pageUrl and atsName exactly as the body sent them. The monthly AI quota is
// the SUM of aiGenerations (../_lib/quota.ts), so `aiGenerations: -100000`
// drove the sum negative and lifted the free and pro caps on every AI route.
// The AI routes record their own generations server-side and the extension
// always sends 0 here, so the client value is ignored and 0 is stored. The
// other fields are typed and bounded: a long ATS URL is cut rather than
// rejected, and a malformed body answers 400 instead of 500.
// Test: tests/api/autofill-track-quota.test.ts
const MAX_PAGE_URL_CHARS = 2_048;
const MAX_ATS_NAME_CHARS = 100;
/** No real form fills more fields than this in one run. */
const MAX_FIELDS_FILLED = 500;

interface TrackInput {
    pageUrl: string;
    atsName: string | null;
    fieldsFilled: number;
}

/** The autofill record to store, or null when the body has no usable pageUrl. */
function parseTrackInput(body: unknown): TrackInput | null {
    if (!isRecord(body)) return null;
    const pageUrl = cleanText(body.pageUrl, MAX_PAGE_URL_CHARS);
    if (!pageUrl) return null;
    return {
        pageUrl,
        atsName: cleanText(body.atsName, MAX_ATS_NAME_CHARS) || null,
        fieldsFilled: clampInt(body.fieldsFilled, 0, MAX_FIELDS_FILLED, 0),
    };
}

export async function POST(req: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(req, 'autofill-track', RATE_LIMITS.telemetry);
    if (rateLimitResult) return rateLimitResult;

    try {
        const user = await verifyExtensionToken(req);
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const input = parseTrackInput(await req.json().catch(() => null));
        if (!input) {
            return NextResponse.json({ error: 'pageUrl is required' }, { status: 400 });
        }

        await prisma.autofillUsage.create({
            data: {
                userId: user.userId,
                pageUrl: input.pageUrl,
                atsName: input.atsName,
                fieldsFilled: input.fieldsFilled,
                // Never from the body: see the SECURITY note above.
                aiGenerations: 0,
            },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Track autofill error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
