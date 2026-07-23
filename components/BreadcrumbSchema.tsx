import React from 'react';

interface BreadcrumbItem {
    name: string;
    url: string;
}

export default function BreadcrumbSchema({ items }: { items: BreadcrumbItem[] }) {
    const schema = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": items.map((item, index) => ({
            "@type": "ListItem",
            "position": index + 1,
            "name": item.name,
            "item": item.url
        }))
    };

    // SEO/security fix (B29): item names can carry aggregator-sourced job
    // titles. Escape < and > so a literal "</script>" can never terminate
    // this element early (schema corruption + XSS vector). Same pattern as
    // app/jobs/page.tsx and components/JobStructuredData.tsx.
    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
                __html: JSON.stringify(schema)
                    .replace(/</g, '\\u003c')
                    .replace(/>/g, '\\u003e'),
            }}
        />
    );
}
