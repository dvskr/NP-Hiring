/**
 * Server band kit for the bespoke category landings (PLAN B.4, B.5), in
 * clay to match the pages that host it: each page becomes a composition of
 * these bands fed by its own data object. The bands carry labels only;
 * every sentence, title and FAQ entry comes from the page (its own copy)
 * or from lib/pseo/listing-narrative.ts.
 */
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import ImmersiveImage from '@/components/ImmersiveImage';
import { SHARED_ART } from '@/lib/pseo/category-asset-registry';
import type { FaqEntry } from '@/lib/pseo/listing-narrative';
import {
  CLAY_ACCENT,
  CLAY_ACCENT_DEEP,
  CLAY_MUTED,
  clayButton,
  clayCard,
  clayChip,
  clayCta,
  clayDesc,
  clayFill,
  clayTitle,
  cx,
} from './clay';
import ClayAccordion from './ClayAccordion';
import ClayCard from './ClayCard';
import ClayHead, { type ClayHeadAction } from './ClayHead';
import ClayStyles from './ClayStyles';
import { faqPageJsonLd } from './faq-schema';
import { categoryNavIcon, resolveSectionIcon, type SectionIcon } from './section-icon';
import type { SectionHeadingLevel } from './types';

/* ListingsWithSidebar */

export interface ListingsAlert {
  title: string;
  lede?: string;
  href: string;
  cta: string;
}

interface ListingsWithSidebarProps {
  /** Listings heading, e.g. "Remote positions (12)"; the caller formats the count. */
  title: ReactNode;
  headingId?: string;
  /** Right-aligned action link ("View all jobs"). */
  action?: ClayHeadAction;
  /** The one alert CTA card every pSEO page carries. */
  alert: ListingsAlert;
  /** Static cards under the alert (ClayCard without href). */
  cards?: ReactNode;
  /** The JobCard list (or the empty-state card). */
  children: ReactNode;
  className?: string;
}

const ALERT_ART_SIZE = 48;

/**
 * Listings beside a sidebar holding exactly one alert CTA card (the pastel
 * gradient with the 2px berry border) and the caller's static cards.
 */
export function ListingsWithSidebar({
  title,
  headingId,
  action,
  alert,
  cards,
  children,
  className,
}: ListingsWithSidebarProps) {
  return (
    <>
      <ClayStyles />
      <div className={cx('grid gap-8 lg:grid-cols-4', className)}>
        <div className="lg:col-span-3">
          <ClayHead title={title} id={headingId} action={action} align="left" />
          <div className="pseo-clay-jobs">{children}</div>
        </div>
        <aside className="lg:col-span-1" style={{ display: 'grid', gap: '20px', alignContent: 'start' }}>
          <div className="pseo-clay-cta" style={clayCta}>
            <Image
              src={SHARED_ART.alertBell.src}
              alt=""
              width={ALERT_ART_SIZE}
              height={ALERT_ART_SIZE}
              sizes={`${ALERT_ART_SIZE}px`}
              style={{ width: ALERT_ART_SIZE, height: ALERT_ART_SIZE, objectFit: 'contain' }}
            />
            <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: CLAY_ACCENT_DEEP, margin: '12px 0 8px' }}>
              {alert.title}
            </h3>
            {alert.lede && (
              <p style={{ fontSize: '13px', color: CLAY_ACCENT, fontWeight: 500, lineHeight: 1.6, margin: '0 0 16px' }}>{alert.lede}</p>
            )}
            <Link href={alert.href} className="pseo-clay-lift" style={{ ...clayButton, display: 'flex', width: '100%' }}>
              {alert.cta}
            </Link>
          </div>
          {cards}
        </aside>
      </div>
    </>
  );
}

/* BenefitBento */

/** The art of a picture cell: an ImmersiveImage beside (8) or above (4) its copy. */
interface BentoPicture {
  span: 8 | 4;
  src: string;
  alt: string;
  minHeight?: number;
}

export type BentoCell =
  /** Picture cell: one clay card holding the page's copy and the picture. */
  | (BentoPicture & { kind: 'picture'; title: string; desc: string; chip?: string })
  /**
   * Picture cell with a caller-built card (PracticeCard, PostedPay) beside
   * a framed picture, for the B.5 practice and pay bento cells.
   */
  | (BentoPicture & { kind: 'card'; card: ReactNode })
  /** Icon cell: a centered clay card with an Art tile or a glyph in the well. */
  | { kind: 'icon'; span?: 3 | 4 | 6; icon: SectionIcon; title: string; desc: string; chip?: string };

