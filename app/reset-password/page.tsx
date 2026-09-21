"use client"

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Loader2, AlertCircle, CheckCircle, Eye, EyeOff, ArrowRight } from 'lucide-react'
import AuthLayout from '@/components/auth/AuthLayout'
import { inputWithRightIcon, labelStyle, eyeBtnStyle, errorBannerStyle, ctaButtonStyle } from '@/components/auth/authTokens'
import { getPasswordChangeMode, type PasswordChangeMode } from './recovery-session'

function ResetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [linkExpired, setLinkExpired] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  // 'checking' until the session is inspected; 'no-session' when there is no
  // recovery link session at all; otherwise see getPasswordChangeMode.
  const [mode, setMode] = useState<'checking' | 'no-session' | PasswordChangeMode>('checking')

  useEffect(() => {
    const errorCode = searchParams.get('error_code')
    const errorDescription = searchParams.get('error_description')
    if (errorCode === 'otp_expired' || errorDescription?.includes('expired')) {
      setLinkExpired(true)
    } else if (errorCode) {
      setError('Invalid or expired reset link. Please request a new one.')
    }
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    const inspectSession = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { if (!cancelled) setMode('no-session'); return }
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        const next = getPasswordChangeMode(aal?.currentAuthenticationMethods, Math.floor(Date.now() / 1000))
        if (!cancelled) setMode(next)
      } catch {
        // Fail closed: without a verifiable link session the current
        // password is required.
        if (!cancelled) setMode('reauthenticate')
      }
    }
    inspectSession()
    return () => { cancelled = true }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    if (password !== confirmPassword) { setError('Passwords do not match.'); setLoading(false); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); setLoading(false); return; }

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) { setMode('no-session'); return; }

      // Re-check at submit time: the page may have been open for a while.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      const submitMode = getPasswordChangeMode(aal?.currentAuthenticationMethods, Math.floor(Date.now() / 1000))
      if (submitMode === 'reauthenticate') {
        setMode('reauthenticate')
        if (!currentPassword) {
          setError('Enter your current password to confirm this change. If you do not know it, request a reset link instead.')
          return
        }
        const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })
        if (reauthError) {
          setError('Your current password is incorrect. If you do not know it, request a reset link instead.')
          return
        }
      }

      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) { setError(updateError.message); return; }
      setSuccess(true)
      setTimeout(() => { router.push('/login') }, 3000)
    } catch {
      setError('An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  const noSession = !linkExpired && !success && mode === 'no-session'

  const renderCard = (children: React.ReactNode) => (
    <div style={{
      background: '#FFFFFF', borderRadius: '20px', border: '1px solid #E2E8F0',
      boxShadow: '0 4px 24px rgba(0,0,0,0.04)', padding: '24px',
    }}>
      {children}
    </div>
  );

  return (
    <AuthLayout illustration="/illustrations/auth-forgot.png">
      <h1 style={{
        fontSize: '28px', fontWeight: 800, color: '#1A2E35',
        fontFamily: 'var(--font-lora), Georgia, serif',
        margin: '0 0 6px', letterSpacing: '-0.5px', textAlign: 'center',
      }}>
        {linkExpired ? 'Link Expired' : success ? 'Password Updated' : noSession ? 'Reset Link Required' : 'Set a New Password'}
      </h1>
      <p style={{ fontSize: '14px', color: '#6B7F8A', marginBottom: '20px', textAlign: 'center' }}>
        {linkExpired
          ? 'This link is no longer valid.'
          : success
            ? 'Redirecting you to login...'
            : noSession
              ? 'Open the reset link from your email to choose a new password.'
              : mode === 'reauthenticate'
                ? 'Confirm your current password, then choose a strong new one.'
                : 'Choose a strong password.'}
      </p>

      {renderCard(
        noSession ? (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', padding: '8px 0' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#FEF2F2', color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertCircle className="w-7 h-7" />
            </div>
            <p style={{ fontSize: '14px', color: '#6B7F8A', margin: 0 }}>This page needs a valid password reset link. Links expire after 1 hour.</p>
            <Link href="/forgot-password" style={{ ...ctaButtonStyle(false), width: 'auto', display: 'inline-flex', marginTop: '4px', textDecoration: 'none' }}>
              Request Reset Link
            </Link>
            <Link href="/login" style={{ fontSize: '13px', color: '#6B7F8A', textDecoration: 'none' }}>Return to login</Link>
          </div>
        ) : linkExpired ? (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', padding: '8px 0' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#FEF2F2', color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertCircle className="w-7 h-7" />
            </div>
            <p style={{ fontSize: '14px', color: '#6B7F8A', margin: 0 }}>For your security, reset links expire after 1 hour.</p>
            <Link href="/forgot-password" style={{ ...ctaButtonStyle(false), width: 'auto', display: 'inline-flex', marginTop: '4px', textDecoration: 'none' }}>
              Request New Link
            </Link>
            <Link href="/login" style={{ fontSize: '13px', color: '#6B7F8A', textDecoration: 'none' }}>Return to login</Link>
          </div>
        ) : success ? (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', padding: '8px 0' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#D1FAE5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle className="w-7 h-7" />
            </div>
            <p style={{ fontSize: '14px', color: '#6B7F8A', margin: 0 }}>Your password has been updated. Redirecting...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {error && (
              <div style={errorBannerStyle}>
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p style={{ fontSize: '13px', color: '#DC2626', margin: 0 }}>{error}</p>
              </div>
            )}
            {mode === 'reauthenticate' && (
              <div>
                <label htmlFor="reset-current" style={labelStyle}>Current password</label>
                <div style={{ position: 'relative' }}>
                  <input id="reset-current" type={showCurrentPassword ? 'text' : 'password'} value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password"
                    style={inputWithRightIcon} placeholder="Your current password" />
                  <button type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)} style={eyeBtnStyle}
                    aria-label={showCurrentPassword ? 'Hide current password' : 'Show current password'}>
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
            <div>
              <label htmlFor="reset-password" style={labelStyle}>New password</label>
              <div style={{ position: 'relative' }}>
                <input id="reset-password" type={showPassword ? 'text' : 'password'} value={password}
                  onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password"
                  style={inputWithRightIcon} placeholder="Minimum 8 characters" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={eyeBtnStyle}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="reset-confirm" style={labelStyle}>Confirm new password</label>
              <div style={{ position: 'relative' }}>
                <input id="reset-confirm" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password"
                  style={inputWithRightIcon} placeholder="Re-enter your password" />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} style={eyeBtnStyle}>
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading} style={ctaButtonStyle(loading)}>
              {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Updating...</> : <>Update password <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
        )
      )}
    </AuthLayout>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <AuthLayout>
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <Loader2 className="w-10 h-10 animate-spin" style={{ color: '#BE185D', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '14px', color: '#94A3B0' }}>Loading...</p>
        </div>
      </AuthLayout>
    }>
      <ResetPasswordContent />
    </Suspense>
  )
}
