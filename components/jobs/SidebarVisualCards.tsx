import React from 'react';
import { joinWithAnd } from '@/lib/display-text';

/* ──────────────────────────────────────────────
 *  SidebarVisualCards
 *  Application Tips: advice drawn from THIS job's facts.
 *
 *  Indexing audit CQ-11 (plan fixSoon 14): the sidebar used to carry two
 *  blocks identical on every job page, the "Career Pulse" national stats
 *  card and a tips card padded with generic defaults. Identical filler
 *  across hundreds of aggregated pages reads as automation, not added
 *  value, so the stats card is gone and every tip below is conditioned on a
 *  fact of the posting. A job with none of those facts gets no card.
 * ────────────────────────────────────────────── */

/* ── Clay card wrapper ── */
const clayShadow = '8px 8px 20px rgba(0,0,0,0.07), -4px -4px 12px rgba(255,255,255,0.9), inset 2px 2px 4px rgba(255,255,255,0.6), inset -1px -1px 2px rgba(0,0,0,0.02)';
const clayPebbleShadow = '4px 4px 10px rgba(0,0,0,0.06), -2px -2px 6px rgba(255,255,255,0.8), inset 2px 2px 4px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.03)';

/** Tips shown at most. */
const MAX_TIPS = 3;

/* ── Tip Pill ── */
function TipPill({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      padding: '10px 14px', borderRadius: '14px',
      backgroundColor: '#F7FBF8',
      border: '1px solid rgba(255,255,255,0.5)',
      boxShadow: clayPebbleShadow,
    }}>
      <span aria-hidden="true" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 8, flexShrink: 0,
        backgroundColor: '#FDF2F8',
        boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.04), 2px 2px 4px rgba(0,0,0,0.05)',
        border: '1px solid rgba(255,255,255,0.6)',
        fontSize: '12px',
      }}>{icon}</span>
      <p style={{ fontSize: '12.5px', lineHeight: 1.55, color: '#374151', margin: 0, fontWeight: 500 }}>{text}</p>
    </div>
  );
}

export interface ApplicationTipsInput {
  /** The verified work mode label (resolveWorkModeLabel), never the raw flag. */
  workMode?: string | null;
  isTelehealth?: boolean;
  jobType?: string | null;
  /** Effective new-grad openness (lib/experience-label). */
  newGradFriendly?: boolean;
  /** The posting's stated minimum years of experience. */
  minYearsExperience?: number | null;
  /** States a remote posting restricts applicants to. */
  remoteStates?: readonly string[];
}

export interface ApplicationTip {
  icon: string;
  text: string;
}

function lowerType(jobType: string | null | undefined): string {
  return (jobType ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Tips for this posting, each tied to one of its facts. No generic
 * defaults: with no applicable fact the list is empty and the card is
 * omitted.
 */
export function getApplicationTips(input: ApplicationTipsInput): ApplicationTip[] {
  const tips: ApplicationTip[] = [];
  const type = lowerType(input.jobType);
  const states = input.remoteStates ?? [];

  if (input.workMode === 'Remote' && states.length > 0) {
    tips.push({ icon: '✅', text: `This remote role is open to applicants in ${joinWithAnd([...states])}. Confirm your license there before you apply.` });
  }
  if (input.workMode === 'Remote' || input.isTelehealth) {
    tips.push({ icon: '🖥️', text: 'Describe your telehealth experience: the platforms you have used, your visit volume and any virtual prescribing workflow.' });
  }
  if (input.workMode === 'Hybrid') {
    tips.push({ icon: '🗓️', text: 'Ask how many days a week are on site and which location you would report to.' });
  }
  if (type === 'contract' || type === 'contractor' || type.startsWith('locum')) {
    tips.push({ icon: '📋', text: 'State your malpractice coverage and how quickly you can credential with new payers.' });
  }
  if (type === 'perdiem' || type === 'prn') {
    tips.push({ icon: '⏱️', text: 'List the shifts and days you can cover; per diem roles are filled around availability.' });
  }
  if (type === 'parttime') {
    tips.push({ icon: '⏱️', text: 'Say which days and hours you can commit to each week.' });
  }
  if (type === 'fulltime') {
    tips.push({ icon: '🏥', text: 'Ask about the collaboration arrangement, patient panel size and caseload expectations in your interview.' });
  }
  if (typeof input.minYearsExperience === 'number' && input.minYearsExperience > 0) {
    const years = input.minYearsExperience;
    tips.push({ icon: '📄', text: `The posting asks for ${years}+ year${years === 1 ? '' : 's'} of experience; lead your resume with your most relevant clinical roles.` });
  } else if (input.newGradFriendly) {
    tips.push({ icon: '🎓', text: 'New graduates are welcome here; lead with your clinical rotation hours and the settings you trained in.' });
  }

  return tips.slice(0, MAX_TIPS);
}

/* ──────────────────────────────────────────────
 *  Application Tips Card
 * ────────────────────────────────────────────── */
export function ApplicationTipsCard(props: ApplicationTipsInput) {
  const tips = getApplicationTips(props);
  if (tips.length === 0) return null;

  return (
    <div style={{
      backgroundColor: '#F7FBF8',
      borderRadius: '22px',
      border: '1px solid rgba(255,255,255,0.6)',
      boxShadow: clayShadow,
      padding: '0',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '18px 20px 20px' }}>
        <h3 style={{
          fontSize: '14px',
          fontWeight: 700,
          fontFamily: 'var(--font-lora), Georgia, serif',
          color: '#1F2937',
          margin: '0 0 4px',
        }}>
          Tips for This Role
        </h3>
        <p style={{ fontSize: '12px', color: '#6B7280', margin: '0 0 14px', lineHeight: 1.4 }}>
          Based on the details of this posting
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tips.map((tip) => (
            <TipPill key={tip.text} icon={tip.icon} text={tip.text} />
          ))}
        </div>
      </div>
    </div>
  );
}
