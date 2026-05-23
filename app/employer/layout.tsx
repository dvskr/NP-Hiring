import { Metadata } from 'next';

export const metadata: Metadata = {
    title: {
        template: '%s — NP Hiring',
        default: 'Employer Portal — NP Hiring',
    },
    robots: { index: false, follow: false },
};

export default function EmployerLayout({ children }: { children: React.ReactNode }) {
    return children;
}