type PictureBentoCell = Extract<BentoCell, { kind: 'picture' | 'card' }>;

interface BenefitBentoProps {
  cells: BentoCell[];
  headingLevel?: SectionHeadingLevel;
  className?: string;
}

const WIDE_PICTURE_HEIGHT = 240;
const TALL_PICTURE_HEIGHT = 200;

/** A picture in its own clay frame (padding 0, the art edge to edge inside the card). */
function PictureFrame({ cell }: { cell: BentoPicture }) {
  return (
    <div className="pseo-clay-card" style={{ ...clayCard, padding: 0, overflow: 'hidden', display: 'grid' }}>
      <ImmersiveImage src={cell.src} alt={cell.alt} minHeight={cell.minHeight ?? WIDE_PICTURE_HEIGHT} />
    </div>
  );
}

function PictureCell({ cell, index, headingLevel }: { cell: PictureBentoCell; index: number; headingLevel: SectionHeadingLevel }) {
  const Heading = `h${headingLevel}` as const;
  if (cell.kind === 'card') {
    return cell.span === 8 ? (
      <div className="pseo-clay-span-8 pseo-clay-split" style={{ gap: '14px', alignItems: 'stretch' }}>
        {cell.card}
        <PictureFrame cell={cell} />
      </div>
    ) : (
      <div className="pseo-clay-span-4" style={{ display: 'grid', gap: '14px', alignContent: 'start' }}>
        <PictureFrame cell={cell} />
        {cell.card}
      </div>
    );
  }
  const chip = cell.chip && (
    <span style={{ ...clayChip, background: clayFill(index), marginBottom: '12px', alignSelf: 'flex-start' }}>{cell.chip}</span>
  );
  if (cell.span === 8) {
    return (
      <div className="pseo-clay-card pseo-clay-span-8 pseo-clay-split" style={{ ...clayCard, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {chip}
          <Heading style={{ ...clayTitle, fontSize: '20px' }}>{cell.title}</Heading>
          <p style={clayDesc}>{cell.desc}</p>
        </div>
        <ImmersiveImage src={cell.src} alt={cell.alt} minHeight={cell.minHeight ?? WIDE_PICTURE_HEIGHT} />
      </div>
    );
  }
  return (
    <div
      className="pseo-clay-card pseo-clay-span-4"
      style={{ ...clayCard, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <ImmersiveImage src={cell.src} alt={cell.alt} minHeight={cell.minHeight ?? TALL_PICTURE_HEIGHT} />
      <div style={{ padding: '24px 22px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {chip}
        <Heading style={{ ...clayTitle, fontSize: '16px', margin: '0 0 6px' }}>{cell.title}</Heading>
        <p style={{ ...clayDesc, fontSize: '13px', color: CLAY_MUTED }}>{cell.desc}</p>
      </div>
    </div>
  );
}

/**
 * The "why choose" bento: 8 and 4 column picture cells through
 * ImmersiveImage (edge to edge inside a padding-0 clay card, the picture
 * itself never padded or rounded), each with the page's copy or a
 * caller-built section card, and icon cells as centered clay cards.
 * Renders nothing without cells.
 */
export function BenefitBento({ cells, headingLevel = 3, className }: BenefitBentoProps) {
  if (cells.length === 0) return null;
  return (
    <>
      <ClayStyles />
      <div className={cx('pseo-clay-bento', className)}>
        {cells.map((cell, i) =>
          cell.kind !== 'icon' ? (
            <PictureCell key={`${cell.src}-${i}`} cell={cell} index={i} headingLevel={headingLevel} />
          ) : (
            <ClayCard
              key={`${cell.title}-${i}`}
              className={`pseo-clay-span-${cell.span ?? 3}`}
              chip={cell.chip}
              index={i}
              icon={resolveSectionIcon(cell.icon)}
              title={cell.title}
              desc={cell.desc}
              align="center"
              headingLevel={headingLevel}
            />
          ),
        )}
      </div>
    </>
  );
}

/* StepsBand */

export interface LandingStep {
  title: string;
  text: string;
}

interface StepsBandProps {
  steps: LandingStep[];
  headingLevel?: SectionHeadingLevel;
  className?: string;
}

const MAX_STEP_COLUMNS = 4;

/** Numbered steps as clay cards with the berry top rule, the number above the title. */
export function StepsBand({ steps, headingLevel = 3, className }: StepsBandProps) {
  if (steps.length === 0) return null;
  const Heading = `h${headingLevel}` as const;
  const cols = Math.min(steps.length, MAX_STEP_COLUMNS);
  return (
    <>
      <ClayStyles />
      <div className={cx('pseo-clay-grid', cols > 1 ? `pseo-clay-cols-${cols}` : null, className)}>
        {steps.map((step, i) => (
          <div
            key={step.title}
            className="pseo-clay-card"
            style={{ ...clayCard, padding: '28px 24px', borderTop: `3px solid ${CLAY_ACCENT}` }}
          >
            <span
              style={{
                display: 'block',
                marginBottom: '12px',
                fontSize: '28px',
                fontWeight: 800,
                lineHeight: 1,
                color: CLAY_ACCENT,
                opacity: 0.4,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <Heading style={{ ...clayTitle, fontSize: '15px' }}>{step.title}</Heading>
            <p style={{ ...clayDesc, fontSize: '13px' }}>{step.text}</p>
          </div>
        ))}
      </div>
    </>
  );
}

/* ExploreGrid */

export interface ExploreCard {
  href: string;
  label: string;
  sub?: string;
  /** Taxonomy slug: the card's icon comes from categoryNavArt(slug) when `icon` is omitted. */
  slug?: string;
  icon?: SectionIcon;
  /** The target's render gate; a card whose page would not render is dropped. */
  renders: boolean;
}

interface ExploreGridProps {
  cards: ExploreCard[];
  /** Footer action word on every card. */
  action?: string;
  headingLevel?: SectionHeadingLevel;
  className?: string;
}

const MAX_EXPLORE_COLUMNS = 3;

function exploreIcon(card: ExploreCard) {
  if (card.icon) return resolveSectionIcon(card.icon);
  if (card.slug) return categoryNavIcon(card.slug);
  return undefined;
}

/** Linked clay cards, centered, with the registry's nav tile or glyph per destination. */
export function ExploreGrid({ cards, action = 'Explore', headingLevel = 3, className }: ExploreGridProps) {
  const live = cards.filter((card) => card.renders);
  if (live.length === 0) return null;
  const cols = Math.min(live.length, MAX_EXPLORE_COLUMNS);
  return (
    <>
      <ClayStyles />
      <div className={cx('pseo-clay-grid', cols > 1 ? `pseo-clay-cols-${cols}` : null, className)}>
        {live.map((card, i) => (
          <ClayCard
            key={card.href}
            href={card.href}
            index={i}
            icon={exploreIcon(card)}
            title={card.label}
            desc={card.sub}
            action={action}
            align="center"
            headingLevel={headingLevel}
          />
        ))}
      </div>
    </>
  );
}

/* InlineFaq */

interface InlineFaqProps {
  /** One array feeds the accordion and the FAQPage schema. */
  items: FaqEntry[];
  /** Band head; omitted when the page renders its own heading. */
  title?: ReactNode;
  eyebrow?: string;
  headingId?: string;
  lede?: ReactNode;
  /** Level of the question headings. */
  headingLevel?: SectionHeadingLevel;
  /** False when the page keeps its own FAQPage literal (never emit the schema twice). */
  jsonLd?: boolean;
  className?: string;
}

/**
 * Clay accordion plus FAQPage JSON-LD from the identical array. The
 * schema is emitted only at 2 or more entries; an entry that fails its
 * render condition is absent from both at once, because there is one list.
 */
export function InlineFaq({
  items,
  title,
  eyebrow,
  headingId,
  lede,
  headingLevel = 3,
  jsonLd = true,
  className,
}: InlineFaqProps) {
  if (items.length === 0) return null;
  const schema = jsonLd ? faqPageJsonLd(items) : null;
  return (
    <div className={className}>
      {schema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />}
      {title && <ClayHead eyebrow={eyebrow} title={title} id={headingId} lede={lede} />}
      <ClayAccordion items={items} headingLevel={headingLevel} />
    </div>
  );
}
