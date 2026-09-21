import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CITIES } from '@/lib/pseo/city-data/cities'
import { ALL_CATEGORY_CONFIGS, type CategoryConfig } from '@/lib/pseo/category-city-template'
import {
  SETTING_CONFIGS,
  getAllStateSlugs,
  resolveStateSlug,
  type SettingConfig,
} from '@/lib/pseo/setting-state-config'
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry'
import { buildCategoryWhereClause, CATEGORY_EXTRA_OR, CATEGORY_FILTERS } from '@/lib/filters'
import { canonicalBucketWhere } from '@/lib/canonical-counts'
import { selectEmployers, tallyListingFacts, type ListingFactRow } from '@/lib/pseo/listing-facts'
import { buildRoleSetup } from '@/lib/pseo/listing-narrative'
import { fetchNpAnalyticsRows, summarizeGatedSalary } from '@/lib/salary-analytics'
import {
  shouldIndexListingPage,
  shouldIndexLocalListingPage,
  shouldIndexSettingState,
  type SettingStateIndexFacts,
} from '@/lib/pseo/render-gate'
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';
import { clampOffset, computeNextOffset, persistCityCursor, readCityCursor } from './cursor'
import { dispatchSelfChain, MAX_CHAIN_DEPTH } from './chain'
import { checkCategoryCityStaleness } from './staleness'

// Vercel Pro/Enterprise: up to 300s. Hobby: 60s.
// Batched aggregation: processes a chunk of cities per invocation.
//
// F7 fix: nothing ever called this route with ?offset>0, so every scheduled
// run restarted at offset 0 and cities 200+ never got fresh PseoStats rows.
// Coverage of all 4,135 cities now comes from two cooperating mechanisms:
//   1. A persisted rotating cursor (PseoStats sentinel row, ./cursor),
//      advanced by however many cities actually completed, so even a batch
//      aborted by the time budget makes forward progress, and the rotation
//      wraps around the full city list.
//   2. A self-chaining follow-up request (./chain) so one scheduled run
//      walks the remainder of the rotation instead of advancing one
//      200-city step per 6-hourly run, which is required to keep rows inside
//      the PSEO_STATS_MAX_AGE_HOURS window used by the sitemaps and the
//      internal-link mesh. If a chain dies silently, the cursor resumes on
//      the next schedule.
// An explicit ?offset= (admin manual trigger / chain links) overrides the
// persisted cursor for that run; the cursor is re-persisted from wherever
// the run actually ended.
//
// pSEO index gate (PLAN C.2): every count below reads the canonical
// predicate (lib/canonical-counts.ts), the same one the page robots use, and
// every row now also carries `distinctEmployers` and the `indexable` verdict
// from lib/pseo/render-gate.ts so the sitemaps can never advertise a URL the
// page renders noindex. Query shape: ONE query per category (a findMany or a
// groupBy over the whole category), reduced per state or per city in memory
// with the same case-insensitive equality the page templates query with,
// instead of one count plus one aggregate per row (the old shape ran about
// 9,000 queries per 200-city batch).
export const maxDuration = 300

const BATCH_SIZE = 200 // Cities per invocation
const TIME_BUDGET_MS = 250_000 // abort safety margin under maxDuration

/** Rows written per raw UPDATE statement (6 bind parameters each). */
const WRITE_CHUNK_ROWS = 250

/**
 * Memory guard for the per-category row fetch behind the setting x state
 * facts. The canonical pool is about one thousand rows today; a category
 * that ever exceeds this cap falls back to one count query per state for
 * its totals (the tally is then a newest-first sample, as on the page).
 */
const FACT_ROW_CAP = 10_000

/**
 * Placeholder location handed to a config's buildWhere so its location keys
 * can be stripped. The value never reaches the database: categoryClauseOf()
 * removes the `state` and `city` keys before the clause is used.
 */
const LOCATION_PROBE = 'probe'

