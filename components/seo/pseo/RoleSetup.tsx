import { Layers } from 'lucide-react';
import type { ListingFacts } from '@/lib/pseo/listing-facts';
import { buildRoleSetup } from '@/lib/pseo/listing-narrative';
import { CLAY_INK, CLAY_MUTED, clayDesc, clayStat } from './clay';
import ClayCard from './ClayCard';
import type { SectionGlyph } from './section-icon';
import type { SectionHeadingLevel } from './types';

export type RoleSetupFacts = Pick<ListingFacts, 'workMode' | 'jobTypes' | 'settings'>;

interface RoleSetupProps {
  /** The page's own category slug; its own axis is skipped by the builder. */
  slug: string;
  facts: RoleSetupFacts;
  /** Classified-row floor per dimension (3 on listing pages, 5 on hubs). */
  min?: number;
  title?: string;
  chip?: string;
  icon?: SectionGlyph;
  index?: number;
  headingLevel?: SectionHeadingLevel;
  className?: string;
}

interface StatItem { key: string; value: number; label: string }

/** One stat per rendered dimension, zero buckets omitted (never "0 hybrid"). */
function statItems(facts: RoleSetupFacts, rendered: { workMode: boolean; jobType: boolean; setting: boolean }): StatItem[] {
  const items: StatItem[] = [];
  if (rendered.workMode) {
    const { remote, hybrid, onsite } = facts.workMode;
    if (remote > 0) items.push({ key: 'mode-remote', value: remote, label: 'remote' });
    if (hybrid > 0) items.push({ key: 'mode-hybrid', value: hybrid, label: 'hybrid' });
    if (onsite > 0) items.push({ key: 'mode-onsite', value: onsite, label: 'on site' });
  }
  const jobType = facts.jobTypes.top[0];
  if (rendered.jobType && jobType) items.push({ key: `type-${jobType.label}`, value: jobType.count, label: jobType.label });
  const setting = facts.settings.top[0];
  if (rendered.setting && setting) items.push({ key: `setting-${setting.label}`, value: setting.count, label: setting.label });
  return items;
}

/**
 * How these roles are set up (CS-S3, LAND-L1, CC-K2): a row of small clay
 * stat tiles, one per bucket the builder kept, then the builder's
 * sentences. Every figure is a count from the facts; the dimension the
 * page is about is never restated. Renders nothing when no dimension
 * clears its floor.
 */
export default function RoleSetup({
  slug,
  facts,
  min,
  title = 'How these roles are set up',
  chip = 'Role setup',
  icon = Layers,
  index = 2,
  headingLevel = 3,
  className,
}: RoleSetupProps) {
  const setup = buildRoleSetup({ slug, facts, min });
  if (!setup.rendered) return null;
  const stats = statItems(facts, {
    workMode: setup.workMode !== null,
    jobType: setup.jobType !== null,
    setting: setup.setting !== null,
  });
  const sentences = [setup.workMode, setup.jobType, setup.setting].filter((s): s is string => s !== null);
  return (
    <ClayCard chip={chip} title={title} icon={icon} index={index} headingLevel={headingLevel} className={className}>
      {stats.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', margin: '4px 0 16px' }}>
          {stats.map((stat) => (
            <div key={stat.key} className="pseo-clay-stat" style={clayStat}>
              <span style={{ display: 'block', fontSize: '22px', fontWeight: 800, color: CLAY_INK, lineHeight: 1.1 }}>
                {stat.value.toLocaleString('en-US')}
              </span>
              <span
                style={{
                  display: 'block',
                  marginTop: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: CLAY_MUTED,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      )}
      {sentences.map((sentence, i) => (
        <p key={sentence} style={{ ...clayDesc, margin: i === sentences.length - 1 ? 0 : '0 0 8px' }}>{sentence}</p>
      ))}
    </ClayCard>
  );
}
