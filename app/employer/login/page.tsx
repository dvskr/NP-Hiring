import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Employer Login | NP Hiring',
  description: 'Log in to your employer dashboard to manage job postings',
}

export default function EmployerLoginPage() {
  redirect('/login?role=employer')
}
