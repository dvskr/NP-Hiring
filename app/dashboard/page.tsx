import { brand } from '@/config/brand'
import { requireAuth } from '@/lib/auth/protect'
import { redirect } from 'next/navigation'
import BreadcrumbSchema from '@/components/BreadcrumbSchema'
import DashboardContent from '@/components/dashboard/DashboardContent'

export const metadata = {
  title: `Dashboard | ${brand.niche.short} Jobs`,
}

export default async function DashboardPage() {
  const { profile } = await requireAuth()

  // Redirect employers to their dedicated dashboard
  if (profile?.role === 'employer') {
    redirect('/employer/dashboard')
  }

  return (
    <>
      <BreadcrumbSchema items={[
        { name: 'Home', url: brand.baseUrl },
        { name: 'Dashboard', url: `${brand.baseUrl}/dashboard` },
      ]} />
      <DashboardContent />
    </>
  )
}
