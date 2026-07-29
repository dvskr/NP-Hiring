'use client';

/**
 * Multi-state licensure planner (P2 #6).
 *
 * WHAT IT CLAIMS, AND WHY THOSE CLAIMS ARE SAFE
 * Every per-state statement below is read from a sourced dataset this package
 * can stand behind: practice-authority tier comes from lib/state-practice-
 * authority.ts (AANP), the guide link from a published state_spotlight post,
 * the jobs link from a real route. Nothing per-state is asserted about the
 * Nurse Licensure Compact — see the note below.
 *
 * WHY THERE IS NO PER-STATE COMPACT VERDICT HERE  ← do not "restore" this
 * An earlier revision rendered a member / not-in-the-compact badge per state,
 * a "your multistate RN license covers this state — no separate RN
 * application" verdict, and a "N of 51 jurisdictions are compact members"
 * headline, all derived from LICENSE_GUIDE_NLC_NON_MEMBERS in
 * lib/blog-license-guides.ts (mirrored in lib/pseo/state-narrative.ts).
 *
 * That set is wrong in both directions as of 2026-07: it omits Alaska, which
 * is NOT an NLC member, and lists Connecticut, Rhode Island and Washington as
 * non-members when all three ARE members. The drift test between the two
 * copies only proves they agree with each other, not that either is accurate.
 * NCSBN's own compact site put the count at 43 member jurisdictions when this
 * was checked, against the 38-of-51 the set implied.
 *
 * Membership is also not a single bit: some jurisdictions have enacted the
 * compact without an implementation date, and others are partially
 * implemented. Turning that into "no separate RN application needed" for a
 * named state is actionable, personalized advice on a YMYL surface, so it does
 * not ship until the shared dataset is re-verified against NCSBN by its owner.
 * Until then this planner states the compact RULES (which are stable and
 * correct) and links to NCSBN for the current member list.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, BadgeCheck, ExternalLink, Map as MapIcon,
  ShieldAlert, ShieldCheck, ShieldX, type LucideIcon,
} from 'lucide-react';
import { brand } from '@/config/brand';
import ToolStyles from './ToolStyles';
import { TOOL_ACCENT, clayCard, labelStyle } from './tool-theme';

export type PlannerAuthority = 'full' | 'reduced' | 'restricted';

/**
 * Deliberately carries no compact-membership field. Keeping membership out of
 * the type is what stops a per-state verdict being reintroduced by accident.
 */
export interface PlannerState {
  name: string;
  authority: PlannerAuthority;
  /** Slug of the published licensure guide for this state, when one exists. */
  guideSlug: string | null;
}

interface Props {
  states: readonly PlannerState[];
}

const AUTHORITY_META: Record<PlannerAuthority, {
  label: string;
  color: string;
  bg: string;
  icon: LucideIcon;
  consequence: string;
}> = {
  full: {
    label: 'Full practice authority',
    color: '#047857',
    bg: '#D1FAE5',
    icon: ShieldCheck,
    consequence: 'no collaborative agreement or physician supervision required to evaluate, diagnose, and prescribe.',
  },
  reduced: {
    label: 'Reduced practice',
    color: '#B45309',
    bg: '#FEF3C7',
    icon: ShieldAlert,
    consequence: 'a collaborative agreement with a physician is required for at least one element of practice.',
  },
  restricted: {
    label: 'Restricted practice',
    color: '#B91C1C',
    bg: '#FEE2E2',
    icon: ShieldX,
    consequence: 'career-long physician supervision, delegation, or team management is required to practise.',
  },
};

/** NCSBN's compact site — the authoritative, current member list. */
const NLC_SOURCE_URL = 'https://www.nursecompact.com/';

function jobsPath(stateName: string): string {
  return `/jobs/state/${stateName.toLowerCase().replace(/\s+/g, '-')}`;
}

