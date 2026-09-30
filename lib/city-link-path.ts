/**
 * Link target for a city's job page (indexing audit L-05).
 *
 * The 20 curated metro guides take priority over the generic city page:
 * /jobs/city/{slug} answers a permanent redirect to /jobs/metro/{slug} for
 * every slug lib/metro-data.ts knows (app/jobs/city/[slug]/page.tsx). An
 * internal link to the city form therefore burns a redirect hop on every
 * crawl and points Google at a URL that is not the canonical one. Link the
 * destination directly. The rule is the one app/jobs/locations/[state]
 * already applies to its city grid and app/sitemap.ts applies when it drops
 * metro twins from the city list.
 */
import { getMetroCity } from '@/lib/metro-data';

/** `/jobs/metro/{slug}` for a curated metro, else `/jobs/city/{slug}`. */
export function localJobsPath(citySlug: string): string {
    return getMetroCity(citySlug) ? `/jobs/metro/${citySlug}` : `/jobs/city/${citySlug}`;
}
