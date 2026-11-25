/**
 * /reports/np-pay/data.csv: the NP Pay Report as a CSV, one row per scope
 * (national, the 51 states and DC, specialties, work modes, employment
 * types, experience buckets), built by lib/reports/np-pay-model.ts from the
 * same snapshot the page renders. Withheld cells are empty, never 0.
 *
 * Rendered on request, never at build time: a build with no database would
 * otherwise prerender the 503 below and serve it for a day. A good file is
 * cached at the edge for a day (s-maxage 86400), like the page, and carries its
 * own as_of date; a 503 is never cached. Nothing else is exported from this
 * module: a route file may only export handlers and segment config.
 */
import { loadNpPaySnapshot } from '@/lib/reports/np-pay';
import { buildNpPayCsv, npPayCsvFileName } from '@/lib/reports/np-pay-model';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
    const snapshot = await loadNpPaySnapshot();
    if (!snapshot) {
        // Only when the loader is in its build phase with no database: say so, and cache nothing.
        return new Response('The NP Pay Report data is not available in this build. Try again shortly.\n', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
    }
    return new Response(buildNpPayCsv(snapshot), {
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${npPayCsvFileName(snapshot)}"`,
            'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=86400',
        },
    });
}
