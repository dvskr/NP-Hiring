import Link from 'next/link';
import { countText } from './count-text';
import StickerIconTile from './StickerIconTile';
import type { StickerIcon } from './types';

interface StickerTileProps {
  href: string;
  label: string;
  /**
   * Count badge. A number renders only when above zero (never "0"); a string
   * is rendered as given (callers format capped counts like "8+").
   */
  count?: number | string;
  icon?: StickerIcon;
  className?: string;
}

/** Compact linked tile: optional icon, label, optional count badge. */
export default function StickerTile({ href, label, count, icon, className }: StickerTileProps) {
  const badge = countText(count);
  return (
    <Link href={href} className={['stk-tile', className].filter(Boolean).join(' ')}>
      {icon && <StickerIconTile icon={icon} />}
      <span className="stk-tile-label font-heading">{label}</span>
      {badge && <span className="stk-cat-count">{badge}</span>}
    </Link>
  );
}
