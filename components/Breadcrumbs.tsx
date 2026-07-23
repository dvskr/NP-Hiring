import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';
import { brand } from '@/config/brand';

interface BreadcrumbItem {
  label: string;
  href?: string; // Optional - last item has no link
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

  // Generate JSON-LD schema for SEO
  const schemaData = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      item: item.href ? `${baseUrl}${item.href}` : undefined,
    })),
  };

  return (
    <>
      {/* Schema markup for SEO.
          B29: labels carry aggregator-sourced job titles on job pages —
          escape < and > so a literal "</script>" can never terminate this
          element early (same pattern as components/JobStructuredData.tsx). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schemaData)
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e'),
        }}
      />

      {/* Visual breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex items-center flex-wrap gap-1 text-sm">
          {items.map((item, index) => (
            <li key={index} className="flex items-center">
              {index > 0 && (
                <ChevronRight
                  className="w-4 h-4 mx-1 flex-shrink-0"
                  style={{ color: 'var(--text-tertiary)' }}
                  aria-hidden="true"
                />
              )}
              {item.href ? (
                <Link
                  href={item.href}
                  className="bc-link flex items-center gap-1 transition-colors"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {index === 0 && <Home className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span>{item.label}</span>
                </Link>
              ) : (
                <span
                  // Tighter cap on phones (where parents + separators are
                  // already eating row width) so the current crumb still
                  // shows a useful chunk before truncating.
                  className="font-medium truncate max-w-[140px] sm:max-w-none"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {item.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <style>{`
        .bc-link:hover {
          color: #F472B6 !important;
        }
      `}</style>
    </>
  );
}
