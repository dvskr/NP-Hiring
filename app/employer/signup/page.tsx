import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Employer Sign Up | NP Hiring',
  description: 'Create your employer account to start posting NP jobs',
}

export default function EmployerSignUpPage() {
  redirect('/signup?role=employer')
}