/** The 'category-landing' rows are keyed on this location slug (PLAN C.2). */
const LANDING_LOCATION_SLUG = 'all'

type StatsRowType = 'setting-state' | 'category-city' | 'category-landing'

interface StatsRow {
  type: StatsRowType
  categorySlug: string
  locationSlug: string
  totalJobs: number
  distinctEmployers: number
  indexable: boolean
}

type CityRecord = (typeof CITIES)[number]

/** A groupBy row over (state, city, employer) inside one category. */
interface CityEmployerGroup {
  state: string | null
  city: string | null
  employer: string | null
  _count: { _all: number }
}

/**
 * Mirror of the private LISTING_FACT_SELECT in lib/pseo/listing-facts.ts:
 * the projection tallyListingFacts() consumes. The `satisfies` keeps the
 * shape checkable against Prisma; the ListingFactRow annotation on the
 * fetch keeps it checkable against the tally.
 */
const LISTING_FACT_ROW_SELECT = {
  employer: true,
  companyId: true,
  city: true,
  state: true,
  stateCode: true,
  isRemote: true,
  isHybrid: true,
  jobType: true,
  setting: true,
  categoryTags: true,
  originalPostedAt: true,
  createdAt: true,
  newGradFriendly: true,
  salaryIsEstimated: true,
  normalizedMinSalary: true,
} as const satisfies Prisma.JobSelect

/** JS twin of Prisma `{ equals: value, mode: 'insensitive' }`. */
function sameText(stored: string | null | undefined, wanted: string): boolean {
  return typeof stored === 'string' && stored.toLowerCase() === wanted.toLowerCase()
}

/** Lookup key for an in-memory (state, city) bucket. */
function cityKey(state: string, city: string): string {
  return `${state.toLowerCase()}|${city.toLowerCase()}`
}

/**
 * Lift a config's per-location where to the whole category. Every
 * SETTING_CONFIGS and ALL_CATEGORY_CONFIGS buildWhere returns
 * `{ isPublished, state: { equals }, city?: { equals }, ...categoryClause }`
 * with the location keys at the top level (pinned by
 * tests/regressions/pseo-index-gate.test.ts), so dropping them yields the
 * category clause; the per-location split then happens in memory with
 * sameText(), the same case-insensitive equality the template queries with.
 */
function categoryClauseOf(where: Record<string, unknown>): Prisma.JobWhereInput {
  return Object.fromEntries(
    Object.entries(where).filter(([key]) => key !== 'state' && key !== 'city'),
  ) as Prisma.JobWhereInput
}

/**
 * The category landing count predicate, mirroring the private categoryWhere()
 * in lib/pseo/category-landing-template.tsx (thin-spec-1 T3): slugs with a
 * legacy keyword filter use it, the rest gate on the precomputed
 * categoryTags column. Wrapped in canonicalBucketWhere() by the caller.
 */
function landingCategoryWhere(slug: string): Prisma.JobWhereInput {
  const hasLegacyKeywordFilter =
    (CATEGORY_FILTERS[slug]?.length ?? 0) > 0 || (CATEGORY_EXTRA_OR[slug]?.length ?? 0) > 0
  return hasLegacyKeywordFilter
    ? buildCategoryWhereClause(slug)
    : buildCategoryWhereClause(slug, { categoryTags: { has: slug } })
}

/** Newest-first row sample for one category, capped as a memory guard. */
async function fetchFactRows(
  where: Prisma.JobWhereInput,
): Promise<{ rows: ListingFactRow[]; capped: boolean }> {
  const rows: ListingFactRow[] = await prisma.job.findMany({
    where,
    select: LISTING_FACT_ROW_SELECT,
    orderBy: { createdAt: 'desc' },
    take: FACT_ROW_CAP,
  })
  return { rows, capped: rows.length >= FACT_ROW_CAP }
}

