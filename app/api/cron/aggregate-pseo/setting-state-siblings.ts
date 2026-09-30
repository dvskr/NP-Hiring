/**
 * Sibling de-duplication for the setting x state verdicts (indexing audit
 * CQ-01). The strict gate (shouldIndexSettingState) judges one setting at a
 * time; this step compares every setting of a state at once, which only the
 * cron can do: two passing settings whose counted job sets overlap 70
 * percent or more are one page twice, so only the larger keeps its verdict
 * (lib/pseo/setting-state-index.ts dedupeSiblingSettingStates). Pure; the
 * route keeps its own row type, so this returns verdicts by key.
 */
import { dedupeSiblingSettingStates } from '@/lib/pseo/setting-state-index'

/** What the de-duplication reads from one setting x state draft row. */
export interface SettingStateSiblingDraft {
  categorySlug: string
  locationSlug: string
  /** The strict gate's verdict before de-duplication. */
  indexable: boolean
  /** The job ids the gate counted. */
  gateJobIds: readonly string[]
  /** Distinct postings behind them. */
  gatePostings: number
}

/** The verdict map key for one setting in one state. */
export function settingStateKey(categorySlug: string, locationSlug: string): string {
  return `${categorySlug}|${locationSlug}`
}

/**
 * The final verdict of every draft, keyed by settingStateKey. Within each
 * state, a passing verdict survives only for the settings
 * dedupeSiblingSettingStates keeps. `complete` is false when a budget cut
 * left some settings uncomputed: a sibling that was never compared cannot
 * be ruled out, so every verdict of such a run is closed (a child never
 * indexes on an unknown comparison).
 */
export function settingStateSiblingVerdicts(
  drafts: readonly SettingStateSiblingDraft[],
  complete: boolean,
): Map<string, boolean> {
  const byState = new Map<string, SettingStateSiblingDraft[]>()
  for (const draft of drafts) {
    const list = byState.get(draft.locationSlug)
    if (list) list.push(draft)
    else byState.set(draft.locationSlug, [draft])
  }
  const verdicts = new Map<string, boolean>()
  for (const [state, list] of byState) {
    const kept = dedupeSiblingSettingStates(list.map((d) => ({
      slug: d.categorySlug,
      jobIds: d.gateJobIds,
      postings: d.gatePostings,
      passes: d.indexable,
    })))
    for (const d of list) {
      verdicts.set(settingStateKey(d.categorySlug, state), complete && d.indexable && kept.has(d.categorySlug))
    }
  }
  return verdicts
}
