import { redirect } from 'next/navigation'
import { brand } from '@/config/brand'

export const metadata = {
  title: `Employer Sign Up | ${brand.name}`,
  description: `Create your employer account to start posting ${brand.niche.short} jobs`,
}

export default function EmployerSignUpPage() {
  redirect('/signup?role=employer')
}
