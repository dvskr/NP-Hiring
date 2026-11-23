import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildWhereClause, parseFiltersFromParams } from '@/lib/filters';
import {
  buildSearchConditionSet,
  computeZeroResultSearchHint,
  extractSearchQueryIntent,
  type SearchQueryIntent,
  type ZeroResultSearchHint,
} from '@/lib/search-query-intent';
import { logger } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';
import { loadBoardCount, loadBoardRows, type BoardJobRow } from '@/lib/jobs-board-data';
import { parsePagination } from './pagination';

/**
 * A board row as this API returns it. The shared loader also carries the
 * page's own fields; `applyLink` must never leave through the listing API
 * (mass link harvesting: apply links are only on the job's own page), and
 * the slug and the state code are the server render's.
 */
function toListingJob(row: BoardJobRow) {
  return {
    id: row.id,
    title: row.title,
    employer: row.employer,
    location: row.location,
    city: row.city,
    state: row.state,
    jobType: row.jobType,
    isRemote: row.isRemote,
    isHybrid: row.isHybrid,
    // Salary fields
    displaySalary: row.displaySalary,
    normalizedMinSalary: row.normalizedMinSalary,
    normalizedMaxSalary: row.normalizedMaxSalary,
    salaryPeriod: row.salaryPeriod,
    salaryRange: row.salaryRange,
    // The full `description` is never in the listing (anti-scrape, and only
    // the job's own page needs it); the loader does not select it.
    descriptionSummary: row.descriptionSummary,
    createdAt: row.createdAt,
    isFeatured: row.isFeatured,
    isVerifiedEmployer: row.isVerifiedEmployer,
    mode: row.mode,
    originalPostedAt: row.originalPostedAt,
    // A boolean flag (no scrape value) JobCard needs for the Easy Apply CTA.
    applyOnPlatform: row.applyOnPlatform,
    // Lets JobCard label an employer post "Apply on employer site".
    sourceType: row.sourceType,
    // Phase 1 experience chip: JobCard renders the pill from these.
    experienceLabel: row.experienceLabel,
    newGradFriendly: row.newGradFriendly,
    companyLogoUrl: row.companyLogoUrl,
  };
}

export async function GET(request: NextRequest) {
  try {
    // Rate limiting — 30 req/min to prevent mass scraping
    const rateLimitResult = await rateLimit(request, 'jobs-list', { limit: 30, windowSeconds: 60 });
    if (rateLimitResult) return rateLimitResult;

    const { searchParams } = new URL(request.url);

    // If specific IDs are requested, return exactly those jobs (for saved/applied pages)
    const idsParam = searchParams.get('ids');
    if (idsParam) {
      // Each id once: the list went into the IN clause exactly as sent
      // (JOBS-1, tests/api/jobs.test.ts). Not capped at MAX_LIMIT:
      // app/saved/page.tsx sends the whole saved or applied list in one
      // request and shows any id left out as "Listing no longer available".
      const ids = [...new Set(idsParam.split(',').filter(Boolean))];
      if (ids.length > 0) {
        const jobs = await prisma.job.findMany({
          where: { id: { in: ids }, isPublished: true },
          select: {
            id: true,
            title: true,
            employer: true,
            location: true,
            city: true,
            state: true,
            jobType: true,
            isRemote: true,
            isHybrid: true,
            displaySalary: true,
            normalizedMinSalary: true,
            normalizedMaxSalary: true,
            salaryPeriod: true,
            salaryRange: true,
            // description intentionally excluded — anti-scrape (~500-3000 chars
            // per row × 50/page is ~150KB pure scrape value with no UI need;
            // JobCard renders descriptionSummary, the slug page reads full
            // description by id directly).
            descriptionSummary: true,
            createdAt: true,
            isFeatured: true,
            isVerifiedEmployer: true,
            mode: true,
            originalPostedAt: true,
            applyOnPlatform: true,
            sourceType: true,
            // Phase 1 experience chip — JobCard reads `experienceLabel`
            // to render the "5+ yrs / New grad welcome / etc." pill and
            // uses `newGradFriendly` to pick the success vs. outline
            // variant. Without these in the SELECT, the chip silently
            // never renders.
            experienceLabel: true,
            newGradFriendly: true,
            employerJobs: { select: { companyLogoUrl: true } },
          },
        });
        const jobsWithLogo = jobs.map(j => ({ ...j, companyLogoUrl: j.employerJobs?.companyLogoUrl || null, employerJobs: undefined }));
        return NextResponse.json({ jobs: jobsWithLogo, total: jobsWithLogo.length, page: 1, totalPages: 1 });
      }
    }

    // Malformed page/limit (abc, 0, -1, 1.5) clamp to safe values instead of
    // reaching Prisma as a NaN or negative skip/take (which answered 500).
    const { page, limit } = parsePagination(searchParams);

    // Parse filters from URL
    const filters = parseFiltersFromParams(searchParams);

    // The list and the count come from the loader the SSR /jobs page reads
    // (lib/jobs-board-data.ts): one read per view, shared with the page that
    // rendered just before this call, and one sort order for both, built in
    // the loader.
    const sort = searchParams.get('sort') || 'best';
    const [rows, total] = await Promise.all([
      loadBoardRows(filters, sort, page, limit),
      loadBoardCount(filters),
    ]);
    const jobsWithLogo = rows.map(toListingJob);

    // Search transparency (review item #3): echo what the deterministic
    // intent extraction did with the free-text query, and — on a zero-result
    // search — name WHICH extracted dimension emptied it, so the UI can say
    // "no remote matches in Texas — N jobs without 'remote'" instead of a
    // blanket "No jobs found". Additive response fields only; the existing
    // jobs/total/page/totalPages contract is unchanged.
    let search: { intent: SearchQueryIntent; zeroResultHint?: ZeroResultSearchHint } | undefined;
    if (filters.search && filters.search.trim()) {
      const intent = extractSearchQueryIntent(filters.search);
      search = { intent };
      if (total === 0) {
        const set = buildSearchConditionSet(intent, {
          hasExplicitWorkMode: filters.workMode.length > 0,
          hasExplicitLocation: Boolean(filters.location || filters.stateCode),
        });
        const hint = await computeZeroResultSearchHint({
          baseWhere: buildWhereClause({ ...filters, search: '' }),
          set,
          intent,
          count: (hintWhere) => prisma.job.count({ where: hintWhere }),
        });
        if (hint) search.zeroResultHint = hint;
      }
    }

    return NextResponse.json({
      jobs: jobsWithLogo,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      ...(search ? { search } : {}),
    });
  } catch (error) {
    logger.error('Error fetching jobs', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

