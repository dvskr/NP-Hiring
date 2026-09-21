/**
 * page / limit parsing for GET /api/jobs.
 *
 * parseInt('abc') is NaN and page=0 / page=-1 give a negative skip; both
 * reached Prisma and answered 500. Anything that is not a positive integer
 * falls back to the default, and limit stays capped at MAX_LIMIT so a
 * scraper cannot pull the whole board in one call.
 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
/** Keeps skip = (page - 1) * limit far inside Number.MAX_SAFE_INTEGER. */
export const MAX_PAGE = 100_000;

function positiveInteger(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

export function parsePagination(searchParams: URLSearchParams): { page: number; limit: number } {
  const page = Math.min(positiveInteger(searchParams.get('page')) ?? DEFAULT_PAGE, MAX_PAGE);
  const limit = Math.min(positiveInteger(searchParams.get('limit')) ?? DEFAULT_LIMIT, MAX_LIMIT);
  return { page, limit };
}
