import { NextRequest, NextResponse } from 'next/server';
import {
  getSourcePerformance,
  getAllSourcesPerformance,
  getSourceTrends,
} from '@/lib/source-analytics';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/analytics/sources
 * Returns source performance data
 *
 * Query params:
 * - source: specific source to query (optional)
 * - days: number of days to look back (default: 30)
 * - includeTrends: include trend data (default: false)
 */
export async function GET(request: NextRequest) {
  try {
    // Admin-only: whole-platform source performance analytics. Previously open.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const viewer = await prisma.userProfile.findUnique({ where: { supabaseId: user.id }, select: { role: true } });
    if (viewer?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const days = parseInt(searchParams.get('days') || '30', 10);
    const includeTrends = searchParams.get('includeTrends') === 'true';

    // Validate days parameter
    if (days < 1 || days > 365) {
      return NextResponse.json(
        { error: 'Days must be between 1 and 365' },
        { status: 400 }
      );
    }

    // Single source performance
    if (source) {
      const performance = await getSourcePerformance(source, days);
      
      if (includeTrends) {
        const trends = await getSourceTrends(source, days);
        return NextResponse.json({
          performance,
          trends,
        });
      }

      return NextResponse.json(performance);
    }

    // All sources performance
    const allPerformance = await getAllSourcesPerformance();

    if (includeTrends) {
      // Get trends for all sources if requested
      const trendsPromises = allPerformance.map(async (perf) => ({
        source: perf.source,
        trends: await getSourceTrends(perf.source, days),
      }));

      const allTrends = await Promise.all(trendsPromises);

      return NextResponse.json({
        sources: allPerformance,
        trends: allTrends,
      });
    }

    return NextResponse.json({ sources: allPerformance });
  } catch (error) {
    console.error('[API] Error getting source analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch source analytics' },
      { status: 500 }
    );
  }
}

// NOTE (dead-code cleanup, B15): a POST handler used to live here whose only
// action ('update-daily') invoked lib/source-analytics.ts:updateDailyStats().
// No cron or UI ever called it (config/cron-schedule.ts is the full cron
// inventory), so the aggregation it triggered never ran. Both were removed
// 2026-07-18. The admin-gated GET above remains as internal tooling over the
// live recordIngestionStats / ApplyClick write paths.