/**
 * Setting x state rows for one setting config: one row fetch and one
 * salary-pool fetch for the whole category, split per state in memory and
 * tallied with the same selectors the page template uses, so the stored
 * `indexable` verdict is the one shouldIndexSettingState() returns live.
 */
async function aggregateSettingState(
  config: SettingConfig,
  stateSlugs: readonly string[],
  now: Date,
): Promise<StatsRow[]> {
  const where = canonicalBucketWhere(categoryClauseOf(config.buildWhere(LOCATION_PROBE)), now)
  const [{ rows, capped }, payRows] = await Promise.all([
    fetchFactRows(where),
    // Same pool getGatedBenchmark() reads for the page's posted-pay section.
    fetchNpAnalyticsRows(where),
  ])
  const out: StatsRow[] = []
  for (const stateSlug of stateSlugs) {
    const stateName = resolveStateSlug(stateSlug)
    if (!stateName) continue
    const stateRows = rows.filter((row) => sameText(row.state, stateName))
    const totalJobs = capped
      ? await prisma.job.count({
          where: canonicalBucketWhere(config.buildWhere(stateName) as Prisma.JobWhereInput, now),
        })
      : stateRows.length
    const facts = tallyListingFacts(stateRows, now)
    const indexFacts: SettingStateIndexFacts = {
      totalJobs,
      employerCount: facts.distinctEmployers,
      namedCityCount: facts.cities.length,
      hasBenchmark: summarizeGatedSalary(payRows.filter((row) => sameText(row.state, stateName))).gatePassed,
      postedLast30Days: facts.recency.last30,
      roleSetupRenders: buildRoleSetup({ slug: config.slug, facts }).rendered,
    }
    out.push({
      type: 'setting-state',
      categorySlug: config.slug,
      locationSlug: stateSlug,
      totalJobs,
      distinctEmployers: facts.distinctEmployers,
      indexable: shouldIndexSettingState(indexFacts),
    })
  }
  return out
}

/**
 * One 'category-landing' row per taxonomy slug (locationSlug 'all'): one
 * grouped query by employer gives the canonical total and, through
 * selectEmployers() (alias merging), the distinct employer count.
 */
async function aggregateCategoryLanding(slug: string, now: Date): Promise<StatsRow> {
  const groups = await prisma.job.groupBy({
    by: ['employer'],
    where: canonicalBucketWhere(landingCategoryWhere(slug), now),
    _count: { _all: true },
  })
  const totalJobs = groups.reduce((sum, group) => sum + group._count._all, 0)
  const { distinct } = selectEmployers(groups.map((group) => ({ employer: group.employer, companyId: null })))
  return {
    type: 'category-landing',
    categorySlug: slug,
    locationSlug: LANDING_LOCATION_SLUG,
    totalJobs,
    distinctEmployers: distinct,
    indexable: shouldIndexListingPage(totalJobs),
  }
}

/**
 * One grouped query per category for a batch of cities: rows grouped by
 * (state, city, employer) inside the batch's states, bucketed in memory by
 * the same case-insensitive (state, city) equality the city template queries
 * with. Returns the buckets; rowsForCity() reads them per city.
 */
async function groupCategoryByCity(
  config: CategoryConfig,
  cities: readonly CityRecord[],
  now: Date,
): Promise<Map<string, CityEmployerGroup[]>> {
  const category = categoryClauseOf(config.buildWhere(LOCATION_PROBE, LOCATION_PROBE))
  const stateNames = [...new Set(cities.map((city) => city.state))]
  // Not annotated: Prisma infers groupBy's result from its argument, and an
  // annotation on the binding makes it type the argument as the array.
  const groups = await prisma.job.groupBy({
    by: ['state', 'city', 'employer'],
    where: canonicalBucketWhere({ AND: [category, { state: { in: stateNames, mode: 'insensitive' } }] }, now),
    _count: { _all: true },
  })
  const buckets = new Map<string, CityEmployerGroup[]>()
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group.state || !group.city) continue
    const key = cityKey(group.state, group.city)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(group)
    else buckets.set(key, [group])
  }
  return buckets
}

