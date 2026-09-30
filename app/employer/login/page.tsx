import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Employer Login',
  description: 'Log in to your employer dashboard to manage your job postings.',
}

export default function EmployerLoginPage() {
  redirect('/login?role=employer')
}
