/**
 * components/blog/LicenseGuideMarketSnapshot.tsx
 *
 * LIC-L3: the live market band on a state license guide (PLAN C.4 item 4,
 * thin-spec-4 3C). Presentational and synchronous: app/blog/[slug]/page.tsx
 * loads the facts (getListingFacts on the state bucket), the gated salary
 * (getGatedLocationSalary, the salary guide's own gate) and the salary
 * guide's index verdict (shouldIndexSalaryGuideState), so the markup can be
 * rendered and asserted without a database.
 *
 * Rules:
 *   - the snapshot renders only when shouldRenderMarketSnapshot(total)
 *     passes; otherwise one alert sentence with an absolute UTC date;
 *   - /jobs/state/{slug} is linked only inside the snapshot (the hub renders
 *     at the same floor) and /salary-guide/{slug} only when that page
 *     indexes;
 *   - a city is linked only when its page renders (MIN_JOBS_FOR_LINK_LIST_ROW
 *     and a round-tripping slug); an employer only when its profile indexes
 *     (the in-state count is a lower bound of its active jobs);
 *   - every sentence is omitted when its facts are missing, and a median
 *     prints only from a gate-passed GatedSalary.
 *
 * Styling is clay, matching the host blog pages (owner decision 2026-09-20:
 * new blocks on a clay page are clay): white rounded cards with the soft
 * neumorphic shadow, pastel chips and stat pills, the berry primary button.
 * Inline style objects plus one static <style> string for hover and focus
 * states; nothing from the sticker kit.
 */
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { brand } from '@/config/brand';
import { buildCitySlug, cityLinkResolves } from '@/app/jobs/locations/[state]/directory';
import { BENCHMARK_MIN_EMPLOYERS, BENCHMARK_MIN_POSTINGS } from '@/components/tools/benchmark-model';
import { nlcTableLabel } from '@/lib/blog-license-guides';
import { pluralize } from '@/lib/display-text';
import type { CityCount, EmployerFact, ListingFacts } from '@/lib/pseo/listing-facts';
import { NLC_VERIFIED_LABEL, type PracticeEnvironment } from '@/lib/pseo/practice-environment';
import {
  HUB_REFRESH_NOTE,
  buildHubRecencySentence,
  buildHubWorkModeSentence,
  formatDollars,
  formatUtcDate,
} from '@/lib/pseo/listing-narrative';
import {
  MIN_JOBS_FOR_LINK_LIST_ROW,
  shouldIndexCompanyProfile,
  shouldRenderMarketSnapshot,
} from '@/lib/pseo/render-gate';
import type { GatedSalary } from '@/lib/salary-analytics';

const NP = brand.niche.short;

/** Cities and employers named in the snapshot (thin-spec-4 3C: up to 5 each). */
export const SNAPSHOT_LIST_LIMIT = 5;

export const SNAPSHOT_HEADING_ID = 'license-guide-market-snapshot';

// ─── Clay tokens (copied from app/blog/page.tsx and the pSEO templates) ──────

const CLAY_CARD: CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

/** Adjacent bands never share a ground: peach for the table, mint for the snapshot. */
const NEARBY_STAGE_STYLE: CSSProperties = { background: 'linear-gradient(180deg, #FFF8F0 0%, #FFF3E8 50%, #FFF8F0 100%)' };
const SNAPSHOT_STAGE_STYLE: CSSProperties = { background: 'linear-gradient(180deg, #FDF2F8 0%, #E6FFFA 50%, #FDF2F8 100%)' };

const SECTION_STYLE: CSSProperties = { maxWidth: '1100px', margin: '0 auto', padding: '56px 20px' };
const EYEBROW_STYLE: CSSProperties = {
  fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase',
  letterSpacing: '0.15em', textAlign: 'center', margin: '0 0 8px',
};
const HEADING_STYLE: CSSProperties = {
  fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', margin: '0 0 8px',
};
const LEDE_STYLE: CSSProperties = {
  fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '600px', margin: '0 auto 36px', lineHeight: 1.6,
};
const COPY_STYLE: CSSProperties = { fontSize: '14.5px', lineHeight: 1.6, color: '#5A4A42' };
const PARAGRAPH_STYLE: CSSProperties = { margin: '0 0 10px' };

const CARD_STYLE: CSSProperties = { ...CLAY_CARD, maxWidth: '820px', margin: '0 auto', padding: '28px 28px 30px' };
const CHIP_STYLE: CSSProperties = {
  display: 'inline-block', padding: '5px 12px', borderRadius: '999px', background: '#FDF2F8', color: '#BE185D',
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.03em', marginBottom: '14px',
};
const CARD_TITLE_STYLE: CSSProperties = { fontSize: '19px', fontWeight: 700, color: '#1A2E35', margin: '0 0 12px' };

