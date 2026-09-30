/**
 * lib/pseo/listing-pagination.tsx
 *
 * One pagination rule for every paginated listing (indexing audit TECH-08,
 * TECH-09, M-01): the category landings, the state hubs, the category x
 * state and category x city pages, the city pages and the metro guides.
 *
 *   - Page 1 is the indexable page: its canonical is the bare path.
 *   - Page N (N >= 2) has its OWN canonical (`{path}?page=N`), never page 1.
 *     Google: "Don't use the first page of a paginated sequence as the
 *     canonical page. Instead, give each page its own canonical URL."
 *   - Page N answers `noindex, follow` in its meta robots, the same verdict
 *     the middleware sends as X-Robots-Tag for any ?page >= 2, so the two
 *     signals agree and the jobs linked from page N are still followed.
 *   - A page past the last one is a 404, not an empty 200 (TECH-09).
 *   - Page N is reachable by plain links (ListingPagination), so jobs past
 *     the first page are linked from crawlable pages (M-01).
 *
 * LISTING_PAGE_SIZE is raised from 10 to 30 (M-01, "25 to 50"): most of a
 * listing's inventory is linked from its indexable first page.
 */
import Link from 'next/link';
import { brand } from '@/config/brand';

/** Jobs per page on every pSEO listing (M-01). */
export const LISTING_PAGE_SIZE = 30;

/** Robots for page 2 and later: out of the index, links followed. */
export const PAGINATED_ROBOTS = { index: false, follow: true } as const;

/**
 * The highest page any listing reads. It sits far above any real page count
 * (100,000 pages of 50 is 5 million jobs), so a clamped page is still past
 * the last one and 404s through isPageOutOfRange, while its offset stays far
 * inside Prisma's 64-bit `skip`. Without the cap, ?page=1000000000000000000
 * parsed to 1e18, its offset (3e19) overflowed int64, and Prisma threw a
 * validation error before the range check ran: the state hub answered 500.
 */
export const MAX_LISTING_PAGE = 100_000;

/**
 * The 1-based page from a ?page value; anything unparsable is page 1,
 * anything huge is MAX_LISTING_PAGE. A digit run too long for a double
 * (parseInt gives +Infinity) is a huge page too, so it 404s like any other
 * page past the end instead of rendering page 1 under a stray URL.
 */
export function parseListingPage(raw: string | string[] | null | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = parseInt(value ?? '1', 10);
  return Number.isNaN(parsed) || parsed <= 1 ? 1 : Math.min(parsed, MAX_LISTING_PAGE);
}

/** Pages a listing of `total` jobs spans (at least 1). */
export function totalPagesFor(total: number, pageSize: number = LISTING_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

/** True for a page past the last one: the page answers 404 (TECH-09). */
export function isPageOutOfRange(page: number, total: number, pageSize: number = LISTING_PAGE_SIZE): boolean {
  return page > 1 && page > totalPagesFor(total, pageSize);
}

/**
 * Rows to skip for a page. A page that is not a finite number counts as
 * page 1: `?page=abc` once reached Prisma as `skip: NaN` (Math.max(1, NaN)
 * is NaN) and answered 500. A page above MAX_LISTING_PAGE counts as
 * MAX_LISTING_PAGE, so the offset always fits Prisma's 64-bit `skip`.
 * Route wrappers parse with parseListingPage, so this is the second line of
 * defence, not the first.
 */
export function pageOffset(page: number, pageSize: number = LISTING_PAGE_SIZE): number {
  const safePage = Number.isFinite(page) ? Math.min(MAX_LISTING_PAGE, Math.max(1, Math.floor(page))) : 1;
  return (safePage - 1) * pageSize;
}

/** Site-relative URL of a page: the bare path for page 1. */
export function listingPagePath(basePath: string, page: number): string {
  return page > 1 ? `${basePath}?page=${page}` : basePath;
}

/** Absolute self canonical of a page (TECH-08: page N is its own canonical). */
export function listingCanonical(basePath: string, page: number): string {
  return `${brand.baseUrl}${listingPagePath(basePath, page)}`;
}

/**
 * The robots a listing page answers: page 1 follows its own index gate;
 * every later page is `noindex, follow`, whatever the gate says.
 */
export function listingRobots(indexablePage1: boolean, page: number): { index: boolean; follow: boolean } {
  return page > 1 ? { ...PAGINATED_ROBOTS } : { index: indexablePage1, follow: true };
}

/** Page numbers to link around the current page (first, last and a window). */
export function paginationWindow(page: number, totalPages: number, radius: number = 2): number[] {
  const pages = new Set<number>([1, totalPages]);
  for (let p = page - radius; p <= page + radius; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

const pebble: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '40px',
  padding: '8px 14px', borderRadius: '12px', fontWeight: 700, fontSize: '13px',
  background: '#FFFFFF', color: '#1A2E35', textDecoration: 'none',
  border: '1px solid rgba(0,0,0,0.06)',
  boxShadow: '3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8)',
};
const current: React.CSSProperties = { ...pebble, background: '#BE185D', color: '#FFFFFF', border: '1px solid #BE185D', boxShadow: 'none' };

interface ListingPaginationProps {
  basePath: string;
  page: number;
  totalPages: number;
  /** Mid-sentence noun for the accessible name, e.g. "remote NP jobs". */
  label: string;
}

/**
 * Crawlable page links for a listing (plain anchors, no client state).
 * Renders nothing for a single page.
 */
export function ListingPagination({ basePath, page, totalPages, label }: ListingPaginationProps) {
  if (totalPages <= 1) return null;
  const pages = paginationWindow(page, totalPages);
  return (
    <nav aria-label={`Pages of ${label}`} style={{ marginTop: '32px' }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
        {page > 1 && (
          <li><Link href={listingPagePath(basePath, page - 1)} rel="prev" style={pebble}>Previous</Link></li>
        )}
        {pages.map((p, i) => (
          <li key={p} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {i > 0 && pages[i - 1] !== p - 1 && <span aria-hidden="true" style={{ color: '#7A6A62' }}>…</span>}
            {p === page ? (
              <span aria-current="page" style={current}>{p}</span>
            ) : (
              <Link href={listingPagePath(basePath, p)} style={pebble} aria-label={`Page ${p}`}>{p}</Link>
            )}
          </li>
        ))}
        {page < totalPages && (
          <li><Link href={listingPagePath(basePath, page + 1)} rel="next" style={pebble}>Next</Link></li>
        )}
      </ol>
    </nav>
  );
}
