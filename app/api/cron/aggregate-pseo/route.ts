import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { CITIES } from '@/lib/pseo/city-data/cities'
import { ALL_CATEGORY_CONFIGS } from '@/lib/pseo/category-city-template'
import { SETTING_CONFIGS, getAllStateSlugs, resolveStateSlug } from '@/lib/pseo/setting-state-config'
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
//   1. A persisted rotating cursor (PseoStats sentinel row — ./cursor),
//      advanced by however many cities actually completed, so even a batch
//      aborted by the time budget makes forward progress, and the rotation
//      wraps around the full city list.
//   2. A self-chaining follow-up request (./chain) so one scheduled run
//      walks the remainder of the rotation instead of advancing one
//      200-city step per 6-hourly run — required to keep rows inside the
//      36h staleness window used by the sitemaps and internal-link mesh.
//      If a chain dies silently, the cursor resumes on the next schedule.
// An explicit ?offset= (admin manual trigger / chain links) overrides the
// persisted cursor for that run; the cursor is re-persisted from wherever
// the run actually ended.
export const maxDuration = 300

const BATCH_SIZE = 200 // Cities per invocation
const TIME_BUDGET_MS = 250_000 // abort safety margin under maxDuration

export async function GET(request: NextRequest) {
  const authError = await verifyCronOrAdmin(request);
  if (authError) return authError;

  const startTime = Date.now()
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
    let categoryCityCount = 0

    // ─── Phase 1: Setting × State (fast — ~663 combinations) ───
    // Runs on every scheduled entry run so setting-state rows stay well
    // inside the 36h staleness window (matches pre-fix behaviour, where
    // the offset was always 0). Chained links pass mode=city to skip it.
    if (mode !== 'city') {
      const stateSlugs = getAllStateSlugs()
      const settingKeys = Object.keys(SETTING_CONFIGS)

      for (const settingKey of settingKeys) {
        const config = SETTING_CONFIGS[settingKey]
        for (const stateSlug of stateSlugs) {
          // Budget check: if Phase 1 alone blows the budget, bail without
          // touching the city cursor so Phase 2 work is never skipped-over.
          if (Date.now() - startTime > TIME_BUDGET_MS) {
            console.warn(`[pseo-agg] Timeout safety in Phase 1 after ${settingStateCount} setting-state rows — city cursor stays at ${startOffset}`)
            const cursorPersisted = await persistCityCursor(startOffset)
            return {
              response: NextResponse.json({
                success: true,
                partial: true,
                phase: 'setting-state',
                settingStateCount,
                categoryCityCount: 0,
                batchInfo: { offset: startOffset, cursorSource, citiesCompleted: 0, nextOffset: startOffset, totalCities, cursorPersisted },
                elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
                timestamp: new Date().toISOString(),
              }),
              metrics: { partial: true, phase: 'setting-state', settingStateCount, startOffset, citiesCompleted: 0, nextOffset: startOffset, totalCities, cursorPersisted },
            }
          }

          const stateName = resolveStateSlug(stateSlug)
          if (!stateName) continue

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const where = config.buildWhere(stateName) as any
            const totalJobs = await prisma.job.count({ where })

            let rawAvg = 0
            if (totalJobs > 0) {
              const salaryData = await prisma.job.aggregate({
                where: { ...where, normalizedMinSalary: { not: null }, normalizedMaxSalary: { not: null } },
                _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
              })
              rawAvg = Math.round(
                ((salaryData._avg.normalizedMinSalary || 0) + (salaryData._avg.normalizedMaxSalary || 0)) / 2 / 1000
              )
            }

            await prisma.pseoStats.upsert({
              where: { type_categorySlug_locationSlug: { type: 'setting-state', categorySlug: config.slug, locationSlug: stateSlug } },
              update: { totalJobs, rawAvgSalary: rawAvg, colAdjustedSalary: 0 },
              create: { type: 'setting-state', categorySlug: config.slug, locationSlug: stateSlug, totalJobs, rawAvgSalary: rawAvg, colAdjustedSalary: 0 },
            })
            settingStateCount++
          } catch (error) {
            console.error(`[pseo-agg] Error setting-state ${config.slug}/${stateSlug}:`, error)
          }
        }
      }

      // If mode is state-only, return early
      if (mode === 'state') {
        return {
          response: NextResponse.json({
            success: true,
            mode: 'state',
            settingStateCount,
            elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
            timestamp: new Date().toISOString(),
          }),
          metrics: { mode: 'state', settingStateCount },
        }
      }
    }

    // ─── Phase 2: Category × City (rotating cursor — BATCH_SIZE cities max) ───
    const batchEnd = Math.min(startOffset + BATCH_SIZE, totalCities)
    const categoryKeys = Object.keys(ALL_CATEGORY_CONFIGS)
    let citiesCompleted = 0
    let timedOut = false

    for (let i = startOffset; i < batchEnd; i++) {
      const city = CITIES[i]
      if (!city) {
        citiesCompleted++ // defensive: consume the slot so the cursor still advances
        continue
      }

      // Check elapsed time — abort gracefully if nearing timeout. The
      // cursor advances by COMPLETED cities only, so the interrupted city
      // is re-processed by the next link/run instead of being skipped.
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        timedOut = true
        break
      }

      for (const categoryKey of categoryKeys) {
        const config = ALL_CATEGORY_CONFIGS[categoryKey]
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const where = config.buildWhere(city.state, city.name) as any
          const totalJobs = await prisma.job.count({ where })

          let rawAvg = 0
          let colAdjustedSalary = 0

          if (totalJobs > 0) {
            const salaryData = await prisma.job.aggregate({
              where: { ...where, normalizedMinSalary: { not: null }, normalizedMaxSalary: { not: null } },
              _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
            })
            rawAvg = Math.round(
              ((salaryData._avg.normalizedMinSalary || 0) + (salaryData._avg.normalizedMaxSalary || 0)) / 2 / 1000
            )
            colAdjustedSalary = rawAvg > 0 ? Math.round(rawAvg * (100 / city.costOfLivingIndex)) : 0
          }

          await prisma.pseoStats.upsert({
            where: { type_categorySlug_locationSlug: { type: 'category-city', categorySlug: config.slug, locationSlug: city.slug } },
            update: { totalJobs, rawAvgSalary: rawAvg, colAdjustedSalary },
            create: { type: 'category-city', categorySlug: config.slug, locationSlug: city.slug, totalJobs, rawAvgSalary: rawAvg, colAdjustedSalary },
          })
          categoryCityCount++
        } catch (error) {
          console.error(`[pseo-agg] Error category-city ${config.slug}/${city.slug}:`, error)
        }
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

    // Self-chain the remainder of the rotation (complement — the cursor
    // alone still guarantees forward progress if this dies silently).
    const chainDispatched = dispatchSelfChain({ nextOffset, chainDepth })

    // Coverage staleness probe + Discord alert — scheduled entry runs only,
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
