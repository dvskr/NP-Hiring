/**
 * Niche regulatory pack — the per-niche "state regulatory context"
 * surface. Every job board in a licensed profession has some notion of
 * "what may this professional do in state X"; this module is where a
 * niche plugs in that answer. For the PMHNP board it is NP practice
 * authority (full / reduced / restricted, per AANP), implemented in
 * lib/state-practice-authority.ts and re-exported here unchanged.
 *
 * ── FOR FORKS ─────────────────────────────────────────────────────────
 * A new niche supplies its OWN regulatory module with the same
 * interface (a per-state record + lookup/label/color helpers) and
 * re-exports it from this file. Shipping the PMHNP practice-authority
 * claims on another niche is not just wrong copy — it is a YMYL /
 * liability hazard: these are professional-scope-of-practice claims
 * rendered on public state pages. If the new niche has no equivalent
 * concept, this surface (and the UI that renders it) must be removed,
 * not left serving NP data. See docs/templatization-plan.md ("niche
 * pack" table, `regulatory.ts` row).
 *
 * ── MIGRATION STATUS ──────────────────────────────────────────────────
 * Existing consumers still import lib/state-practice-authority.ts
 * directly; nothing has been rewired yet. Consumers migrate to this
 * surface when the second board lands. Until then this file is the
 * documented seam, not the live import path — do not add PMHNP-specific
 * data here, and do not edit the underlying data through this file.
 */

export type { PracticeAuthority, StatePracticeInfo } from '@/lib/state-practice-authority';
export {
    STATE_PRACTICE_AUTHORITY,
    getStatePracticeAuthority,
    getStatesByAuthority,
    getAuthorityLabel,
    getAuthorityColor,
} from '@/lib/state-practice-authority';
