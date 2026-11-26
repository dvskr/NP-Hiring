import { guideJsonLdString } from '@/lib/guides/schema';

/** Renders one JSON-LD block. All guides store structured data goes through here. */
export default function GuideSchema({ data }: { readonly data: Record<string, unknown> }) {
    return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: guideJsonLdString(data) }} />;
}
