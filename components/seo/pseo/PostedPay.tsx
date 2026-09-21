import Link from 'next/link';
import { Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { STAT_SOURCES } from '@/lib/stats-sources';
import type { ListingFacts } from '@/lib/pseo/listing-facts';
import { buildHubPayParagraph, buildPostedPaySentence, formatK } from '@/lib/pseo/listing-narrative';
import { CLAY_ACCENT, CLAY_TRACK, clayLink, clayList, clayMeta, clayRow } from './clay';
import ClayCard from './ClayCard';
import type { SectionGlyph } from './section-icon';
import { linkHref, type LinkTarget, type SectionHeadingLevel } from './types';

export type PayFacts = Pick<ListingFacts, 'benchmark' | 'salaryDisclosedCount' | 'total'>;

export type PostedPayVariant =
  /** CS-S4 and LAND-L4: benchmark, else a cited BLS sentence, else nothing (never the NP median on anesthesia or midwifery). */
  | { kind: 'category'; slug: string }
  /** HUB-S7 and METRO-M2: benchmark, else the counted below-gate sentence with the BLS cite. */
  | { kind: 'location'; scopeName: string; scopeNoun: 'state' | 'metro' };

/** The variant's paragraph, or null when there is no benchmark and no disclosed pay. */
export function postedPaySentence(variant: PostedPayVariant, facts: PayFacts): string | null {
  if (variant.kind === 'category') return buildPostedPaySentence({ slug: variant.slug, facts });
  if (!facts.benchmark && facts.salaryDisclosedCount < 1) return null;
  return buildHubPayParagraph({ scopeName: variant.scopeName, scopeNoun: variant.scopeNoun, facts });
}

const BLS = STAT_SOURCES.averageSalary;

/**
 * The paragraph with its BLS cite (the narrative prints the phrase from
 * lib/stats-sources.ts verbatim) linked to the cited source page. Text
 * without the phrase is returned as is, so the sentence never changes.
 */
function withSourceLink(text: string): ReactNode {
  const at = text.indexOf(BLS.source);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <a href={BLS.sourceUrl} target="_blank" rel="noopener noreferrer" style={clayLink}>{BLS.source}</a>
      {text.slice(at + BLS.source.length)}
    </>
  );
}

interface PostedPayProps {
  variant: PostedPayVariant;
  facts: PayFacts;
  /** "/salary-guide/{state}" and its label, shown only when that guide renders. */
  salaryGuide?: LinkTarget & { label: string };
  title?: string;
  chip?: string;
  icon?: SectionGlyph;
  index?: number;
  headingLevel?: SectionHeadingLevel;
  className?: string;
}

interface PayBar { label: string; dollars: number }

/**
 * Posted pay: the gated median paragraph with p25, median and p75 drawn as
 * flat accent bars on the oxblood track (widths relative to p75; never a
 * gradient), or below the gate the disclosed-count sentence carrying the
 * BLS cite from lib/stats-sources.ts inline, linked to its source. No
 * benchmark and no disclosed pay renders nothing: there is no figure to show.
 */
export default function PostedPay({
  variant,
  facts,
  salaryGuide,
  title = 'Posted pay',
  chip = 'Pay',
  icon = Wallet,
  index = 3,
  headingLevel = 3,
  className,
}: PostedPayProps) {
  const sentence = postedPaySentence(variant, facts);
  if (!sentence) return null;
  const row = facts.benchmark;
  const bars: PayBar[] = row
    ? [
        { label: '25th percentile', dollars: row.p25 },
        { label: 'Median', dollars: row.median },
        { label: '75th percentile', dollars: row.p75 },
      ]
    : [];
  const scale = row && row.p75 > 0 ? row.p75 : null;
  const guideHref = linkHref(salaryGuide);
  return (
    <ClayCard
      chip={chip}
      title={title}
      desc={row ? sentence : withSourceLink(sentence)}
      icon={icon}
      index={index}
      headingLevel={headingLevel}
      className={className}
    >
      {scale !== null && (
        <ul className="pseo-clay-list" style={clayList}>
          {bars.map((bar, i) => (
            <li key={bar.label} style={{ ...clayRow(i === bars.length - 1), fontSize: '13px' }}>
              <span style={{ minWidth: '104px' }}>{bar.label}</span>
              <span
                className="pseo-clay-bar"
                aria-hidden="true"
                style={{ flex: 1, height: '8px', borderRadius: '999px', background: CLAY_TRACK, overflow: 'hidden' }}
              >
                <span
                  className="pseo-clay-bar-fill"
                  style={{
                    display: 'block',
                    height: '100%',
                    borderRadius: '999px',
                    background: CLAY_ACCENT,
                    width: `${Math.round(Math.min(100, (bar.dollars / scale) * 100))}%`,
                  }}
                />
              </span>
              <span style={{ ...clayMeta, minWidth: '48px', textAlign: 'right' }}>{formatK(bar.dollars)}</span>
            </li>
          ))}
        </ul>
      )}
      {guideHref && salaryGuide && (
        <p style={{ margin: '16px 0 0', fontSize: '13px' }}>
          <Link href={guideHref} style={clayLink}>{salaryGuide.label}</Link>
        </p>
      )}
    </ClayCard>
  );
}
