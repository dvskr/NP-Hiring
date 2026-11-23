import { createClient } from '@/lib/supabase/server';

/**
 * Who may change the job alerts sent to an address, or switch email back on
 * for it.
 *
 * The alert forms take any address, so typing one proves nothing. Until
 * 2026-11 POST /api/job-alerts lifted an unsubscribe and switched a paused
 * alert back on for whoever typed the address, so anyone who knew an email
 * could start that person's alert emails again. Both now need the address's
 * owner: a signed-in session on it, with the address confirmed (the rule
 * /api/job-alerts/by-email already applied).
 */

/** Two addresses are one mailbox under any capitals. */
export function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The signed-in account's confirmed email, or null: signed out, unconfirmed, or no request to read a session from. */
export async function signedInEmail(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user?.email || !user.email_confirmed_at) return null;
    return user.email;
  } catch {
    return null;
  }
}

/** True when the caller has shown it controls the address: a signed-in session on it. */
export async function provesControlOf(email: string): Promise<boolean> {
  const own = await signedInEmail();
  return own !== null && sameAddress(own, email);
}