export default function MultiStatePlanner({ states }: Props) {
  const [targets, setTargets] = useState<readonly string[]>([]);

  const byName = useMemo(() => new Map(states.map((s) => [s.name, s])), [states]);

  const toggleTarget = (name: string) =>
    setTargets((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const planned: PlannerState[] = useMemo(
    () =>
      targets
        .map((name) => byName.get(name))
        .filter((s): s is PlannerState => Boolean(s))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [targets, byName],
  );

  const fullCount = planned.filter((s) => s.authority === 'full').length;
  const reducedCount = planned.filter((s) => s.authority === 'reduced').length;
  const restrictedCount = planned.filter((s) => s.authority === 'restricted').length;

  return (
    <div style={{ ...clayCard, padding: '0', overflow: 'hidden', border: '2px solid rgba(99,102,241,0.14)' }}>
      <ToolStyles />

      {/* Header */}
      <div style={{ background: 'linear-gradient(145deg, #4338CA, #3730A3)', padding: '24px 30px', display: 'flex', alignItems: 'center', gap: '15px' }}>
        <span
          style={{
            width: '50px', height: '50px', borderRadius: '15px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.15)', color: '#fff',
          }}
          aria-hidden="true"
        >
          <MapIcon size={25} />
        </span>
        <div>
          <h2 style={{ fontSize: '21px', fontWeight: 800, color: '#fff', margin: 0, lineHeight: 1.2 }}>
            Multi-state licensure planner
          </h2>
          <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.72)', margin: '4px 0 0' }}>
            What changes state to state — practice authority, the licensure guide, and where the roles are
          </p>
        </div>
      </div>

      {/* Inputs */}
      <div style={{ padding: '26px 30px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ ...labelStyle, marginBottom: '10px' }}>States you want to practise in</legend>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '6px',
              maxHeight: '270px',
              overflowY: 'auto',
              padding: '4px',
              border: '1px solid rgba(0,0,0,0.07)',
              borderRadius: '14px',
              background: '#FAFAFA',
            }}
          >
            {states.map((s) => {
              const inputId = `planner-target-${s.name.toLowerCase().replace(/\s+/g, '-')}`;
              const checked = targets.includes(s.name);
              return (
                <label
                  key={s.name}
                  htmlFor={inputId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '9px',
                    padding: '8px 11px', borderRadius: '10px', cursor: 'pointer',
                    background: checked ? '#EEF2FF' : 'transparent',
                    fontSize: '13.5px', fontWeight: checked ? 700 : 500,
                    color: checked ? '#3730A3' : '#1A2E35',
                  }}
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTarget(s.name)}
                    style={{ width: '16px', height: '16px', accentColor: '#4338CA', flexShrink: 0, cursor: 'pointer' }}
                  />
                  {s.name}
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
            <button
              type="button"
              onClick={() => setTargets([])}
              disabled={targets.length === 0}
              style={{
                padding: '8px 16px', borderRadius: '10px',
                border: '1.5px solid rgba(190,24,93,0.2)', background: 'transparent',
                fontSize: '12px', fontWeight: 700,
                color: targets.length === 0 ? '#CBD5E1' : TOOL_ACCENT,
                cursor: targets.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Clear selection
            </button>
            <span style={{ fontSize: '12px', color: '#94A3B8', alignSelf: 'center' }}>
              {targets.length} selected
            </span>
          </div>
        </fieldset>
      </div>

      {/* Results */}
      {planned.length === 0 ? (
        <div style={{ padding: '44px 30px', textAlign: 'center' }}>
          <span
            style={{
              width: '64px', height: '64px', borderRadius: '18px', margin: '0 auto 14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#F1F5F9', color: '#94A3B8',
            }}
            aria-hidden="true"
          >
            <BadgeCheck size={30} />
          </span>
          <p style={{ fontSize: '16px', fontWeight: 700, color: '#94A3B8', margin: '0 0 4px' }}>
            Pick the states you are considering
          </p>
          <p style={{ fontSize: '13px', color: '#CBD5E1', margin: 0 }}>
            The planner will line them up by practice authority and link each one&apos;s licensure guide.
          </p>
        </div>
      ) : (
        <div style={{ padding: '26px 30px' }}>
          {/* Summary tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '22px' }}>
            {[
              { value: planned.length, label: 'States selected', bg: '#F1F5F9', color: '#334155' },
              { value: planned.length, label: 'Need their own APRN license', bg: '#EEF2FF', color: '#3730A3' },
              { value: fullCount, label: 'Full practice authority', bg: '#D1FAE5', color: '#047857' },
              { value: reducedCount, label: 'Reduced practice', bg: '#FEF3C7', color: '#B45309' },
              { value: restrictedCount, label: 'Restricted practice', bg: '#FEE2E2', color: '#B91C1C' },
            ].map((tile) => (
              <div key={tile.label} style={{ padding: '14px 16px', borderRadius: '13px', background: tile.bg }}>
                <div style={{ fontSize: '24px', fontWeight: 800, color: tile.color, lineHeight: 1 }}>{tile.value}</div>
                <div style={{ fontSize: '11.5px', color: '#64748B', marginTop: '3px', lineHeight: 1.35 }}>{tile.label}</div>
              </div>
            ))}
          </div>

          {/* Per-state rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {planned.map((s) => {
              const meta = AUTHORITY_META[s.authority];
              const AuthorityIcon = meta.icon;
              return (
                <div
                  key={s.name}
                  style={{
                    padding: '16px 18px', borderRadius: '14px',
                    background: '#FFF', border: '1px solid rgba(0,0,0,0.07)',
                    display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '14px', alignItems: 'start',
                  }}
                  className="planner-row"
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap', marginBottom: '7px' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>{s.name}</h3>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '20px', background: meta.bg, color: meta.color, fontSize: '11px', fontWeight: 700 }}>
                        <AuthorityIcon size={12} aria-hidden="true" /> {meta.label}
                      </span>
                    </div>
                    <p style={{ fontSize: '13px', color: '#5A4A42', margin: '0 0 5px', lineHeight: 1.6 }}>
                      <strong>Practice authority:</strong> {meta.consequence}
                    </p>
                    <p style={{ fontSize: '13px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                      <strong>APRN layer:</strong> {s.name} issues its own APRN license — the compact does not
                      cover it. Confirm current requirements with the {s.name} board of nursing.
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', alignItems: 'flex-end' }}>
                    {s.guideSlug && (
                      <Link
                        href={`/blog/${s.guideSlug}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '7px 13px', borderRadius: '18px', background: '#FDF2F8', color: TOOL_ACCENT, fontSize: '12px', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}
                      >
                        {s.name} guide <ArrowRight size={11} />
                      </Link>
                    )}
                    <Link
                      href={jobsPath(s.name)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '7px 13px', borderRadius: '18px', background: '#EEF2FF', color: '#4338CA', fontSize: '12px', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}
                    >
                      {s.name} jobs <ArrowRight size={11} />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Compact rules — stated as rules, never as a per-state verdict. */}
      <div style={{ padding: '22px 30px 26px', borderTop: '1px solid rgba(0,0,0,0.05)', background: '#F8FAFC' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#1A2E35', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          The RN layer: how the Nurse Licensure Compact actually works
        </h3>
        <ul style={{ margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
          <li style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6 }}>
            The compact covers the <strong>RN license</strong> underneath an APRN credential. It never makes
            an APRN license portable, so a {brand.niche.short} adding a state always files an APRN
            application with that state.
          </li>
          <li style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6 }}>
            A multistate RN license is issued by your <strong>primary state of residence</strong>, and only if
            that state is a compact member. Live in a non-member state and there is no multistate privilege to
            carry anywhere, whatever the destination.
          </li>
          <li style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6 }}>
            Between two member states the compact removes the separate RN endorsement step only. Into a
            non-member state you need an RN license by endorsement as well as that state&apos;s APRN license.
          </li>
          <li style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6 }}>
            <strong>We do not publish a per-state member list here.</strong> Membership moves — jurisdictions
            enact the compact and implement it on separate timelines, and some are only partially implemented,
            so a stale list would be worse than none on a decision this size. Check the current list at the
            source before you plan around it.
          </li>
        </ul>
        <a
          href={NLC_SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="tool-link"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '13px', fontSize: '12.5px', fontWeight: 700, color: TOOL_ACCENT, textDecoration: 'none' }}
        >
          NCSBN — current compact member jurisdictions <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .planner-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
