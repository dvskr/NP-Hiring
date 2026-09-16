import type { ReactNode } from 'react';
import { stickerFill } from '@/lib/design/sticker-css';

interface StickerStatProps {
  /** Already formatted figure ("1,204", "$118K"). Callers gate it; never "$0" or "N/A". */
  value: ReactNode;
  label: string;
  /** Position in the row; picks the pastel fill. */
  index?: number;
}

/** Stat sticker: Lora figure and an uppercase label on a pastel face. */
export default function StickerStat({ value, label, index = 0 }: StickerStatProps) {
  return (
    <div className="stk-stat" style={{ background: stickerFill(index) }}>
      <span className="stk-stat-value font-heading">{value}</span>
      <span className="stk-stat-label">{label}</span>
    </div>
  );
}