/** The category x city rows for one city, read from the per-category buckets. */
function rowsForCity(
  city: CityRecord,
  bucketsByCategory: ReadonlyMap<string, Map<string, CityEmployerGroup[]>>,
): StatsRow[] {
  const key = cityKey(city.state, city.name)
  return [...bucketsByCategory.entries()].map(([categorySlug, buckets]) => {
    const groups = buckets.get(key) ?? []
    const totalJobs = groups.reduce((sum, group) => sum + group._count._all, 0)
    const { distinct } = selectEmployers(groups.map((group) => ({ employer: group.employer, companyId: null })))
    return {
      type: 'category-city',
      categorySlug,
      locationSlug: city.slug,
      totalJobs,
      distinctEmployers: distinct,
      indexable: shouldIndexLocalListingPage({ activeJobs: totalJobs, distinctEmployers: distinct }),
    }
  })
}

/** One VALUES tuple, every column bound as a parameter with an explicit type. */
function statsRowValues(row: StatsRow): Prisma.Sql {
  return Prisma.sql`(${row.type}::text, ${row.categorySlug}::text, ${row.locationSlug}::text, ${row.totalJobs}::int, ${row.distinctEmployers}::int, ${row.indexable}::boolean)`
}

/**
 * Batched upsert. createMany (skipDuplicates) creates missing rows through
 * the generated client, which owns the cuid ids; the raw UPDATE then writes
 * every aggregate column for the whole chunk in one statement.
 *
 * WHY RAW: the generated Prisma client predates the `distinctEmployers` and
 * `indexable` columns (prisma/migrations/20260916120000_pseo_stats_index_gate)
 * and must not be regenerated on this branch, so those two columns are only
 * reachable through a $executeRaw tagged template (parameterized; the
 * column names are literals). `updatedAt` is @updatedAt, which only the
 * client fills, so the raw statement sets it explicitly: the sitemaps drop
 * rows older than PSEO_STATS_MAX_AGE_HOURS.
 *
 * rawAvgSalary and colAdjustedSalary are written as 0, the existing
 * "no figure" sentinel: the posting mean they held is retired (thin plan
 * T0-3, gated medians only) and their readers are being removed.
 */
async function writeStatsRows(rows: readonly StatsRow[], now: Date): Promise<void> {
  for (let start = 0; start < rows.length; start += WRITE_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + WRITE_CHUNK_ROWS)
    await prisma.pseoStats.createMany({
      data: chunk.map((row) => ({
        type: row.type,
        categorySlug: row.categorySlug,
        locationSlug: row.locationSlug,
        totalJobs: row.totalJobs,
        rawAvgSalary: 0,
        colAdjustedSalary: 0,
      })),
      skipDuplicates: true,
    })
    await prisma.$executeRaw`
      UPDATE "PseoStats" AS p
      SET "totalJobs" = v."totalJobs",
          "rawAvgSalary" = 0,
          "colAdjustedSalary" = 0,
          "distinctEmployers" = v."distinctEmployers",
          "indexable" = v."indexable",
          "updatedAt" = ${now}
      FROM (VALUES ${Prisma.join(chunk.map(statsRowValues))})
        AS v("type", "categorySlug", "locationSlug", "totalJobs", "distinctEmployers", "indexable")
      WHERE p."type" = v."type"
        AND p."categorySlug" = v."categorySlug"
        AND p."locationSlug" = v."locationSlug"`
  }
}

