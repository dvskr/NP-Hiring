import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { CLAY_ACCENT, clayCard, clayChip, clayDesc, clayFill, clayTitle, cx } from './clay';
import ClayStyles from './ClayStyles';
import IconWell from './IconWell';
import type { SectionGlyph } from './section-icon';
import type { SectionHeadingLevel } from './types';

interface ClayCardProps {
  /** Renders the card as a link with the hover lift; otherwise a static card. */
  href?: string;
  chip?: string;
  /** Chip fill, cycled through CLAY_FILLS. */
  index?: number;
  icon?: SectionGlyph;
  title: ReactNode;
  desc?: ReactNode;
  /** Footer word on a linked card ("Explore"). */
  action?: string;
  /** Centered layout with the large well (icon cells, explore cards). */
  align?: 'start' | 'center';
  headingLevel?: SectionHeadingLevel;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

const CARD_PADDING = '24px';

/**
 * The section card: the clay surface with an optional icon well and pastel
 * chip on top, the title, the description and whatever the section adds
 * below (a divided list, stat tiles, pay bars). With `href` it is a link
 * that lifts on hover (transform only, reduced motion gated).
 */
export default function ClayCard({
  href,
  chip,
  index = 0,
  icon,
  title,
  desc,
  action,
  align = 'start',
  headingLevel = 3,
  className,
  style,
  children,
}: ClayCardProps) {
  const Heading = `h${headingLevel}` as const;
  const centered = align === 'center';
  const head = icon || chip ? (
    <div
      style={{
        display: 'flex',
        flexDirection: centered ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: centered ? 'center' : 'space-between',
        gap: '12px',
        marginBottom: '14px',
      }}
    >
      {icon && <IconWell icon={icon} size={centered ? 'lg' : 'md'} />}
      {chip && (
        <span style={{ ...clayChip, background: clayFill(index), marginLeft: centered ? undefined : 'auto' }}>{chip}</span>
      )}
    </div>
  ) : null;
  const body = (
    <>
      {head}
      <Heading style={clayTitle}>{title}</Heading>
      {desc && <p style={clayDesc}>{desc}</p>}
      {children}
    </>
  );
  const surface: CSSProperties = {
    ...clayCard,
    padding: CARD_PADDING,
    textAlign: centered ? 'center' : undefined,
    ...style,
  };
  if (!href) {
    return (
      <div className={cx('pseo-clay-card', className)} style={surface}>
        {body}
      </div>
    );
  }
  return (
    <>
      <ClayStyles />
      <Link
        href={href}
        className={cx('pseo-clay-card pseo-clay-lift', className)}
        style={{ ...surface, display: 'block', textDecoration: 'none', color: 'inherit' }}
      >
        {body}
        {action && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              marginTop: '12px',
              fontSize: '12px',
              fontWeight: 700,
              color: CLAY_ACCENT,
            }}
          >
            {action}
            <ArrowRight size={12} />
          </span>
        )}
      </Link>
    </>
  );
}
