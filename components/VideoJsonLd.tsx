import { getPageVideoSEO } from '@/lib/video-seo';
import { brand } from '@/config/brand';

/**
 * Publisher logo for VideoObject.publisher.
 *
 * P3 #1: this used to point at a donor-era `.webp` logo in the retired
 * remote asset bucket (the one P1 #1 purged everywhere else), addressed on
 * THIS board's Supabase project — where that object was never uploaded. A
 * guaranteed 404 in the one field Google fetches to render the publisher
 * mark. Every other publisher/Organization schema on the board already
 * derives from the local `public/logo.png` (app/layout.tsx,
 * app/blog/[slug], app/salary-guide, app/press); this now matches, so
 * there is a single logo asset to keep alive.
 *
 * Dimensions are the real intrinsic size of public/logo.png (1024×1024) —
 * pinned by the P3 regression test, which reads them out of the PNG header.
 */
const PUBLISHER_LOGO = {
    path: '/logo.png',
    width: 1024,
    height: 1024,
} as const;

interface VideoJsonLdProps {
    pathname: string;
}

/**
 * Resolve a path-or-absolute URL into a fully-qualified URL.
 *
 * GSC Fix: previously we did `${brand.baseUrl}${video.thumbnail}` even when
 * `video.thumbnail` was already an absolute Supabase URL — producing a
 * malformed concatenation like `https://<brand.domain>https://<storage-host>/...`
 * which GSC flagged as "Invalid URL in field 'thumbnailUrl'" and which
 * disqualified the page from VideoObject rich results.
 */
function absUrl(value: string): string {
    if (/^https?:\/\//i.test(value)) return value;
    return `${brand.baseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
}

/**
 * Normalize a config-provided uploadDate (typically a YYYY-MM-DD literal)
 * to ISO 8601 with a UTC time zone. Schema.org expects a full datetime;
 * GSC reports both "Invalid datetime value" and "missing a time zone"
 * when only a date is supplied.
 */
function toIsoDatetime(value: string): string {
    if (/T\d{2}:\d{2}/.test(value)) return value; // already a datetime
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
    return value;
}

/**
 * Serialize JSON-LD for dangerouslySetInnerHTML using the repo's standard
 * escape chain (same as app/blog/[slug], app/salary-guide, components/
 * JobStructuredData) so a `</script>` sequence in any mapped title or
 * description can never break out of the script element.
 */
function serializeJsonLd(obj: unknown): string {
    return JSON.stringify(obj)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e');
}

/**
 * Renders a VideoObject JSON-LD script tag for the given page.
 * Returns null if no video is mapped for the route.
 */
export default function VideoJsonLd({ pathname }: VideoJsonLdProps) {
    const video = getPageVideoSEO(pathname);
    if (!video) return null;

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: video.title,
        description: video.description,
        thumbnailUrl: absUrl(video.thumbnail),
        contentUrl: absUrl(video.video),
        uploadDate: toIsoDatetime(video.uploadDate),
        duration: `PT${video.duration}S`,
        embedUrl: absUrl(video.video),
        inLanguage: 'en',
        isFamilyFriendly: true,
        potentialAction: {
            '@type': 'WatchAction',
            target: `${brand.baseUrl}${pathname}`,
        },
        publisher: {
            '@type': 'Organization',
            name: brand.name,
            url: brand.baseUrl,
            logo: {
                '@type': 'ImageObject',
                url: absUrl(PUBLISHER_LOGO.path),
                width: PUBLISHER_LOGO.width,
                height: PUBLISHER_LOGO.height,
            },
        },
    };

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
    );
}

