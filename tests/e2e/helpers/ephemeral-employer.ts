/**
 * Ephemeral employer factory for the employer-funnel journey.
 *
 * WHY: the free first post is keyed to the signup email DOMAIN
 * (EmployerJob.quotaDomain, see app/api/jobs/post-free/route.ts). The
 * shared E2E employer burns its one free post the first time the wizard
 * runs, after which /post-job shows the "paid posting is coming soon" gate
 * and the wizard can never be exercised again. So the lifecycle tests mint
 * a brand-new confirmed employer on a unique domain per run and tear it
 * down (jobs, applications, drafts, profile views, leads, profile, auth
 * user) when the describe block finishes.
 *
 * Requires a service-role key for the SAME Supabase project the app under
 * test talks to. Preferred explicit opt-in vars (as used by the existing
 * signup regression test), falling back to the app's own .env values which
 * playwright.config.ts already loads:
 *   E2E_SUPABASE_URL              || NEXT_PUBLIC_SUPABASE_URL
 *   E2E_SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY
 * Never runs against production (caller guards with AGAINST_PROD).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface EphemeralEmployer {
    email: string;
    password: string;
    supabaseId: string;
    company: string;
    /** Unique signup domain → fresh free-post quota. */
    domain: string;
    /** Company contact email used inside the wizard (non-free-mail domain). */
    contactEmail: string;
    /** Short alphanumeric tag embedded in job titles for search assertions. */
    runTag: string;
}

function serviceEnv(): { url: string; key: string } | null {
    const url = process.env.E2E_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    return url && key ? { url, key } : null;
}

export function ephemeralSupportAvailable(): boolean {
    return serviceEnv() !== null && process.env.E2E_ALLOW_EPHEMERAL_USERS !== 'false';
}

async function serviceClient(): Promise<SupabaseClient> {
    const env = serviceEnv();
    if (!env) throw new Error('ephemeral-employer: no service-role credentials in env');
    const { assertNotProduction } = await import('../../support/production-db-guard');
    assertNotProduction({ context: 'e2e ephemeral employer', mutating: true });
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(env.url, env.key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function createEphemeralEmployer(): Promise<EphemeralEmployer> {
    const admin = await serviceClient();
    const runTag = `lc${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toLowerCase();
    const domain = `e2e-${runTag}.example.invalid`;
    const email = `e2e-lifecycle-${runTag}@${domain}`;
    const password = `E2eLc!${runTag}#Zq9`;
    const company = `E2E Lifecycle Health ${runTag}`;

    const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: 'employer', first_name: 'E2E', last_name: 'Lifecycle', company },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? 'no user'}`);

    return {
        email,
        password,
        supabaseId: data.user.id,
        company,
        domain,
        contactEmail: `hiring@${domain}`,
        runTag,
    };
}

/** Look up the UserProfile.id (cuid) for an auth user's email. */
export async function profileIdForEmail(email: string): Promise<string | null> {
    const admin = await serviceClient();
    const { data } = await admin.from('user_profiles').select('id').eq('email', email).maybeSingle();
    return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Tear down everything the lifecycle run created. Best-effort and
 * idempotent — each step swallows "not found". Job deletes cascade to
 * employer_jobs, job_applications, job_screening_questions (Prisma
 * onDelete: Cascade); the profile delete cascades conversations/messages.
 */
export async function destroyEphemeralEmployer(emp: EphemeralEmployer): Promise<string[]> {
    const admin = await serviceClient();
    const log: string[] = [];

    const owned = await admin.from('employer_jobs').select('job_id').eq('user_id', emp.supabaseId);
    const jobIds = ((owned.data ?? []) as { job_id: string }[]).map((r) => r.job_id);
    if (jobIds.length) {
        const del = await admin.from('jobs').delete().in('id', jobIds);
        log.push(`jobs deleted: ${jobIds.length}${del.error ? ` (error: ${del.error.message})` : ''}`);
    }
    // Delete the auth identity FIRST: /api/auth/profile auto-creates a
    // profile for any authenticated caller, so a straggling request from
    // the last test can resurrect the row if the profile goes before the
    // auth user does. Then sweep profile rows by id and by email.
    const { error } = await admin.auth.admin.deleteUser(emp.supabaseId);
    log.push(`auth user: ${error ? `error ${error.message}` : 'deleted'}`);
    const steps: Array<[string, PromiseLike<{ error: { message: string } | null }>]> = [
        ['job_drafts', admin.from('job_drafts').delete().eq('user_id', emp.supabaseId)],
        ['profile_views', admin.from('profile_views').delete().eq('viewer_id', emp.supabaseId)],
        ['employer_leads', admin.from('employer_leads').delete().eq('contact_email', emp.email)],
        ['user_profiles(by id)', admin.from('user_profiles').delete().eq('supabase_id', emp.supabaseId)],
        ['user_profiles(by email)', admin.from('user_profiles').delete().eq('email', emp.email)],
    ];
    for (const [name, p] of steps) {
        const { error: stepError } = await p;
        log.push(`${name}: ${stepError ? `error ${stepError.message}` : 'ok'}`);
    }
    return log;
}

/**
 * Look up the Supabase auth id for a profile email. Employer-facing candidate
 * routes (/employer/candidates/[id], POST /api/employer/messages recipientId)
 * are keyed on UserProfile.supabaseId, not the profile cuid.
 */
export async function authIdForEmail(email: string): Promise<string | null> {
    const admin = await serviceClient();
    const { data } = await admin.from('user_profiles').select('supabase_id').eq('email', email).maybeSingle();
    return (data as { supabase_id?: string } | null)?.supabase_id ?? null;
}