export async function GET(request: NextRequest) {
  const authError = await verifyCronOrAdmin(request);
  if (authError) return authError;

  const startTime = Date.now()
  const now = new Date(startTime)
  const url = new URL(request.url)
  const offsetParam = url.searchParams.get('offset')
  const mode = url.searchParams.get('mode') || 'all' // 'all' | 'state' | 'city'
  const chainRaw = parseInt(url.searchParams.get('chain') || '0', 10)
  const chainDepth = Number.isFinite(chainRaw) && chainRaw > 0 ? chainRaw : 0

  try {
    return await withCronTracking('aggregate-pseo', async () => {
    const totalCities = CITIES.length
    const cursorSource: 'param' | 'persisted' = offsetParam !== null ? 'param' : 'persisted'
    const startOffset = offsetParam !== null
      ? clampOffset(parseInt(offsetParam, 10), totalCities)
      : await readCityCursor(totalCities)

    let settingStateCount = 0
    let categoryLandingCount = 0
    let categoryCityCount = 0

    // Phase 1: Setting x State (28 settings x 51 states) plus the
    // category-landing rows (one per taxonomy slug). Runs on every scheduled
    // entry run so these rows stay well inside the freshness window (matches
    // pre-fix behaviour, where the offset was always 0). Chained links pass
    // mode=city to skip it. One query pair per setting and one grouped
    // query per landing slug; nothing per row.
    if (mode !== 'city') {
      const stateSlugs = getAllStateSlugs()
      const phaseOneUnits: Array<() => Promise<StatsRow[]>> = [
        ...Object.values(SETTING_CONFIGS).map((config) => () => aggregateSettingState(config, stateSlugs, now)),
        ...ALL_CATEGORY_SLUGS.map((slug) => async () => [await aggregateCategoryLanding(slug, now)]),
      ]

      for (const unit of phaseOneUnits) {
        // Budget check: if Phase 1 alone blows the budget, bail without
        // touching the city cursor so Phase 2 work is never skipped-over.
        if (Date.now() - startTime > TIME_BUDGET_MS) {
          console.warn(`[pseo-agg] Timeout safety in Phase 1 after ${settingStateCount} setting-state rows; city cursor stays at ${startOffset}`)
          const cursorPersisted = await persistCityCursor(startOffset)
          return {
            response: NextResponse.json({
              success: true,
              partial: true,
              phase: 'setting-state',
              settingStateCount,
              categoryLandingCount,
              categoryCityCount: 0,
              batchInfo: { offset: startOffset, cursorSource, citiesCompleted: 0, nextOffset: startOffset, totalCities, cursorPersisted },
              elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
              timestamp: new Date().toISOString(),
            }),
            metrics: { partial: true, phase: 'setting-state', settingStateCount, categoryLandingCount, startOffset, citiesCompleted: 0, nextOffset: startOffset, totalCities, cursorPersisted },
          }
        }

        try {
          const rows = await unit()
          await writeStatsRows(rows, now)
          for (const row of rows) {
            if (row.type === 'setting-state') settingStateCount++
            else categoryLandingCount++
          }
        } catch (error) {
          console.error('[pseo-agg] Error in Phase 1 unit:', error)
        }
      }

      // If mode is state-only, return early
      if (mode === 'state') {
        return {
          response: NextResponse.json({
            success: true,
            mode: 'state',
            settingStateCount,
            categoryLandingCount,
            elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
            timestamp: new Date().toISOString(),
          }),
          metrics: { mode: 'state', settingStateCount, categoryLandingCount },
        }
      }
    }

    // Phase 2: Category x City (rotating cursor, BATCH_SIZE cities max).
    // Step 1: one grouped query per category over the batch's states. The
    // budget check sits between categories; an abort here has completed no
    // city, so the cursor stays put and the batch is re-run next link.
    const batchEnd = Math.min(startOffset + BATCH_SIZE, totalCities)
    const batchCities = CITIES.slice(startOffset, batchEnd)
    const bucketsByCategory = new Map<string, Map<string, CityEmployerGroup[]>>()
    let citiesCompleted = 0
    let timedOut = false

    for (const config of Object.values(ALL_CATEGORY_CONFIGS)) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        timedOut = true
        break
      }
      try {
        bucketsByCategory.set(config.slug, await groupCategoryByCity(config, batchCities, now))
      } catch (error) {
        // The category's rows for this batch stay as they were; the
        // freshness window drops them if the failure persists.
        console.error(`[pseo-agg] Error category-city ${config.slug} (offset ${startOffset}):`, error)
      }
    }

    // Step 2: per city, read its rows from the buckets and write them in
    // one createMany plus one UPDATE. The cursor advances by COMPLETED
    // cities only, so a city interrupted by the time budget is re-processed
    // by the next link/run instead of being skipped.
    for (let i = startOffset; i < batchEnd && !timedOut; i++) {
      const city = CITIES[i]
      if (!city) {
        citiesCompleted++ // defensive: consume the slot so the cursor still advances
        continue
      }

      if (Date.now() - startTime > TIME_BUDGET_MS) {
        timedOut = true
        break
      }

      try {
        const rows = rowsForCity(city, bucketsByCategory)
        await writeStatsRows(rows, now)
        categoryCityCount += rows.length
      } catch (error) {
        console.error(`[pseo-agg] Error writing category-city rows for ${city.slug}:`, error)
      }

      citiesCompleted++
    }

    // Advance the persisted cursor by actual progress (wraps to 0 at the
    // end of the list) so the next scheduled run resumes from here even if
    // the self-chain below never fires.
    const nextOffset = computeNextOffset(startOffset, citiesCompleted, totalCities)
    const cursorPersisted = await persistCityCursor(nextOffset)
    // Wrapped = this run actually reached the end of the list (not merely
    // "cursor happens to be 0", which a zero-progress batch at offset 0
    // would also produce).
    const wrapped = totalCities > 0 && startOffset + citiesCompleted >= totalCities

    if (timedOut) {
      console.warn(`[pseo-agg] Timeout safety: completed ${citiesCompleted} cities (${categoryCityCount} rows) from offset ${startOffset}; cursor advanced to ${nextOffset}`)
    }

    // Self-chain the remainder of the rotation (complement; the cursor
    // alone still guarantees forward progress if this dies silently).
    const chainDispatched = dispatchSelfChain({ nextOffset, chainDepth })

    // Coverage staleness probe + Discord alert on scheduled entry runs only,
    // so chain links can't spam the channel. Never fails the cron.
    const staleness = chainDepth === 0
      ? await checkCategoryCityStaleness(nextOffset, totalCities)
      : null

    const elapsed = Math.round((Date.now() - startTime) / 1000)

    return {
      response: NextResponse.json({
        success: true,
        partial: !wrapped,
        mode,
        settingStateCount,
        categoryLandingCount,
        categoryCityCount,
        batchInfo: {
          offset: startOffset,
          cursorSource,
          batchSize: BATCH_SIZE,
          citiesCompleted,
          timedOut,
          totalCities,
          wrapped,
          nextOffset: wrapped ? null : nextOffset,
          cursorPersisted,
          chainDepth,
          chainDispatched,
        },
        ...(staleness ? { staleness } : {}),
        elapsedSeconds: elapsed,
        timestamp: new Date().toISOString(),
      }),
      metrics: {
        mode,
        settingStateCount,
        categoryLandingCount,
        categoryCityCount,
        startOffset,
        cursorSource,
        citiesCompleted,
        nextOffset,
        totalCities,
        rotationPercent: totalCities > 0 ? Math.round(((wrapped ? totalCities : nextOffset) / totalCities) * 100) : 0,
        timedOut,
        wrapped,
        cursorPersisted,
        chainDepth,
        maxChainDepth: MAX_CHAIN_DEPTH,
        chainDispatched,
        ...(staleness ?? {}),
        elapsedSeconds: elapsed,
      },
    }
    })
  } catch (error) {
      await sendCronFailureAlert('aggregate-pseo', error);
    console.error('[pseo-agg] Cron aggregation error:', error)
    return NextResponse.json({ error: 'Aggregation failed' }, { status: 500 })
  }
}
