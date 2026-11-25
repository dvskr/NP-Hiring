/**
 * The source registry against the ingest funnel, for the admin pipeline page.
 *
 * A source that stopped running leaves no source_stats row, so the funnel list
 * alone never shows it: it is simply absent. Walking the registry and marking
 * each source with no row in the window makes the gap visible.
 *
 * This board's registry also holds sources it deliberately does not schedule
 * (DISABLED_SOURCES in config/cron-schedule.ts). Those can never have a row,
 * so they are split out first rather than reported as silent every day.
 */

export interface FunnelCounts {
    source: string;
    fetched: number;
    added: number;
}

export interface RegistrySourceRow {
    source: string;
    /** False when the window holds no source_stats row for this source. */
    hasStats: boolean;
    fetched: number;
    added: number;
}

/** Silent sources first (they need a look), then the rest, each in registry order. */
export function describeRegistrySources(
    registry: readonly string[],
    funnels: readonly FunnelCounts[],
): RegistrySourceRow[] {
    const bySource = new Map(funnels.map((f) => [f.source, f]));
    const rows = registry.map((source): RegistrySourceRow => {
        const funnel = bySource.get(source);
        return funnel
            ? { source, hasStats: true, fetched: funnel.fetched, added: funnel.added }
            : { source, hasStats: false, fetched: 0, added: 0 };
    });
    return [...rows.filter((r) => !r.hasStats), ...rows.filter((r) => r.hasStats)];
}

export interface ScheduledSourceSplit {
    /** Registry sources this board runs, in registry order. */
    scheduled: string[];
    /** Registry sources this board deliberately does not run, in registry order. */
    unscheduled: string[];
}

/** Split the registry into the sources this board schedules and the ones it does not. */
export function splitScheduledSources(
    registry: readonly string[],
    unscheduled: readonly string[],
): ScheduledSourceSplit {
    const off = new Set(unscheduled);
    return {
        scheduled: registry.filter((source) => !off.has(source)),
        unscheduled: registry.filter((source) => off.has(source)),
    };
}
