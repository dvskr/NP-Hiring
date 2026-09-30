"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import UserMenu from './UserMenu'
import { User } from '@supabase/supabase-js'
import { calculateCompleteness, ProfileData } from '@/lib/profile-completeness'
import { loadHeaderProfile, clearHeaderProfile } from './header-profile-store'

interface UserProfile {
  email: string
  role: string
  firstName?: string | null
  lastName?: string | null
  avatarUrl?: string | null
}

interface HeaderAuthProps {
  onNavigate?: () => void;
  onRoleChange?: (role: string | null) => void;
}

/*
 * Signed-out Log in / Sign up pills in the soft blush header (owner decision
 * 5, option B, 2026-09-29): Log in is white with #3D2A2E text and a berry
 * hairline; Sign up is solid #9D174D with white text. The neumorphic white
 * inset highlights went with the mint bar.
 *
 * Every state lives in this stylesheet, never in inline styles or mouse
 * handlers. The old handlers wrote an inline box-shadow, which beats the
 * global :focus-visible ring (so keyboard focus showed nothing), and their
 * primary check compared the inline background colour to an rgb() string
 * written without spaces, a form browsers never produce, so one hover left
 * Sign up pale pink until reload.
 *
 * React 19 hoists the <style> into <head> and keeps one copy however many
 * HeaderAuth instances render (desktop bar, compact bar, mobile menu). The
 * string is static: a plain style element with no interpolation, not
 * styled-jsx.
 */
const HEADER_AUTH_CSS = `
.header-auth-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease, transform 0.2s ease;
}
.header-auth-login {
  padding: 0 18px;
  height: 38px;
  font-size: 14px;
  font-weight: 500;
  color: #3D2A2E;
  background-color: #FFFFFF;
  border: 1px solid rgba(122,28,43,0.14);
}
.header-auth-login:hover {
  color: #7A1C2B;
  background-color: #FFF7F9;
  border-color: rgba(122,28,43,0.28);
}
.header-auth-signup {
  padding: 0 20px;
  height: 40px;
  font-size: 15px;
  font-weight: 600;
  color: #FFFFFF;
  background-color: #9D174D;
  border: 1px solid #9D174D;
  box-shadow: 0 4px 12px rgba(157,23,77,0.25);
}
.header-auth-signup:hover {
  background-color: #831843;
  border-color: #831843;
  box-shadow: 0 6px 16px rgba(157,23,77,0.30);
}
.header-auth-pill:hover {
  transform: translateY(-1px);
}
.header-auth-pill:active {
  transform: scale(0.98);
}
.header-auth-pill:focus-visible {
  outline: 2px solid #BE185D;
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .header-auth-pill { transition: none; }
  .header-auth-pill:hover,
  .header-auth-pill:active { transform: none; }
}
`

export default function HeaderAuth({ onNavigate, onRoleChange }: HeaderAuthProps) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileCompleteness, setProfileCompleteness] = useState(100)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    let active = true

    // Every HeaderAuth instance (and UserMenu) shares one in-flight
    // /api/auth/profile request and its cached result via loadHeaderProfile.
    const applyProfile = async (authUser: User, force = false) => {
      const profileData = await loadHeaderProfile(authUser.id, { force })
      if (!active || !profileData) return
      setProfile({
        email: authUser.email ?? '',
        role: profileData.role,
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        avatarUrl: profileData.avatarUrl,
      })
      onRoleChange?.(profileData.role)
      if (profileData.role === 'job_seeker') {
        setProfileCompleteness(calculateCompleteness(profileData as unknown as ProfileData).percentage)
      }
    }

    const getUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!active) return
        setUser(user)
        if (user) await applyProfile(user)
      } catch (err) {
        console.error('Failed to load the signed-in user:', err)
      } finally {
        if (active) setLoading(false)
      }
    }

    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // INITIAL_SESSION and TOKEN_REFRESHED carry no profile change; the
        // mount-time getUser above already loads the profile.
        if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return

        const authUser = session?.user ?? null
        setUser(authUser)

        if (authUser) {
          // SIGNED_IN for an already-loaded user resolves from the cache;
          // USER_UPDATED means name/avatar may have changed, so refetch.
          void applyProfile(authUser, event === 'USER_UPDATED')
        } else {
          clearHeaderProfile()
          setProfile(null)
          onRoleChange?.(null)
        }
      }
    )

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-3">
        <div className="w-16 h-8 motion-safe:animate-pulse rounded-xl" style={{
          backgroundColor: 'rgba(122,28,43,0.08)',
        }} />
      </div>
    )
  }

  if (user && profile) {
    if (profile.role === 'admin') {
      return (
        <div className="flex items-center gap-2">
          <UserMenu user={profile} isMobile={!!onNavigate} />
        </div>
      )
    }
    // Notification-bell button removed (was a duplicate entry point to
    // /messages — both seeker and employer roles already have Messages in
    // the main nav + the BottomNav on mobile). Cleaner header chrome,
    // fewer redundant CTAs, no half-implemented unread-count dot.
    if (profile.role === 'employer') {
      return (
        <div className="flex items-center gap-3">
          <UserMenu user={profile} isMobile={!!onNavigate} />
        </div>
      )
    }
    return (
      <div className="flex items-center gap-3">
        <UserMenu user={profile} profileCompleteness={profileCompleteness} isMobile={!!onNavigate} />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <style href="header-auth-pills" precedence="default">
        {HEADER_AUTH_CSS}
      </style>
      <Link href="/login" onClick={onNavigate} className="header-auth-pill header-auth-login">
        Log in
      </Link>
      <Link href="/signup" onClick={onNavigate} className="header-auth-pill header-auth-signup">
        Sign up
      </Link>
    </div>
  )
}
