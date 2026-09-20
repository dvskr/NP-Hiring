import { CalendarClock } from 'lucide-react';
import type { ListingFacts } from '@/lib/pseo/listing-facts';
import { buildRecencySentence, buildRoleSetup } from '@/lib/pseo/listing-narrative';
import { cx } from './clay';
import ClayCard from './ClayCard';
import ClayStyles from './ClayStyles';
import EmployerRoster, { employerSentence } from './EmployerRoster';
import RoleSetup from './RoleSetup';
import type { SectionHeadingLevel } from './types';

interface MarketSnapshotProps {
  /** The page's category slug (skips its own axis in the role setup). */
  slug: string;
  /** Category label for the employer sentence, e.g. "Remote". */
  label: string;
  /** Sentence scope, e.g. "nationwide" (LAND-L1) or "in Texas". */
  scope: string;
  facts: ListingFacts;
  /** Classified-row floor for the role setup (3 on listing pages). */
  min?: number;
  headingLevel?: SectionHeadingLevel;
  className?: string;
}

/**
 * LAND-L1 market snapshot: employers, role setup and recency as up to
 * three clay cards in one grid sized to what rendered. Each card is
 * governed by its own builder, so a page with one employer and no dated
 * rows shows one card; a scope with no listings shows nothing at all.
 */
export default function MarketSnapshot({
  slug,
  label,
  scope,
  facts,
  min,
  headingLevel = 3,
  className,
}: MarketSnapshotProps) {
  const hasEmployers = employerSentence({ kind: 'scoped', label, scope }, facts) !== null;
  const hasSetup = buildRoleSetup({ slug, facts, min }).rendered;
  const recency = buildRecencySentence(facts.recency);
  const count = [hasEmployers, hasSetup, recency !== null].filter(Boolean).length;
  if (count === 0) return null;
  const cols = count > 1 ? `pseo-clay-cols-${count}` : null;
  return (
    <>
      <ClayStyles />
      <div className={cx('pseo-clay-grid', cols, className)}>
        <EmployerRoster variant={{ kind: 'scoped', label, scope }} facts={facts} index={0} headingLevel={headingLevel} />
        <RoleSetup slug={slug} facts={facts} min={min} index={1} headingLevel={headingLevel} />
        {recency && (
          <ClayCard
            chip="Recency"
            title="How current the listings are"
            desc={recency}
            icon={CalendarClock}
            index={2}
            headingLevel={headingLevel}
          />
        )}
      </div>
    </>
  );
}