const STAT_ROW_STYLE: CSSProperties = { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px', marginBottom: '28px' };
const STAT_PILL_STYLE: CSSProperties = {
  display: 'inline-flex', alignItems: 'baseline', gap: '8px', padding: '10px 20px 10px 16px', borderRadius: '40px',
  boxShadow: '3px 3px 8px rgba(0,0,0,0.04), inset 1px 1px 2px rgba(255,255,255,0.5)',
};
const STAT_VALUE_STYLE: CSSProperties = { fontSize: '18px', fontWeight: 800, lineHeight: 1 };
const STAT_LABEL_STYLE: CSSProperties = { fontSize: '12px', fontWeight: 500, opacity: 0.8 };
const STAT_FILLS = [
  { background: '#D4F5E9', color: '#065F46' },
  { background: '#E0E7FF', color: '#3730A3' },
] as const;

const LINK_ROW_STYLE: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', marginTop: '20px' };
const PRIMARY_BUTTON_STYLE: CSSProperties = {
  display: 'inline-block', background: '#BE185D', color: '#FFFFFF', borderRadius: '12px', padding: '12px 28px',
  fontSize: '14px', fontWeight: 600, textDecoration: 'none',
};
const TEXT_LINK_STYLE: CSSProperties = { color: '#BE185D', fontWeight: 600, fontSize: '14px', textDecoration: 'none' };

const TABLE_WRAP_STYLE: CSSProperties = { ...CLAY_CARD, overflow: 'hidden', maxWidth: '820px', margin: '0 auto' };
const TABLE_STYLE: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '14px', color: '#5A4A42' };
const CAPTION_STYLE: CSSProperties = {
  captionSide: 'bottom', padding: '12px 20px 16px', fontSize: '12px', color: '#7A6A62', textAlign: 'left', lineHeight: 1.5,
};
const TH_STYLE: CSSProperties = {
  textAlign: 'left', padding: '14px 20px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: '#7A6A62', background: '#F9F7F1',
};
const ROW_HEADER_STYLE: CSSProperties = {
  textAlign: 'left', padding: '14px 20px', fontWeight: 700, color: '#1A2E35', verticalAlign: 'top',
  boxShadow: 'inset 0 1px 0 #EAE6DF',
};
const TD_STYLE: CSSProperties = { padding: '14px 20px', verticalAlign: 'top', boxShadow: 'inset 0 1px 0 #EAE6DF' };

/** Hover, focus and small-screen rules for the two bands; rendered once by LicenseGuideBands. */
const LICENSE_BANDS_CSS = `
.lg-btn { transition: transform 0.2s ease, box-shadow 0.2s ease; }
.lg-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(190,24,93,0.28); }
.lg-btn:focus-visible, .lg-link:focus-visible { outline: 3px solid #BE185D; outline-offset: 3px; }
.lg-link:hover { text-decoration: underline; }
.lg-row:hover td, .lg-row:hover th { background: #FDFBF7; }
@media (max-width: 640px) {
  .lg-table-wrap { overflow-x: auto; }
  .lg-table th, .lg-table td { padding: 12px 14px !important; }
}
@media (prefers-reduced-motion: reduce) {
  .lg-btn { transition: none; }
  .lg-btn:hover { transform: none; }
}
`;

export interface LicenseGuideMarketSnapshotProps {
  stateName: string;
  stateCode: string;
  /** URL slug shared by /jobs/state and /salary-guide. */
  stateSlug: string;
  facts: ListingFacts;
  /** The salary guide's own gated figure for the state. */
  salary: GatedSalary;
  /** shouldIndexSalaryGuideState() for the state, computed by the page. */
  salaryGuideIndexable: boolean;
}

/** ", " and " and " between nodes, mirroring joinWithAnd for strings. */
function joinNodes(nodes: readonly ReactNode[]): ReactNode[] {
  return nodes.flatMap((node, i) => {
    if (i === 0) return [node];
    return [i === nodes.length - 1 ? ' and ' : ', ', node];
  });
}

/** "{City} (n)", linked only when the city page renders for that count. */
function cityNode(city: CityCount): ReactNode {
  const label = `${city.name} (${city.count})`;
  const linkable =
    city.stateCode !== null &&
    city.count >= MIN_JOBS_FOR_LINK_LIST_ROW &&
    cityLinkResolves(city.name, city.stateCode);
  if (!linkable || city.stateCode === null) return <span key={label}>{label}</span>;
  return (
    <Link key={label} href={`/jobs/city/${buildCitySlug(city.name, city.stateCode)}`} className="lg-link" style={TEXT_LINK_STYLE}>
      {label}
    </Link>
  );
}

