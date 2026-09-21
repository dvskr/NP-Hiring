import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { stickerFill } from '@/lib/design/sticker-css';
import StickerFooter from './StickerFooter';
import StickerIconTile from './StickerIconTile';
import type { StickerIcon } from './types';

interface StickerCardProps {
  /** With an href the card is a link that lifts on hover; without, a static card. */
  href?: string;
  /** Clay chip text in the top row. */
  chip?: string;
  /** Position in the grid; drives the chip fill and the accent bar width cycle. */
  index?: number;
  icon?: StickerIcon;
  title: ReactNode;
  desc?: ReactNode;
  /** Footer action word ("Read guide"). No footer when omitted. */
  action?: string;
  /** Row layout with the large icon tile on the right (stacks under 560px). */
  wide?: boolean;
  headingLevel?: 2 | 3 | 4;
  /** Extra body content (a .stk-list, check rows) between the copy and the footer. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * The sticker card (inventory.md 6.2): white face, 2px oxblood border, 5px
 * hard shadow, chip and icon row, Lora title, muted description, accent bar.
 */
export default function StickerCard({
  href,
  chip,
  index = 0,
  icon,
  title,
  desc,
  action,
  wide = false,
  headingLevel = 3,
  children,
  className,
  style,
}: StickerCardProps) {
  const Heading = `h${headingLevel}` as const;
  const classes = ['stk-card', !href && 'stk-static', wide && 'stk-wide', className]
    .filter(Boolean)
    .join(' ');
  const chipNode = chip ? (
    <span className="stk-chip" style={{ background: stickerFill(index) }}>{chip}</span>
  ) : null;
  const copy = (
    <>
      <Heading className="stk-title font-heading">{title}</Heading>
      {desc && <p className="stk-desc">{desc}</p>}
      {children}
      {action && <StickerFooter index={index} action={action} />}
    </>
  );

  const body = wide ? (
    <>
      <span className="stk-body">
        {chipNode}
        {copy}
      </span>
      {icon && <StickerIconTile icon={icon} size="lg" />}
    </>
  ) : (
    <>
      {(chipNode || icon) && (
        <span className="stk-top">
          {chipNode}
          {icon && <StickerIconTile icon={icon} />}
        </span>
      )}
      {copy}
    </>
  );

  if (href) {
    return <Link href={href} className={classes} style={style}>{body}</Link>;
  }
  return <div className={classes} style={style}>{body}</div>;
}
