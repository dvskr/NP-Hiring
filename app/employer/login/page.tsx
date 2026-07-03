import { redirect } from 'next/navigation'
import { brand } from '@/config/brand'

export const metadata = {
  title: `Employer Login | ${brand.name}`,
  description: 'Log in to your employer dashboard to manage job postings',
}

export default function EmployerLoginPage() {
  redirect('/login?role=employer')
}