/** "{Employer} (n)", linked only when the company profile indexes. */
function employerNode(employer: EmployerFact): ReactNode {
  const label = `${employer.name} (${employer.count})`;
  if (employer.companyPath && shouldIndexCompanyProfile(employer.count)) {
    return <Link key={label} href={employer.companyPath} className="lg-link" style={TEXT_LINK_STYLE}>{label}</Link>;
  }
  return <span key={label}>{label}</span>;
}

/** Median sentence from the gated figure, or the publishing-gate sentence. */
export function buildSnapshotPaySentence(stateName: string, salary: GatedSalary): string {
  if (salary.gatePassed && salary.median !== null) {
    return `Median posted pay in ${stateName}: ${formatDollars(salary.median)} across ${salary.postings} postings with disclosed pay from ${salary.employers} employers.`;
  }
  return `${brand.name} does not publish a ${stateName} median yet because fewer than ${BENCHMARK_MIN_POSTINGS} postings from ${BENCHMARK_MIN_EMPLOYERS} employers disclose pay.`;
}

function Paragraph({ children }: { children: ReactNode }) {
  return <p style={PARAGRAPH_STYLE}>{children}</p>;
}

/** Eyebrow, heading and lede shared by both bands. */
function BandHead({ eyebrow, id, title, lede }: { eyebrow: string; id: string; title: string; lede: string }) {
  return (
    <>
      <p style={EYEBROW_STYLE}>{eyebrow}</p>
      <h2 id={id} className="font-lora" style={HEADING_STYLE}>{title}</h2>
      <p style={LEDE_STYLE}>{lede}</p>
    </>
  );
}

function StatPill({ value, label, index }: { value: string; label: string; index: number }) {
  const fill = STAT_FILLS[index % STAT_FILLS.length];
  return (
    <div style={{ ...STAT_PILL_STYLE, ...fill }}>
      <span style={STAT_VALUE_STYLE}>{value}</span><span style={STAT_LABEL_STYLE}>{label}</span>
    </div>
  );
}

function NoOpenRoles({ stateName, computedAt }: { stateName: string; computedAt: Date }) {
  return (
    <p style={LEDE_STYLE}>
      As of {formatUtcDate(computedAt)}, {brand.name} has no open {NP} roles in {stateName}.{' '}
      <Link href="/job-alerts" className="lg-link" style={TEXT_LINK_STYLE}>Set up a job alert</Link> to hear when one is posted.
    </p>
  );
}

function SnapshotBody({ stateName, stateSlug, facts, salary, salaryGuideIndexable }: LicenseGuideMarketSnapshotProps) {
  const cities = facts.cities.slice(0, SNAPSHOT_LIST_LIMIT).map(cityNode);
  const employers = facts.topEmployers.slice(0, SNAPSHOT_LIST_LIMIT).map(employerNode);
  const workMode = buildHubWorkModeSentence(facts.workMode);
  const recency = buildHubRecencySentence(facts.recency);
  return (
    <>
      <div style={STAT_ROW_STYLE}>
        <StatPill value={facts.total.toLocaleString('en-US')} label={pluralize(facts.total, 'open role')} index={0} />
        {facts.distinctEmployers > 0 && (
          <StatPill
            value={facts.distinctEmployers.toLocaleString('en-US')}
            label={pluralize(facts.distinctEmployers, 'employer')}
            index={1}
          />
        )}
      </div>
      <div style={CARD_STYLE}>
        <span style={CHIP_STYLE}>As of {formatUtcDate(facts.computedAt)}</span>
        <h3 className="font-lora" style={CARD_TITLE_STYLE}>What the {stateName} postings say</h3>
        <div style={COPY_STYLE}>
          {cities.length > 0 && (
            <Paragraph>
              {cities.length === 1 ? 'The city named in these postings is ' : 'The cities named most often are '}
              {joinNodes(cities)}.
            </Paragraph>
          )}
          {employers.length > 0 && (
            <Paragraph>Employers with the most {stateName} postings: {joinNodes(employers)}.</Paragraph>
          )}
          {workMode && <Paragraph>{workMode}</Paragraph>}
          {recency && <Paragraph>{recency}</Paragraph>}
          <Paragraph>{buildSnapshotPaySentence(stateName, salary)}</Paragraph>
        </div>
        <p style={LINK_ROW_STYLE}>
          <Link href={`/jobs/state/${stateSlug}`} className="lg-btn" style={PRIMARY_BUTTON_STYLE}>Browse {stateName} {NP} jobs</Link>
          {salaryGuideIndexable && (
            <Link href={`/salary-guide/${stateSlug}`} className="lg-link" style={TEXT_LINK_STYLE}>{stateName} salary guide</Link>
          )}
        </p>
      </div>
    </>
  );
}

