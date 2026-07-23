'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { safeInternalPath } from '@/lib/auth/safe-redirect'

/**
 * /auth/confirm
 * 
 * Client-side page that handles Supabase hash fragment redirects.
 * @supabase/ssr browser client does NOT auto-detect hash fragments,
 * so we manually extract access_token and refresh_token from the URL hash
 * and call setSession() to establish the auth session.
 * 
 * Handles:
 * - Magic link confirmations (#access_token=...&type=magiclink)
 * - Password reset links (#access_token=...&type=recovery)
 * 
 * The server-side /auth/callback remains for Google OAuth (PKCE with ?code=)
 */
export default function AuthConfirmPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'expired'>('loading')
  const [message, setMessage] = useState('Confirming your account...')
  // B84: inline resend-confirmation surface for expired signup links.
  const [resendEmail, setResendEmail] = useState('')
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const handleResendConfirmation = async () => {
    const email = resendEmail.trim()
    if (!email || resendStatus === 'sending' || resendStatus === 'sent') return
    setResendStatus('sending')
    try {
      const res = await fetch('/api/auth/send-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setResendStatus(res.ok ? 'sent' : 'error')
    } catch {
      setResendStatus('error')
    }
  }

  useEffect(() => {
    const handleAuth = async () => {
      try {
        const supabase = createClient()

        // --- Check for errors from Supabase (e.g. expired OTP) ---
        const urlParams = new URLSearchParams(window.location.search)
        // F26: SignUpForm threads the pre-signup destination through the
        // confirmation email as ?next= (e.g. /jobs/xyz?apply=1 from
        // ApplyButton). Validated to a same-origin path — falls back to
        // /dashboard for absent or hostile values.
        const requestedNext = safeInternalPath(urlParams.get('next'), '/dashboard')
        // B77: interstitial-first for brand-new candidates. When the
        // confirmation link carries no explicit destination, land on the
        // skippable /onboarding/professional interstitial instead of the
        // bare dashboard. The interstitial self-guards server-side —
        // employers/admins and already-searchable profiles are forwarded
        // straight to their dashboards — so this is safe for every role.
        // Explicit intent (?next=/jobs/xyz?apply=1 etc.) always wins.
        const nextPath = requestedNext === '/dashboard' ? '/onboarding/professional' : requestedNext
        const queryError = urlParams.get('error')
        const queryErrorCode = urlParams.get('error_code')
        const queryErrorDesc = urlParams.get('error_description')

        if (queryError || queryErrorCode) {
          console.error('Auth error from query params:', queryError, queryErrorCode, queryErrorDesc)
          if (queryErrorCode === 'otp_expired') {
            // B84: an expired RECOVERY link should mint a new reset link on
            // /forgot-password, but an expired SIGNUP/magic-link confirmation
            // must land on a resend-confirmation surface — sending those
            // users to password reset dead-ends people who never had a
            // password confirmed in the first place.
            if (urlParams.get('type') === 'recovery') {
              setStatus('error')
              setMessage('This password reset link has expired. Redirecting so you can request a new one...')
              setTimeout(() => router.push('/forgot-password'), 3000)
              return
            }
            setStatus('expired')
            setMessage('This confirmation link has expired.')
            return
          }
          setStatus('error')
          setMessage(queryErrorDesc?.replace(/\+/g, ' ') || 'Authentication failed. Please try again.')
          setTimeout(() => router.push('/login'), 4000)
          return
        }

        // --- Strategy 1: PKCE flow (code in query params) ---
        // @supabase/ssr uses PKCE by default. Supabase's verify endpoint
        // redirects with ?code=xxx in the query string after validating the token.
        const code = urlParams.get('code')

        if (code) {
          console.log('Auth confirm - exchanging PKCE code for session')
          const { data, error } = await supabase.auth.exchangeCodeForSession(code)

          if (error) {
            console.warn('PKCE code exchange failed:', error.message)

            // PKCE verifier mismatch — happens when the confirmation email
            // opens in a different tab/browser than where signup occurred.
            // Supabase already confirmed the user server-side during the
            // redirect (before appending ?code=), so the email IS confirmed.
            // We just can't establish a client session without the verifier.
            // Carry the return target into login so the intent survives.
            setMessage('Email confirmed! Please log in to continue.')
            setStatus('success')
            const loginUrl = nextPath !== '/dashboard'
              ? `/login?confirmed=true&redirectTo=${encodeURIComponent(nextPath)}`
              : '/login?confirmed=true'
            setTimeout(() => router.push(loginUrl), 2000)
            return
          }

          // Determine type from the session metadata
          const isRecovery = data.session?.user?.recovery_sent_at || 
            urlParams.get('type') === 'recovery'

          if (isRecovery) {
            setMessage('Verified! Redirecting to reset password...')
            setStatus('success')
            router.push('/reset-password')
            return
          }

          // Email confirmation — user is now logged in
          setMessage('Email confirmed! Redirecting...')
          setStatus('success')
          // F27: bootstrap the UserProfile server-side NOW. The signup-time
          // profile POST 401'd (no session existed), so ensureProfileFromAuth
          // (invoked by GET /api/auth/profile) creates the profile plus the
          // opt-ins stashed in auth metadata (JobAlert / EmailLead /
          // EmployerLead / Beehiiv). Awaited so the welcome call below finds
          // the profile; failure is tolerated — the next authenticated
          // request runs the same idempotent bootstrap.
          try { await fetch('/api/auth/profile') } catch { /* non-blocking */ }
          // Send welcome email (fire-and-forget, dedup handled server-side)
          const userEmail = data.session?.user?.email
          if (userEmail) {
            fetch('/api/auth/welcome', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: userEmail }),
            }).catch(() => {})
          }
          setTimeout(() => router.push(nextPath), 1500)
          return
        }

        // --- Strategy 2: Implicit flow (tokens in hash fragment) ---
        // Fallback for admin-generated links (e.g. /api/auth/send-confirmation)
        const hash = window.location.hash.substring(1) // remove '#'
        if (!hash) {
          console.log('No code or hash fragment found, redirecting to login')
          setStatus('error')
          setMessage('Invalid or expired link. Redirecting to login...')
          setTimeout(() => router.push('/login'), 2000)
          return
        }

        // Parse the hash fragment
        const params = new URLSearchParams(hash)
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')
        const type = params.get('type')
        const errorParam = params.get('error')
        const errorDescription = params.get('error_description')


        if (errorParam) {
          console.error('Auth error from hash:', errorParam, errorDescription)
          setStatus('error')
          setMessage(errorDescription?.replace(/\+/g, ' ') || 'Authentication failed. Please try again.')
          setTimeout(() => router.push('/login'), 3000)
          return
        }

        if (!accessToken || !refreshToken) {
          console.error('Missing tokens in hash fragment')
          setStatus('error')
          setMessage('Invalid authentication link. Please request a new one.')
          setTimeout(() => router.push('/login'), 3000)
          return
        }

        // Set the session using the tokens from the hash
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })

        if (error) {
          console.error('Failed to set session:', error.message)
          setStatus('error')
          setMessage('Session expired or invalid. Please try again.')
          setTimeout(() => router.push('/login'), 3000)
          return
        }


        // Handle different auth types
        if (type === 'recovery') {
          setMessage('Verified! Redirecting to reset password...')
          setStatus('success')
          router.push('/reset-password')
          return
        }

        // Magic link / email confirmation — user is now logged in
        setMessage('Email confirmed! Redirecting...')
        setStatus('success')
        // F27: same server-side profile + opt-in bootstrap as the PKCE path
        // above — see that comment for why this must precede the welcome call.
        try { await fetch('/api/auth/profile') } catch { /* non-blocking */ }
        // Send welcome email (fire-and-forget, dedup handled server-side)
        const userEmail2 = data.session?.user?.email
        if (userEmail2) {
          fetch('/api/auth/welcome', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail2 }),
          }).catch(() => {})
        }
        setTimeout(() => router.push(nextPath), 1500)
      } catch (err) {
        console.error('Auth confirm unexpected error:', err)
        setStatus('error')
        setMessage('Something went wrong. Please try again.')
        setTimeout(() => router.push('/login'), 3000)
      }
    }

    handleAuth()
  }, [router])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary, #060E18)',
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          padding: '48px 32px',
          background: 'var(--bg-secondary, #0F1923)',
          borderRadius: '16px',
          border: '1px solid var(--border-color, #1E293B)',
          maxWidth: '420px',
          width: '100%',
        }}
      >
        {status === 'loading' && (
          <div
            style={{
              width: '40px',
              height: '40px',
              border: '3px solid rgba(244,114,182,0.2)',
              borderTopColor: '#F472B6',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 20px',
            }}
          />
        )}
        {status === 'success' && (
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>✅</div>
        )}
        {status === 'error' && (
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>⚠️</div>
        )}
        {status === 'expired' && (
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>⏳</div>
        )}
        <p
          style={{
            color: status === 'error' ? '#EF4444' : 'var(--text-primary, #F1F5F9)',
            fontSize: '16px',
            fontWeight: 600,
            margin: 0,
          }}
        >
          {message}
        </p>
        {/* B84: resend-confirmation surface for expired signup links —
            keeps the user in the confirmation flow instead of bouncing
            them to password reset. */}
        {status === 'expired' && (
          <div style={{ marginTop: '20px', textAlign: 'left' }}>
            <label
              htmlFor="resend-email"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary, #94A3B8)', marginBottom: '6px' }}
            >
              Enter your email and we&apos;ll send a fresh confirmation link:
            </label>
            <input
              id="resend-email"
              type="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              style={{
                width: '100%',
                padding: '11px 14px',
                fontSize: '14px',
                borderRadius: '10px',
                border: '1px solid var(--border-color, #1E293B)',
                background: 'var(--bg-primary, #060E18)',
                color: 'var(--text-primary, #F1F5F9)',
                outline: 'none',
                marginBottom: '10px',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="button"
              onClick={handleResendConfirmation}
              disabled={!resendEmail.trim() || resendStatus === 'sending' || resendStatus === 'sent'}
              style={{
                width: '100%',
                padding: '11px 14px',
                fontSize: '14px',
                fontWeight: 700,
                borderRadius: '10px',
                border: 'none',
                background: '#F472B6',
                color: '#0F1923',
                cursor: !resendEmail.trim() || resendStatus === 'sending' || resendStatus === 'sent' ? 'not-allowed' : 'pointer',
                opacity: !resendEmail.trim() || resendStatus === 'sending' || resendStatus === 'sent' ? 0.6 : 1,
              }}
            >
              {resendStatus === 'sending'
                ? 'Sending...'
                : resendStatus === 'sent'
                  ? '✓ Confirmation email sent — check your inbox'
                  : 'Resend confirmation email'}
            </button>
            {resendStatus === 'error' && (
              <p style={{ fontSize: '12px', color: '#EF4444', margin: '8px 0 0' }}>
                Could not send the email. Wait a minute and try again, or sign in to resend from there.
              </p>
            )}
            <p style={{ fontSize: '12px', color: 'var(--text-secondary, #94A3B8)', margin: '12px 0 0', textAlign: 'center' }}>
              Already confirmed?{' '}
              <a href="/login" style={{ color: '#F472B6', fontWeight: 600 }}>Sign in</a>
            </p>
          </div>
        )}
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  )
}
