import { Metadata } from 'next';
import { brand } from '@/config/brand';

export const metadata: Metadata = {
    title: {
        template: `%s — ${brand.name}`,
        default: `Employer Portal — ${brand.name}`,
    },
    robots: { index: false, follow: false },
};

export default function EmployerLayout({ children }: { children: React.ReactNode }) {
    return children;
}
