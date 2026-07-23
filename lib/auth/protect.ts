import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { ensureProfileFromAuth } from '@/lib/auth/ensure-profile'

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
 * Require admin role
 */
export async function requireAdmin(returnTo?: string) {
  return requireRole(['admin'], returnTo)
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

  return {
    user: { id: user.id, email: user.email! },
    profile: profile as UserProfile | null
  }
}

