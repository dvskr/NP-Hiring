import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';

export type JdTemplateGate =
    | { ok: true; userId: string }
    | { ok: false; response: NextResponse };

/**
 * Pure status decision for the jd-templates gate, split out for unit tests.
 * No session is 401; a session without the employer role is 403.
 */
export function jdTemplateGateStatus(
    hasUser: boolean,
    role: string | null | undefined,
): 200 | 401 | 403 {
    if (!hasUser) return 401;
    return role === 'employer' ? 200 : 403;
}

/**
 * Auth gate shared by /api/employer/jd-templates and /api/employer/jd-templates/[id].
 * Distinguishes "not signed in" (401) from "signed in but not an employer" (403),
 * matching every other /api/employer/* route. Fails closed on an auth error.
 */
export async function requireJdTemplateOwner(): Promise<JdTemplateGate> {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    const hasUser = !error && !!user;

    const role = hasUser
        ? (await prisma.userProfile.findUnique({ where: { supabaseId: user!.id }, select: { role: true } }))?.role
        : null;

    const status = jdTemplateGateStatus(hasUser, role);
    if (status === 401) {
        return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }
    if (status === 403) {
        return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { ok: true, userId: user!.id };
}
