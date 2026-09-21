import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { formatCount } from '@/lib/display-text';
import { TOP_EMPLOYERS_LIMIT, type ListingFacts } from '@/lib/pseo/listing-facts';
import {
  buildCategoryCityEmployersSentence,
  buildCityEmployersSentence,
  buildHubEmployersSentence,
  buildScopedEmployersSentence,
  buildStatewideEmployersSentence,
} from '@/lib/pseo/listing-narrative';
import { clayLink, clayList, clayMeta, clayRow } from './clay';
import ClayCard from './ClayCard';
import type { SectionGlyph } from './section-icon';
import type { SectionHeadingLevel } from './types';

export type EmployerFacts = Pick<ListingFacts, 'total' | 'distinctEmployers' | 'topEmployers'>;

/** Which page's employer sentence to build; each carries its own floor. */
export type EmployerRosterVariant =
  /** HUB-S1: 2 or more employers. */
  | { kind: 'hub'; stateName: string }
  /** CITY-C1: 2 or more employers. */
  | { kind: 'city'; city: string }
  /** CS-S1 (scope "in Texas") and LAND-L1 (scope "nationwide"): 1 or more. */
  | { kind: 'scoped'; label: string; scope: string }
  /** CC-K1: 2 or more employers within the category pool. */
  | { kind: 'category-city'; labelSentence: string; city: string }
  /** DIR-L2 statewide line: 2 or more employers. */
  | { kind: 'statewide'; stateName: string };

/** The sentence for a variant, or null when its floor is not met. */
export function employerSentence(variant: EmployerRosterVariant, facts: EmployerFacts): string | null {
  switch (variant.kind) {
    case 'hub':
      return buildHubEmployersSentence({ stateName: variant.stateName, facts });
    case 'city':
      return buildCityEmployersSentence({ city: variant.city, facts });
    case 'scoped':
      return buildScopedEmployersSentence({ label: variant.label, scope: variant.scope, facts });
    case 'category-city':
      return buildCategoryCityEmployersSentence({ labelSentence: variant.labelSentence, city: variant.city, facts });
    case 'statewide':
      return buildStatewideEmployersSentence({ stateName: variant.stateName, facts });
  }
}

interface EmployerRosterProps {
  variant: EmployerRosterVariant;
  facts: EmployerFacts;
  title?: string;
  chip?: string;
  icon?: SectionGlyph;
  index?: number;
  headingLevel?: SectionHeadingLevel;
  /** Rows listed under the sentence (the facts carry at most TOP_EMPLOYERS_LIMIT). */
  limit?: number;
  className?: string;
}

/**
 * Who is hiring: one clay card with the employer sentence and a divided
 * list of employers with counts. A row links its company profile only when
 * the facts carry a companyPath (the company has active jobs); every other
 * name is plain text. Renders nothing below the variant's floor.
 */
export default function EmployerRoster({
  variant,
  facts,
  title = 'Who is hiring',
  chip = 'Employers',
  icon = Building2,
  index = 0,
  headingLevel = 3,
  limit = TOP_EMPLOYERS_LIMIT,
  className,
}: EmployerRosterProps) {
  const sentence = employerSentence(variant, facts);
  if (!sentence) return null;
  const rows = facts.topEmployers.slice(0, limit);
  return (
    <ClayCard chip={chip} title={title} desc={sentence} icon={icon} index={index} headingLevel={headingLevel} className={className}>
      {rows.length > 0 && (
        <ul className="pseo-clay-list" style={clayList}>
          {rows.map((employer, i) => (
            <li key={employer.name} style={clayRow(i === rows.length - 1)}>
              {employer.companyPath ? (
                <Link href={employer.companyPath} style={clayLink}>{employer.name}</Link>
              ) : (
                <span>{employer.name}</span>
              )}
              <span style={clayMeta}>{formatCount(employer.count, 'listing')}</span>
            </li>
          ))}
        </ul>
      )}
    </ClayCard>
  );
}