/** The whole band: heading plus either the snapshot or the alert sentence. */
export default function LicenseGuideMarketSnapshot(props: LicenseGuideMarketSnapshotProps) {
  const { stateName, facts } = props;
  return (
    <section aria-labelledby={SNAPSHOT_HEADING_ID} style={SNAPSHOT_STAGE_STYLE}>
      <div style={SECTION_STYLE}>
        <BandHead
          eyebrow="Live market snapshot"
          id={SNAPSHOT_HEADING_ID}
          title={`${stateName} ${NP} job market snapshot`}
          lede={`Active ${brand.name} postings located in ${stateName}. ${HUB_REFRESH_NOTE}`}
        />
        {shouldRenderMarketSnapshot(facts.total) ? (
          <SnapshotBody {...props} />
        ) : (
          <NoOpenRoles stateName={stateName} computedAt={facts.computedAt} />
        )}
      </div>
    </section>
  );
}

// ─── LIC-L2: nearby states ──────────────────────────────────────────────────

export const NEARBY_HEADING_ID = 'license-guide-nearby-states';

export interface LicenseGuideNearbyRow {
  env: PracticeEnvironment;
  /** isLicenseGuideLive() for the state: the sibling guide is linked only when published (C.0). */
  guideLive: boolean;
}

export interface LicenseGuideNearbyStatesProps {
  env: PracticeEnvironment;
  nearby: readonly LicenseGuideNearbyRow[];
}

const NEARBY_COLUMNS = ['State', 'Practice authority', 'Nurse Licensure Compact'] as const;

/**
 * The nearby-states table (thin-spec-4 3C L2): AANP classification and
 * compact status per nearby jurisdiction, from lib/pseo/neighboring-states.ts
 * (proximity, so the copy says "nearby", never "bordering"). Rows are the
 * dataset; the only live input is which sibling guides are published.
 */
export function LicenseGuideNearbyStates({ env, nearby }: LicenseGuideNearbyStatesProps) {
  return (
    <section aria-labelledby={NEARBY_HEADING_ID} style={NEARBY_STAGE_STYLE}>
      <div style={SECTION_STYLE}>
        <BandHead
          eyebrow="Nearby states"
          id={NEARBY_HEADING_ID}
          title={`Practice authority and compact status near ${env.stateName}`}
          lede="If you are weighing a move or a telehealth caseload across state lines, these are the rules you would plan around in each nearby state."
        />
        <div className="lg-table-wrap" style={TABLE_WRAP_STYLE}>
          <table className="lg-table" style={TABLE_STYLE}>
            <caption style={CAPTION_STYLE}>
              Nearby states of {env.stateName}: AANP practice classification and Nurse Licensure Compact status, verified against the NCSBN roster on {NLC_VERIFIED_LABEL}
            </caption>
            <thead>
              <tr>
                {NEARBY_COLUMNS.map((column) => (
                  <th key={column} scope="col" style={TH_STYLE}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nearby.map(({ env: near, guideLive }) => (
                <tr key={near.stateName} className="lg-row">
                  <th scope="row" style={ROW_HEADER_STYLE}>
                    {guideLive
                      ? <Link href={`/blog/${near.licenseGuideSlug}`} className="lg-link" style={TEXT_LINK_STYLE}>{near.stateName}</Link>
                      : near.stateName}
                  </th>
                  <td style={TD_STYLE}>{near.authorityDescription}</td>
                  <td style={TD_STYLE}>{nlcTableLabel(near.nlcStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export interface LicenseGuideBandsProps extends LicenseGuideNearbyStatesProps {
  facts: ListingFacts;
  salary: GatedSalary;
  salaryGuideIndexable: boolean;
}

/**
 * Both live bands in page order, each on its own ground (adjacent bands never
 * share one): nearby states (peach) then the market snapshot (mint), with the
 * static hover and focus rules rendered once ahead of them.
 */
export function LicenseGuideBands({ env, nearby, facts, salary, salaryGuideIndexable }: LicenseGuideBandsProps) {
  return (
    <>
      <style>{LICENSE_BANDS_CSS}</style>
      <LicenseGuideNearbyStates env={env} nearby={nearby} />
      <LicenseGuideMarketSnapshot
        stateName={env.stateName}
        stateCode={env.stateCode}
        stateSlug={env.stateSlug}
        facts={facts}
        salary={salary}
        salaryGuideIndexable={salaryGuideIndexable}
      />
    </>
  );
}
