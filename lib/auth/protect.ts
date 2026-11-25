import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { ensureProfileFromAuth } from '@/lib/auth/ensure-profile'
import { accountDeletionState, deletedAccountLoginPath } from '@/lib/auth/account-deletion-state'

// Type definitions
export type UserRole = 'job_seeker' | 'employer' | 'admin'

export interface AuthUser {
  id: string
  email: string
}

export interface UserProfile {
  id: string
  supabaseId: string
  email: string
  role: UserRole
  firstName: string | null
  lastName: string | null
  phone: string | null
  company: string | null
  resumeUrl: string | null
  avatarUrl: string | null
  /** Soft-delete columns (lib/auth/account-deletion-state.ts), read by requireAdmin. */
  deletedAt?: Date | null
  purgeAt?: Date | null
}

/**
 * Require authentication - redirects to /login if not authenticated.
 *
 * B86: pass `returnTo` (the path of the page invoking the guard) so the
 * login redirect carries `?next=<attempted path>` and the deep link
 * survives the round-trip. LoginContent already reads ?next= (validated
 * via safeInternalPath) and pushes it after sign-in.
 */
export async function requireAuth(returnTo?: string): Promise<{ user: AuthUser; profile: UserProfile | null }> {
  const supabase = await createClient()

  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login')
  }

  // Single source of truth for auto-create. See lib/auth/ensure-profile.ts —
  // this is the path that runs first for SSR-protected pages, so the role
  // selection it makes determines whether new employer signups land in
  // /employer/dashboard or get stranded in /onboarding/professional.
  const profile = await ensureProfileFromAuth<UserProfile>(prisma, user, {
    logSource: 'requireAuth',
  })

  return {
    user: { id: user.id, email: user.email! },
    profile,
  }
}

/**
 * Require specific role(s) - redirects to /unauthorized if role doesn't match
 */
export async function requireRole(allowedRoles: UserRole[], returnTo?: string): Promise<{ user: AuthUser; profile: UserProfile }> {
  const { user, profile } = await requireAuth(returnTo)

  if (!profile || !allowedRoles.includes(profile.role as UserRole)) {
    redirect('/unauthorized')
  }

  return { user, profile }
}

/**
 * Require admin role.
 *
 * An admin account in its deletion window is not an admin: the API guard
 * refuses it as well (lib/auth/admin-session.ts), and the console never
 * renders for it. Inside the window it goes to the login form with the
 * console path kept, because signing in again restores the account and
 * returns there. Past the window it is told the account is gone.
 */
export async function requireAdmin(returnTo?: string) {
  const session = await requireRole(['admin'], returnTo)
  const deletion = accountDeletionState(session.profile)
  if (deletion !== 'active') {
    redirect(deletedAccountLoginPath(deletion, returnTo))
  }
  return session
}

/**
 * Require employer role (or admin)
 */
export async function requireEmployer(returnTo?: string) {
  return requireRole(['employer', 'admin'], returnTo)
}

/**
 * Get current user without requiring auth (returns null if not logged in)
 */
export async function getCurrentUser(): Promise<{ user: AuthUser; profile: UserProfile | null } | null> {
  const supabase = await createClient()

  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  const profile = await prisma.userProfile.findUnique({
    where: { supabaseId: user.id }
  })

  // A soft-deleted account reads as signed out here, for two reasons. Public
  // surfaces must not treat an account that asked to be erased as a live
  // identity. And /login and /signup forward anyone this recognises to their
  // destination: for an admin that requireAdmin turns away during the
  // deletion window, that forward would loop between /login and /admin.
  // Nothing here restores the account; signing in again does.
  if (profile?.deletedAt) {
    return null
  }

  return {
    user: { id: user.id, email: user.email! },
    profile: profile as UserProfile | null
  }
}

