import { brand } from '@/config/brand'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/protect'
import { safeInternalPath } from '@/lib/auth/safe-redirect'
import LoginContent from '@/components/auth/LoginContent'
import AuthLayout from '@/components/auth/AuthLayout'
import { Suspense } from 'react'

export const metadata = {
  // P7 runtime fix D7: root layout template appends `| ${brand.name}`.
  title: 'Sign In',
  description: `Sign in to your ${brand.name} account to manage saved jobs, job alerts, and applications.`,
  // Page is noindexed via middleware X-Robots-Tag (per app/robots.ts P2.3
  // unblock window). Self-canonical still emitted so any inbound link
  // variants (?redirectTo=…) consolidate to the bare /login URL.
  alternates: { canonical: `${brand.baseUrl}/login` },
  robots: { index: false, follow: true },
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>
}) {
  const currentUser = await getCurrentUser()
  const params = await searchParams
  const safeRedirect = safeInternalPath(params.redirectTo, '/dashboard')
  if (currentUser) {
    redirect(safeRedirect)
  }

  return (
    // P0 #18: the fabricated first-name-only testimonial was removed — same
    // E-E-A-T rationale as the purged /about testimonials (app/about/
    // AboutClient.tsx SEO Fix H11). Reinstate ONLY with a real, opted-in,
    // attributable quote.
    <AuthLayout illustration="/illustrations/auth-login.png">
      <Suspense
        fallback={
          <div className="space-y-4">
            <div className="h-12 rounded-lg animate-pulse" style={{ background: 'rgba(0,0,0,0.04)' }} />
            <div className="h-12 rounded-lg animate-pulse" style={{ background: 'rgba(0,0,0,0.04)' }} />
            <div className="h-12 rounded-lg animate-pulse" style={{ background: 'rgba(0,0,0,0.04)' }} />
          </div>
        }
      >
        <LoginContent />
      </Suspense>
    </AuthLayout>
  )
}
