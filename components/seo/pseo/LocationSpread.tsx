import Link from 'next/link';
import { MapPin } from 'lucide-react';
import {
  buildCategoryAcrossStateSentences,
  buildHubCitiesSentences,
  buildLandingStatesSentence,
  buildScopedCitiesSentence,
  type NamedCount,
} from '@/lib/pseo/listing-narrative';
import { clayLink, clayMeta, clayTile } from './clay';
import ClayCard from './ClayCard';
import ClayStyles from './ClayStyles';
import IconWell from './IconWell';
import type { SectionGlyph } from './section-icon';
import { linkHref, type LinkTarget, type SectionHeadingLevel } from './types';

/**
 * A city or state with its canonical count and the page it would link to.
 * `link` is null when no page exists for the place at all; `link.renders`
 * is the target's render gate (a category-city page at 3 or more jobs, a
 * state hub at 1 or more). Only places whose target renders get a tile;
 * every place still counts in the sentence.
 */
export interface LocationSpreadPlace extends NamedCount {
  link: LinkTarget | null;
}

export type LocationSpreadVariant =
  /** HUB-S2: 2 or more cities; sub-threshold cities named, never linked. */
  | { kind: 'hub'; minLinkJobs?: number }
  /** CS-S2: 1 or more cities (2 on remote and telehealth). */
  | { kind: 'scoped'; slug: string }
  /** LAND-L2: 1 or more states. */
  | { kind: 'landing' }
  /** CC-K4: the city's share of the state pool plus the other cities. */
  | {
      kind: 'category-city';
      city: string;
      stateName: string;
      labelSentence: string;
      cityCount: number;
      stateCount: number | null;
    };

/** The variant's sentences, in order; empty when the floor is not met. */
export function locationSentences(variant: LocationSpreadVariant, places: readonly LocationSpreadPlace[]): string[] {
  const counts: NamedCount[] = places.map(({ name, count }) => ({ name, count }));
  switch (variant.kind) {
    case 'hub': {
      const built = buildHubCitiesSentences(counts, variant.minLinkJobs);
      return built ? [built.spread, built.subThreshold].filter((s): s is string => s !== null) : [];
    }
    case 'scoped':
      return [buildScopedCitiesSentence({ slug: variant.slug, cities: counts })].filter((s): s is string => s !== null);
    case 'landing':
      return [buildLandingStatesSentence(counts)].filter((s): s is string => s !== null);
    case 'category-city': {
      const { share, others } = buildCategoryAcrossStateSentences({
        city: variant.city,
        stateName: variant.stateName,
        labelSentence: variant.labelSentence,
        cityCount: variant.cityCount,
        stateCount: variant.stateCount,
        otherCities: counts,
      });
      return [share, others].filter((s): s is string => s !== null);
    }
  }
}

interface LocationSpreadProps {
  variant: LocationSpreadVariant;
  places: LocationSpreadPlace[];
  /** HUB-S2 directory link ("See every {State} city with open roles"), shown only when it renders. */
  directory?: LinkTarget & { label: string };
  title?: string;
  chip?: string;
  icon?: SectionGlyph;
  /** Icon on every tile (for example NAV_ICONS.location). */
  tileIcon?: SectionGlyph;
  index?: number;
  headingLevel?: SectionHeadingLevel;
  className?: string;
}

/**
 * Where the listings are: the spread sentence plus clay tiles for the
 * places whose own page renders, the count in the accent. Places below the
 * target's gate stay in the sentence as plain text and never become a
 * tile. Renders nothing below the variant's floor.
 */
export default function LocationSpread({
  variant,
  places,
  directory,
  title = 'Where the listings are',
  chip = 'Locations',
  icon = MapPin,
  tileIcon,
  index = 1,
  headingLevel = 3,
  className,
}: LocationSpreadProps) {
  const sentences = locationSentences(variant, places);
  if (sentences.length === 0) return null;
  const tiles = places.flatMap((place) => {
    const href = linkHref(place.link);
    return href ? [{ ...place, href }] : [];
  });
  const directoryHref = linkHref(directory);
  return (
    <ClayCard
      chip={chip}
      title={title}
      desc={sentences.join(' ')}
      icon={icon}
      index={index}
      headingLevel={headingLevel}
      className={className}
    >
      {tiles.length > 0 && (
        <>
          <ClayStyles />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '16px' }}>
            {tiles.map((place) => (
              <Link key={place.href} href={place.href} className="pseo-clay-tile pseo-clay-lift" style={clayTile}>
                {tileIcon && <IconWell icon={tileIcon} size="sm" />}
                <span>{place.name}</span>
                {place.count > 0 && <span style={clayMeta}>{place.count.toLocaleString('en-US')}</span>}
              </Link>
            ))}
          </div>
        </>
      )}
      {directoryHref && directory && (
        <p style={{ margin: '16px 0 0', fontSize: '13px' }}>
          <Link href={directoryHref} style={clayLink}>{directory.label}</Link>
        </p>
      )}
    </ClayCard>
  );
}
