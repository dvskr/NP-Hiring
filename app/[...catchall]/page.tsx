import { notFound } from 'next/navigation';

/**
 * Catch-all route — any unmatched URL triggers a proper 404.
 * Delegates to app/not-found.tsx which renders the custom 404 page
 * with the correct HTTP 404 status code.
 *
 * P7 runtime fix D5: `force-dynamic` is load-bearing. Without it, under
 * `next start` the first hit to an unmatched URL rendered the bare
 * `<html id="__next_error__">` shell (no H1, no site chrome, no recovery
 * UI) and repeat hits returned 0-byte bodies — the segment's
 * prerendered/static output interacted badly with the not-found boundary
 * (runtime-verified across 4 URLs). Routes that call notFound() during a
 * dynamic render (e.g. /testimonials pre-approval) reach the branded
 * app/not-found.tsx correctly, so this page opts into the same dynamic
 * path. Cost: none worth caching — this route exists only to 404.
 * Guarded by tests/regressions/p7-runtime-catchall-404.test.ts.
 */
export const dynamic = 'force-dynamic';

export default function CatchAllPage() {
  notFound();
}
