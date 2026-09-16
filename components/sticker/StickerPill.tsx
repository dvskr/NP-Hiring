import Link from 'next/link';
import { countText } from './count-text';

interface StickerPillProps {
  href: string;
  label: string;
  /** Count badge: a number renders only above zero, a string as given. */
  count?: number | string;
  className?: string;
}

/** Link pill: the smallest sticker, for nearby places and sibling categories. */
export default function StickerPill({ href, label, count, className }: StickerPillProps) {
  const badge = countText(count);
  return (
    <Link href={href} className={['stk-pill', className].filter(Boolean).join(' ')}>
      {label}
      {badge && <span className="stk-pill-count">{badge}</span>}
    </Link>
  );
}
