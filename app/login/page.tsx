import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/protect'
import LoginContent from '@/components/auth/LoginContent'
import AuthLayout from '@/components/auth/AuthLayout'
import { Suspense } from 'react'

export const metadata = {
  title: 'Sign In | NP Hiring',
  description: 'Sign in to your NP Hiring account to manage saved jobs, job alerts, and applications.',
  // Page is noindexed via middleware X-Robots-Tag (per app/robots.ts P2.3
  // unblock window). Self-canonical still emitted so any inbound link
  // variants (?redirectTo=…) consolidate to the bare /login URL.
  alternates: { canonical: 'https://nphiring.com/login' },
  robots: { index: false, follow: true },
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>
}) {
  const currentUser = await getCurrentUser()
  const params = await searchParams
  const redirectTo = params.redirectTo || '/dashboard'
  const safeRedirect = redirectTo.startsWith('/') ? redirectTo : '/dashboard'
  if (currentUser) {
    redirect(safeRedirect)
  }

  return (
    <AuthLayout
      illustration="/illustrations/auth-login.png"
      testimonial={{
        quote: '"I found my dream remote NP position in less than a week. The job matching was incredibly accurate."',
        name: 'Sarah M., APRN-BC',
        title: 'Austin, TX',
      }}
    >
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
