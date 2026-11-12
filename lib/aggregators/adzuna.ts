interface AdzunaJob {
  id: string;
  title: string;
  company: {
    display_name: string;
  };
  location: {
    // display_name is "City, County" (NOT "City, State"), so unusable
    // for state extraction. Use `area` instead — Adzuna returns it as
    // ["US", State, County, City] from broadest to narrowest.
    display_name: string;
    area?: string[];
  };
  description: string;
  salary_min?: number;
  salary_max?: number;
  contract_time?: string; // e.g., "full_time", "part_time"
  contract_type?: string; // e.g., "permanent", "contract"
  redirect_url: string;
  created: string;
}

/**
 * Build a clean "City, State" string from Adzuna's `location.area` array.
 * Falls back to display_name (which is "City, County") when area is missing
 * or malformed. Returns "United States" when the location is country-only.
 */
function buildAdzunaLocation(loc: AdzunaJob['location']): string {
  const area = loc?.area;
  if (Array.isArray(area) && area.length >= 2) {
    // area[0] = "US", area[1] = State; city is the LAST element (depth varies).
    const state = area[1];
    const city = area.length >= 4 ? area[3] : area.length === 3 ? area[2] : null;
    if (city && state) return `${city}, ${state}`;
    if (state) return state;
  }
  return loc?.display_name || 'United States';
}

interface AdzunaResponse {
  results: AdzunaJob[];
  count: number;
}

import { ADZUNA_SEARCH_QUERIES as SEARCH_QUERIES } from './search-terms/adzuna';
import { RateLimiter } from './types';

// Call budget. Every page is one API call, and the allowance is set by the
// plan on the Adzuna account, which the API does not report. These numbers
// keep a daily run small (at most 40 calls, under 30 a minute) so it fits
// an entry-level plan; raise them only after checking the account's limits.
export const ADZUNA_MAX_CALLS_PER_RUN = 40;
export const ADZUNA_MAX_PAGES_PER_QUERY = 12;
const ADZUNA_RESULTS_PER_PAGE = 50;
// Daily run, so three days covers a missed run and keeps a posting in the
// fetch long enough for the presence check to see it more than once.
const ADZUNA_MAX_DAYS_OLD = '3';
const ADZUNA_PAGE_GAP_MS = 2_200;
// 150s: must stay well under the orchestrator's MAX_INGESTION_MS (240s,
// measured from BEFORE fetch) so the per-job insert loop keeps ~90s.
const ADZUNA_TIME_BUDGET_MS = 150_000;

export async function fetchAdzunaJobs(
  pageGapMs: number = ADZUNA_PAGE_GAP_MS,
): Promise<Array<Record<string, unknown>>> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  if (!appId || !appKey) {
    console.error('[Adzuna] API credentials not configured');
    return [];
  }

  const startTime = Date.now();
  const allJobs: Array<Record<string, unknown>> = [];
  const seenIds = new Set<string>();
  const pageRateLimiter = new RateLimiter(pageGapMs);

  let totalRawJobs = 0;
  let calls = 0;
  // Set when Adzuna refuses the key or the quota. Nothing more is requested
  // in this run: retrying a refused key only digs the quota hole deeper.
  let refused = false;

  console.log(`[Adzuna] Starting fetch with ${SEARCH_QUERIES.length} title searches...`);

  queries: for (const query of SEARCH_QUERIES) {
    for (let page = 1; page <= ADZUNA_MAX_PAGES_PER_QUERY; page++) {
      if (refused) break queries;
      if (calls >= ADZUNA_MAX_CALLS_PER_RUN) {
        console.warn(`[Adzuna] Call budget used (${calls}). Stopping at "${query}" page ${page}.`);
        break queries;
      }
      const elapsed = Date.now() - startTime;
      if (elapsed >= ADZUNA_TIME_BUDGET_MS) {
        console.warn(`[Adzuna] Time budget exhausted (${(elapsed / 1000).toFixed(1)}s). Returning ${allJobs.length} jobs collected so far.`);
        break queries;
      }

      try {
        // title_only, not `what`: `what` also matches the description, and
        // measured on 2026-11-12 only 20 of 50 results for it were on
        // target (the rest were RN postings that mention the role), against
        // 49 of 50 for the same words searched in the title.
        const params = new URLSearchParams({
          app_id: appId,
          app_key: appKey,
          title_only: query,
          results_per_page: String(ADZUNA_RESULTS_PER_PAGE),
          max_days_old: ADZUNA_MAX_DAYS_OLD,
          sort_by: 'date',
        });

        const url = `https://api.adzuna.com/v1/api/jobs/us/search/${page}?${params.toString()}`;
        await pageRateLimiter.throttle();
        calls++;
        const response = await fetch(url);

        if (!response.ok) {
          console.error(`[Adzuna] HTTP ${response.status} for "${query}" page ${page}`);
          if (response.status === 429 || response.status === 401 || response.status === 403) {
            refused = true;
            console.error(`[Adzuna] Key or quota refused after ${calls} calls. Stopping this run.`);
          }
          break; // Move to next query
        }

        const data: AdzunaResponse = await response.json();
        const jobs = data.results || [];

        console.log(`[Adzuna] "${query}" page ${page}: ${jobs.length} jobs (total available: ${data.count})`);

        if (jobs.length === 0) {
          break; // No more results for this query
        }

        for (const job of jobs) {
          // Skip duplicates
          if (seenIds.has(job.id)) continue;
          seenIds.add(job.id);

          totalRawJobs++;

          // Skip jobs without a valid apply link
          if (!job.redirect_url) {
            continue;
          }

          // Map Adzuna contract types
          let jobType = null;
          if (job.contract_time === 'full_time') jobType = 'Full-Time';
          else if (job.contract_time === 'part_time') jobType = 'Part-Time';
          else if (job.contract_type === 'contract') jobType = 'Contract';
          else if (job.contract_type === 'permanent') jobType = 'Full-Time';

          allJobs.push({
            title: job.title,
            employer: job.company?.display_name || 'Company Not Listed',
            location: buildAdzunaLocation(job.location),
            description: job.description || '',
            minSalary: job.salary_min || null,
            maxSalary: job.salary_max || null,
            salaryPeriod: job.salary_min ? 'annual' : null,
            jobType, // Pass raw mapped type
            applyLink: job.redirect_url,
            externalId: `adzuna_${job.id}`,
            sourceProvider: 'adzuna',
            postedAt: job.created,
          });
        }

        // A short page is the last page.
        if (jobs.length < ADZUNA_RESULTS_PER_PAGE) {
          break;
        }

      } catch (error) {
        console.error(`[Adzuna] Error fetching "${query}" page ${page}:`, error);
        break; // Move to next query on error
      }
    }
  }

  console.log(`[Adzuna] VALIDATION STATS:`);
  console.log(`    API calls: ${calls}`);
  console.log(`    Total Raw Jobs Fetched: ${totalRawJobs}`);
  console.log(`    Final Passed to Pipeline: ${allJobs.length}`);

  return allJobs;
}

import type { Aggregator, RawJobData } from './types';
import { checkJobHealth, type HealthDecision } from '@/lib/health/check-job-health';

export const adzunaAggregator: Aggregator = {
    key: 'adzuna',
    chunkCount: 1,
    async fetch(): Promise<RawJobData[]> {
        return (await fetchAdzunaJobs()) as unknown as RawJobData[];
    },
    async probeJob(externalId: string, applyLink: string): Promise<HealthDecision | null> {
        return checkJobHealth(applyLink, 'adzuna', { externalId });
    },
};
