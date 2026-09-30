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
import { canonicalBucketWhere } from '@/lib/canonical-counts'
import { selectEmployers } from '@/lib/pseo/listing-facts'
import { countPostings, distinctPostingTotal } from '@/lib/pseo/posting-clusters'
import { landingBucketWhere, stripLocationKeys } from '@/lib/pseo/landing-where'
import { loadStateHubVerdicts, type StateHubVerdict } from '@/lib/pseo/state-hub-index'
import {
  buildSettingStateIndexFacts,
  settingStateGateJobIds,
  type SettingStateGateRow,
} from '@/lib/pseo/setting-state-index'
import { settingStateKey, settingStateSiblingVerdicts } from './setting-state-siblings'
import {
  SETTING_STATE_INDEXING_ENABLED,
  shouldIndexCategoryLanding,
  shouldIndexLocalListingPage,
  shouldIndexSettingState,
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
//
// Indexing audit (2026-09): the verdicts count distinct postings, not rows
// (lib/pseo/posting-clusters.ts). Setting x state rows store the STRICT gate
// (shouldIndexSettingState: 5 postings, 3 employers, 3 role clusters, top
// employer at most half, an indexable parent hub, at most 70 percent of the
// hub, a posting in the last 30 days), computed against one load of every
// hub verdict per run. Then, per state, two passing sibling settings whose
// counted job sets overlap 70 percent or more keep one verdict, the larger
// page's (dedupeSiblingSettingStates, CQ-01): so every setting's rows are
// computed before any setting-state row is written. Whether a stored `true`
// actually indexes is decided by the FB-1 switch,
// SETTING_STATE_INDEXING_ENABLED, at read time. Category landings count the
// shared landingBucketWhere and store the listing-floor verdict.
export const maxDuration = 300

const BATCH_SIZE = 200 // Cities per invocation
const TIME_BUDGET_MS = 250_000 // abort safety margin under maxDuration

/** Rows written per raw UPDATE statement (6 bind parameters each). */
const WRITE_CHUNK_ROWS = 250

/**
 * Memory guard for the per-category row fetch behind the setting x state
 * and landing verdicts. The canonical pool is about one thousand rows today;
 * a category that ever exceeds this cap falls back to one count query per
 * state for its totals, and its setting x state verdicts close (a sample
 * cannot prove a floor).
 */
const FACT_ROW_CAP = 10_000

/**
 * Placeholder location handed to a config's buildWhere so its location keys
 * can be stripped. The value never reaches the database: stripLocationKeys()
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

/** A groupBy row over (state, city, employer, title) inside one category. */
interface CityEmployerGroup {
  state: string | null
  city: string | null
  employer: string | null
  title: string | null
  _count: { _all: number }
}

/**
 * The projection the gate counts read: the id (sibling job sets), employer
 * (with its company id for the alias merge), the title (postings and role
 * clusters), the location, the structured work mode (the remote and
 * telehealth gates) and the posted dates (the 30 day recency rule).
 */
const GATE_ROW_SELECT = {
  id: true,
  originalPostedAt: true,
  createdAt: true,
  employer: true,
  companyId: true,
  title: true,
  city: true,
  state: true,
  stateCode: true,
  isRemote: true,
  isHybrid: true,
} as const satisfies Prisma.JobSelect

interface GateRow extends SettingStateGateRow {
  id: string
  companyId: string | null
}

/**
 * A setting x state row before sibling de-duplication: the stored columns
 * plus the job set and posting count the de-duplication compares
 * (./setting-state-siblings.ts).
 */
interface SettingStateDraft extends StatsRow {
  gateJobIds: string[]
  gatePostings: number
}

/** The stored rows from every setting's drafts, sibling verdicts applied. */
function finalizeSettingStateRows(drafts: readonly SettingStateDraft[], complete: boolean): StatsRow[] {
  const verdicts = settingStateSiblingVerdicts(drafts, complete)
  return drafts.map((d) => ({
    type: d.type,
    categorySlug: d.categorySlug,
    locationSlug: d.locationSlug,
    totalJobs: d.totalJobs,
    distinctEmployers: d.distinctEmployers,
    indexable: verdicts.get(settingStateKey(d.categorySlug, d.locationSlug)) ?? false,
  }))
}

/** JS twin of Prisma `{ equals: value, mode: 'insensitive' }`. */
function sameText(stored: string | null | undefined, wanted: string): boolean {
  return typeof stored === 'string' && stored.toLowerCase() === wanted.toLowerCase()
}

/** Lookup key for an in-memory (state, city) bucket. */
function cityKey(state: string, city: string): string {
  return `${state.toLowerCase()}|${city.toLowerCase()}`
}

/** Newest-first canonical row sample for one bucket, capped as a memory guard. */
async function fetchGateRows(bucket: Prisma.JobWhereInput, now: Date): Promise<{ rows: GateRow[]; capped: boolean }> {
  const rows: GateRow[] = await prisma.job.findMany({
    where: canonicalBucketWhere(bucket, now),
    select: GATE_ROW_SELECT,
    orderBy: { createdAt: 'desc' },
    take: FACT_ROW_CAP,
  })
  const list = Array.isArray(rows) ? rows : []
  return { rows: list, capped: list.length >= FACT_ROW_CAP }
}

/**
 * Every state hub's verdict, loaded once per run for the strict setting x
 * state gate. A failed load closes every hub, and with it every setting x
 * state verdict of the run: a child never indexes on an unknown parent.
 */
async function loadHubVerdictsOrNone(now: Date): Promise<Map<string, StateHubVerdict>> {
  try {
    return await loadStateHubVerdicts(now)
  } catch (error) {
    console.error('[pseo-agg] state hub verdicts unavailable; every setting-state verdict this run is false:', error)
    return new Map()
  }
}

/**
 * Setting x state rows for one setting config: one row fetch for the whole
 * category, split per state in memory. The stored `indexable` is the strict
 * gate (shouldIndexSettingState) over buildSettingStateIndexFacts, which
 * counts distinct postings (fully remote rows only for remote and
 * telehealth) against the parent hub's verdict.
 */
async function aggregateSettingState(
  config: SettingConfig,
  stateSlugs: readonly string[],
  now: Date,
  hubs: ReadonlyMap<string, StateHubVerdict>,
): Promise<SettingStateDraft[]> {
  const { rows, capped } = await fetchGateRows(stripLocationKeys(config.buildWhere(LOCATION_PROBE)), now)
  const out: SettingStateDraft[] = []
  for (const stateSlug of stateSlugs) {
    const stateName = resolveStateSlug(stateSlug)
    if (!stateName) continue
    const stateRows = rows.filter((row) => sameText(row.state, stateName))
    const totalJobs = capped
      ? await prisma.job.count({
          where: canonicalBucketWhere(config.buildWhere(stateName) as Prisma.JobWhereInput, now),
        })
      : stateRows.length
    const indexFacts = buildSettingStateIndexFacts({ slug: config.slug, rows: stateRows, hub: hubs.get(stateName), now })
    out.push({
      type: 'setting-state',
      categorySlug: config.slug,
      locationSlug: stateSlug,
      totalJobs,
      distinctEmployers: selectEmployers(stateRows).distinct,
      indexable: !capped && shouldIndexSettingState(indexFacts),
      gateJobIds: settingStateGateJobIds(config.slug, stateRows),
      gatePostings: indexFacts.postings,
    })
  }
  return out
}

/**
 * One 'category-landing' row per taxonomy slug (locationSlug 'all') over the
 * shared landingBucketWhere, the clause the landing page itself counts:
 * the canonical total, the distinct employers (selectEmployers, alias
 * merging) and the listing-floor verdict over distinct postings.
 */
async function aggregateCategoryLanding(slug: string, now: Date): Promise<StatsRow> {
  const { rows, capped } = await fetchGateRows(landingBucketWhere(slug), now)
  const totalJobs = capped
    ? await prisma.job.count({ where: canonicalBucketWhere(landingBucketWhere(slug), now) })
    : rows.length
  const { distinct } = selectEmployers(rows)
  const postings = distinctPostingTotal(totalJobs, countPostings(rows))
  return {
    type: 'category-landing',
    categorySlug: slug,
    locationSlug: LANDING_LOCATION_SLUG,
    totalJobs,
    distinctEmployers: distinct,
    indexable: shouldIndexCategoryLanding({ activeJobs: postings, distinctEmployers: distinct }),
  }
}

/**
 * One grouped query per category for a batch of cities: rows grouped by
 * (state, city, employer, title) inside the batch's states, bucketed in
 * memory by the same case-insensitive (state, city) equality the city
 * template queries with. Returns the buckets; rowsForCity() reads them per
 * city. The title in the grouping lets the verdict count distinct postings.
 */
async function groupCategoryByCity(
  config: CategoryConfig,
  cities: readonly CityRecord[],
  now: Date,
): Promise<Map<string, CityEmployerGroup[]>> {
  const category = stripLocationKeys(config.buildWhere(LOCATION_PROBE, LOCATION_PROBE))
  const stateNames = [...new Set(cities.map((city) => city.state))]
  // Not annotated: Prisma infers groupBy's result from its argument, and an
  // annotation on the binding makes it type the argument as the array.
  const groups = await prisma.job.groupBy({
    by: ['state', 'city', 'employer', 'title'],
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

/**
 * The category x city rows for one city, read from the per-category buckets.
 * totalJobs stays the row count (the page's render floor and printed
 * count); the verdict counts distinct postings, each (employer, title)
 * group being one posting at this location.
 */
function rowsForCity(
  city: CityRecord,
  bucketsByCategory: ReadonlyMap<string, Map<string, CityEmployerGroup[]>>,
): StatsRow[] {
  const key = cityKey(city.state, city.name)
  return [...bucketsByCategory.entries()].map(([categorySlug, buckets]) => {
    const groups = buckets.get(key) ?? []
    const totalJobs = groups.reduce((sum, group) => sum + group._count._all, 0)
    const { distinct } = selectEmployers(groups.map((group) => ({ employer: group.employer, companyId: null })))
    const postings = countPostings(groups.map((group) => ({
      employer: group.employer,
      title: group.title ?? '',
      city: group.city,
      state: group.state,
      stateCode: null,
    }))).postings
    return {
      type: 'category-city',
      categorySlug,
      locationSlug: city.slug,
      totalJobs,
      distinctEmployers: distinct,
      indexable: shouldIndexLocalListingPage({ activeJobs: postings, distinctEmployers: distinct }),
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
    // Setting x state rows whose stored strict verdict is true. They index
    // only once SETTING_STATE_INDEXING_ENABLED is turned on (FB-1); the count
    // is reported so the owner can see what would re-enter.
    let settingStateStrictPassCount = 0
    let categoryLandingCount = 0
    let categoryCityCount = 0

    // Phase 1: Setting x State (28 settings x 51 states) plus the
    // category-landing rows (one per taxonomy slug). Runs on every scheduled
    // entry run so these rows stay well inside the freshness window (matches
    // pre-fix behaviour, where the offset was always 0). Chained links pass
    // mode=city to skip it. One hub-pool query per run, one row query per
    // setting and one per landing slug; nothing per row.
    if (mode !== 'city') {
      const stateSlugs = getAllStateSlugs()
      const hubs = await loadHubVerdictsOrNone(now)

      // Setting x state first, every setting before any write: the sibling
      // de-duplication (CQ-01) compares all settings of a state at once. A
      // setting whose query fails is logged and skipped (its stored rows age
      // out through the freshness window), and like a budget cut it leaves
      // the comparison incomplete, so the run writes what it computed with
      // every verdict closed (settingStateSiblingVerdicts).
      const settingConfigs = Object.values(SETTING_CONFIGS)
      const drafts: SettingStateDraft[] = []
      let settingsComputed = 0
      let settingFailed = false
      for (const config of settingConfigs) {
        if (Date.now() - startTime > TIME_BUDGET_MS) break
        try {
          drafts.push(...await aggregateSettingState(config, stateSlugs, now, hubs))
        } catch (error) {
          settingFailed = true
          console.error(`[pseo-agg] Error in setting-state ${config.slug}:`, error)
        }
        settingsComputed++
      }
      const settingsComplete = settingsComputed === settingConfigs.length
      const settingVerdictsComplete = settingsComplete && !settingFailed
      try {
        const settingRows = finalizeSettingStateRows(drafts, settingVerdictsComplete)
        await writeStatsRows(settingRows, now)
        settingStateCount += settingRows.length
        settingStateStrictPassCount += settingRows.filter((row) => row.indexable).length
        const siblingDrops = drafts.filter((d) => d.indexable).length - settingStateStrictPassCount
        if (siblingDrops > 0 && settingVerdictsComplete) {
          console.log(`[pseo-agg] ${siblingDrops} setting-state verdict(s) closed as near-copies of a larger sibling`)
        }
      } catch (error) {
        console.error('[pseo-agg] Error writing setting-state rows:', error)
      }

      const phaseOneUnits: Array<() => Promise<StatsRow[]>> = [
        ...ALL_CATEGORY_SLUGS.map((slug) => async () => [await aggregateCategoryLanding(slug, now)]),
      ]

      for (const unit of phaseOneUnits) {
        // Budget check: if Phase 1 alone blows the budget, bail without
        // touching the city cursor so Phase 2 work is never skipped-over.
        if (!settingsComplete || Date.now() - startTime > TIME_BUDGET_MS) {
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
          categoryLandingCount += rows.length
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
            settingStateStrictPassCount,
            settingStateIndexingEnabled: SETTING_STATE_INDEXING_ENABLED,
            categoryLandingCount,
            elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
            timestamp: new Date().toISOString(),
          }),
          metrics: { mode: 'state', settingStateCount, settingStateStrictPassCount, categoryLandingCount },
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
        settingStateStrictPassCount,
        settingStateIndexingEnabled: SETTING_STATE_INDEXING_ENABLED,
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
        settingStateStrictPassCount,
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
