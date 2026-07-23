import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
    CONSENT_COOKIE,
    CONSENT_VERSION,
    serializeConsent,
    type ConsentCategories,
} from '@/lib/consent';

/**
 * POST /api/consent — set the user's consent choice as an HttpOnly cookie.
 *
 * The cookie is server-only-writable-and-readable, so a successful XSS
 * payload cannot flip the recorded choice. Client-side code learns the
 * user's prior choice via the middleware-maintained non-HttpOnly MIRROR
 * cookie (CONSENT_MIRROR_COOKIE in lib/consent.ts, read by
 * components/consent/* after mount) — the root layout must NOT read this
 * cookie via cookies(), because any Dynamic API in the root layout
 * disables ISR app-wide (ISR fix F5). The mirror is read-only
 * convenience state; this HttpOnly cookie remains the authoritative
 * record.
 *
 * Closes audit gap #19 (consent stored in localStorage = XSS-writable).
 */
const bodySchema = z.object({
    categories: z.object({
        analytics: z.boolean(),
        marketing: z.boolean(),
    }),
});

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function isLocalhost(req: NextRequest): boolean {
    return req.headers.get('host')?.includes('localhost') ?? false;
}

export async function POST(req: NextRequest) {
    let parsed: z.infer<typeof bodySchema>;
    try {
        parsed = bodySchema.parse(await req.json());
    } catch {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const value = serializeConsent(parsed.categories as ConsentCategories);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(CONSENT_COOKIE, value, {
        httpOnly: true,
        secure: !isLocalhost(req),
        sameSite: 'lax',
        path: '/',
        maxAge: ONE_YEAR_SECONDS,
    });
    return res;
}

/**
 * DELETE /api/consent — clear the consent cookie so the banner re-prompts.
 * Used by "Cookie Settings" footer link.
 */
export async function DELETE(req: NextRequest) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(CONSENT_COOKIE, '', {
        httpOnly: true,
        secure: !isLocalhost(req),
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    });
    return res;
}

export function GET() {
    // Body of the cookie is intentionally unreadable via the API. The
    // banner doesn't need to read it — the layout passes initial state
    // as a prop. This GET is kept for future server-only callers and
    // returns a stub so health checks don't 404.
    return NextResponse.json({ version: CONSENT_VERSION, ok: true });
}
