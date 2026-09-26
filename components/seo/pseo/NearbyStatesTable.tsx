import Link from 'next/link';
import type { ReactNode } from 'react';
import { brand } from '@/config/brand';
import { NLC_VERIFIED_LABEL, nlcTitleShort, type PracticeEnvironment } from '@/lib/pseo/practice-environment';
import {
  NEARBY_STATES_NOTE,
  SALARY_NEARBY_NOT_PUBLISHED,
  buildNearbyStatesSentence,
  buildSalaryNearbyCaption,
} from '@/lib/pseo/listing-narrative';
import { clayLede, clayLink, clayMuted } from './clay';
import ClayTable, { type ClayTableColumn } from './ClayTable';
import { linkHref, type LinkTarget } from './types';

/** One nearby state: its dataset row, live count and the pages it may link. */
export interface NearbyStateRow {
  env: PracticeEnvironment;
  /** Canonical active job count in that state. */
  jobs: number;
  /** Whole-$k gated median (GatedSalary.medianK); null or absent below the gate. */
  medianK?: number | null;
  /** The state's own page for this variant (hub or salary guide), gated. */
  link: LinkTarget | null;
  /** The state's license guide, gated by isLicenseGuideLive. */
  guide?: LinkTarget | null;
}

export type NearbyStatesVariant =
  /** HUB-S9: neighbors with 1 or more jobs, counts plus authority, with the narrative sentence. */
  | 'hub'
  /** SAL-S5: 2 or more neighbors; medians only for gated states. */
  | 'salary'
  /** LIC-L2: every neighbor with a dataset row; authority and compact status. */
  | 'license';

interface NearbyStatesTableProps {
  rows: NearbyStateRow[];
  variant: NearbyStatesVariant;
  /** Visible caption; the salary variant defaults to the SAL-S5 caption. */
  caption?: string;
  className?: string;
}

/**
 * AANP's tier name for each state ("Full Practice", from getAuthorityLabel),
 * attributed in the header. Never the dataset's "Full Practice Authority",
 * which read as a rule beside states whose details describe a transition
 * period; what a state requires is its own details, on its own pages.
 */
const AUTHORITY: ClayTableColumn = { label: 'AANP classification' };
const COMPACT: ClayTableColumn = { label: 'Compact status' };
const GUIDE: ClayTableColumn = { label: 'License guide' };

/**
 * Columns per variant: HUB-S9 counts plus authority; SAL-S5 adds the gated
 * median and the guide link; LIC-L2 is the three-column table of the spec,
 * with the guide linked from the state name.
 */
function columnsFor(variant: NearbyStatesVariant): ClayTableColumn[] {
  const jobs: ClayTableColumn = { label: `Open ${brand.niche.short} roles`, numeric: true };
  if (variant === 'hub') return [{ label: 'State' }, AUTHORITY, COMPACT, jobs];
  if (variant === 'salary') return [{ label: 'State' }, AUTHORITY, COMPACT, jobs, { label: 'Posted median', numeric: true }, GUIDE];
  return [{ label: 'State' }, AUTHORITY, { label: 'Nurse Licensure Compact' }];
}

/** The state name, linked to the variant's own page for that state when it renders. */
function stateCell(row: NearbyStateRow, variant: NearbyStatesVariant): ReactNode {
  const href = variant === 'license' ? linkHref(row.guide) : linkHref(row.link);
  return href ? <Link href={href} style={clayLink}>{row.env.stateName}</Link> : row.env.stateName;
}

function guideCell(row: NearbyStateRow): ReactNode {
  const href = linkHref(row.guide);
  return href ? <Link href={href} style={clayLink}>Read guide</Link> : '';
}

/** A count above zero, else a word (never a padded "0"). */
function jobsCell(jobs: number): string {
  return jobs >= 1 ? jobs.toLocaleString('en-US') : 'None';
}

function cellsFor(row: NearbyStateRow, variant: NearbyStatesVariant): ReactNode[] {
  const state = stateCell(row, variant);
  const authority = row.env.authorityLabel;
  const compact = nlcTitleShort(row.env.nlcStatus);
  if (variant === 'hub') return [state, authority, compact, jobsCell(row.jobs)];
  if (variant === 'salary') {
    const median = typeof row.medianK === 'number' ? `$${row.medianK}K` : SALARY_NEARBY_NOT_PUBLISHED;
    return [state, authority, compact, jobsCell(row.jobs), median, guideCell(row)];
  }
  return [state, authority, compact];
}

/** Rows the variant shows: hubs drop neighbors without jobs; salary needs two. */
function liveRows(rows: readonly NearbyStateRow[], variant: NearbyStatesVariant): NearbyStateRow[] {
  if (variant === 'hub') return rows.filter((row) => row.jobs >= 1);
  if (variant === 'salary') return rows.length >= 2 ? [...rows] : [];
  return [...rows];
}

/**
 * Nearby states compared (HUB-S9, SAL-S5, LIC-L2): one clay table card.
 * Wording says "nearby", never "borders". A state links its own page only
 * through a LinkTarget whose gate passed; medians print only for gated
 * states, otherwise the not-published cell. Renders nothing without rows.
 */
export default function NearbyStatesTable({ rows, variant, caption, className }: NearbyStatesTableProps) {
  const live = liveRows(rows, variant);
  if (live.length === 0) return null;
  const sentence = variant === 'hub'
    ? buildNearbyStatesSentence(live.map((row) => ({ name: row.env.stateName, count: row.jobs })))
    : null;
  const tableCaption = caption ?? (variant === 'salary' ? buildSalaryNearbyCaption(NLC_VERIFIED_LABEL) : 'Nearby states');
  return (
    <div className={className}>
      {sentence && <p style={{ ...clayLede, margin: '0 0 8px', maxWidth: 'none' }}>{sentence}</p>}
      {sentence && <p style={{ ...clayMuted, margin: '0 0 16px' }}>{NEARBY_STATES_NOTE}</p>}
      <ClayTable
        caption={tableCaption}
        columns={columnsFor(variant)}
        rows={live.map((row) => cellsFor(row, variant))}
      />
    </div>
  );
}
