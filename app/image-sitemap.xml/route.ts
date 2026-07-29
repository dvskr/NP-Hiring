import { brand } from '@/config/brand';
import { NextResponse } from 'next/server';
import { getAllPageImages } from '@/lib/image-seo';

const BASE_URL = brand.baseUrl;

export const dynamic = 'force-static';
export const revalidate = 86400; // daily

/**
 * Generates an image sitemap following Google's image sitemap extension.
 *
 * P0 OG sweep: entries come from lib/image-seo.ts, which now only maps
 * board-resolvable images (local /images/** paths or the /api/og edge
 * renderer) — never a remote storage bucket. Image locs are XML-escaped
 * because /api/og URLs carry `&`-joined query params.
 *
 * P2 #21: that map is no longer purely hand-maintained. getAllPageImages()
 * appends the state-diorama entries derived from the same helpers the state
 * and salary-guide pages render (components/StateImage), so the shipped
 * artwork set is advertised without a second list to keep in sync. This
 * handler stays a pure synchronous serializer — no DB, no fs — so it renders
 * identically at build time and on ISR revalidation inside a lambda, where
 * `public/` is not on the filesystem.
 *
 * @see https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps
 */
export function GET() {
    const images = getAllPageImages();

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${images
            .map(
                (entry) => `  <url>
    <loc>${escapeXml(`${BASE_URL}${entry.url}`)}</loc>
    <image:image>
      <image:loc>${escapeXml(entry.image.startsWith('http') ? entry.image : `${BASE_URL}${entry.image}`)}</image:loc>
      <image:title>${escapeXml(entry.title)}</image:title>
      <image:caption>${escapeXml(entry.caption)}</image:caption>
    </image:image>
  </url>`
            )
            .join('\n')}
</urlset>`;

    return new NextResponse(xml, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        },
    });
}

function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
