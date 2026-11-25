/**
 * Who is behind an admin request, decided in one place for both admin gates:
 * the API guard (lib/auth/require-api-admin.ts) and the cron manual trigger
 * (lib/auth/verify-cron-or-admin.ts).
 *
 * An account in its deletion window keeps its Supabase identity until the
 * purge, and its row keeps role 'admin', so the role alone does not make an
 * admin: a soft-deleted admin is refused like any other non-admin.
 *
 * A Supabase outage must not read as "signed out". getUser() reports a
 * network failure or a 502, 503 or 504 as an error value rather than a throw,
 * so those are told apart here and the gates answer 500 for them. Anything
 * thrown (a Prisma connection drop, a misconfigured client) reaches the
 * gate's own catch, which answers 500 as well.
 */
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';

export type AdminSession =
    | { status: 'admin'; profileId: string; supabaseId: string }
    | { status: 'signed_out' }
    | { status: 'not_admin' }
    | { status: 'auth_unavailable'; error: unknown };

/** Every outcome that is not an admin, for the gates that turn it into a response. */
export type AdminSessionRefusal = Exclude<AdminSession, { status: 'admin' }>;

/**
 * Error names supabase-js gives a failure of the auth service itself: a
 * request that never got an answer (or a 502, 503, 504), and an answer that
 * was not the JSON the auth API sends (a proxy error page).
 */
const AUTH_SERVICE_ERROR_NAMES: readonly string[] = ['AuthRetryableFetchError', 'AuthUnknownError'];

/** An auth API answer at or above this status is the service failing, not the caller. */
const FIRST_SERVER_ERROR_STATUS = 500;

/** True for a getUser() error that says the auth service failed, not that the caller is signed out. */
export function isAuthServiceFailure(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const { name, status } = error as { name?: unknown; status?: unknown };
    if (typeof name === 'string' && AUTH_SERVICE_ERROR_NAMES.includes(name)) return true;
    return typeof status === 'number' && status >= FIRST_SERVER_ERROR_STATUS;
}

interface AdminProfileRow {
    id: string;
    role: string;
    deletedAt: Date | null;
}

/** An admin row that is not soft-deleted. No row at all is not an admin. */
export function isActiveAdmin(profile: AdminProfileRow | null | undefined): profile is AdminProfileRow {
    return !!profile && profile.role === 'admin' && !profile.deletedAt;
}

/**
 * Resolve the session behind the current request. Never authorizes on a
 * failure: an unanswered auth service is 'auth_unavailable', and a throw
 * propagates to the caller.
 */
export async function resolveAdminSession(): Promise<AdminSession> {
    const supabase = await createClient();
    const {
        data: { user },
        error,
    } = await supabase.auth.getUser();

    if (isAuthServiceFailure(error)) return { status: 'auth_unavailable', error };
    if (error || !user) return { status: 'signed_out' };

    const profile = await prisma.userProfile.findUnique({
        where: { supabaseId: user.id },
        select: { id: true, role: true, deletedAt: true },
    });

    if (!isActiveAdmin(profile)) return { status: 'not_admin' };
    return { status: 'admin', profileId: profile.id, supabaseId: user.id };
}
