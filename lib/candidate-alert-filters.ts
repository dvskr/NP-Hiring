import { SPECIALTY_PRESETS, LICENSE_STATE_OPTIONS } from '@/config/niche/credentials';

/**
 * The limits on an employer's candidate alert filters, shared by the
 * settings route (app/api/employer/candidate-alerts) and the daily digest
 * (app/api/cron/candidate-alerts).
 *
 * SECURITY (EMP-ALERT-1): the settings route stored lists as they arrived,
 * and the digest turned each entry into its own query branch. The caps come
 * from the option lists the settings page offers: every state, and twice the
 * specialty presets, because GET hands stored values back and the page posts
 * them again, including any outside today's presets. The digest applies the
 * same caps to rows stored before the check.
 * Register 2.26: the caps were declared in both files.
 * Tests: tests/api/employer-candidate-alerts-body.test.ts,
 * tests/api/cron-candidate-alerts-pool.test.ts,
 * tests/regressions/talent-pool-shared-rules.test.ts
 */
export const MAX_ALERT_SPECIALTIES = SPECIALTY_PRESETS.length * 2;
export const MAX_ALERT_STATES = LICENSE_STATE_OPTIONS.length;

/** Stored form of a filter list: unique entries joined with commas, or null for no filter. */
export function joinAlertList(list: readonly string[] | undefined): string | null {
    return list && list.length > 0 ? Array.from(new Set(list)).join(',') : null;
}

/**
 * A stored comma string back to its entries, at most `cap` of them. Empty
 * entries are dropped: the settings route refuses them, and an empty
 * `contains` in the digest would match every candidate.
 */
export function splitAlertList(value: string | null, cap: number): string[] {
    if (!value) return [];
    return value.split(',').map(s => s.trim()).filter(Boolean).slice(0, cap);
}
