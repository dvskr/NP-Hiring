import { stickerBarWidth } from '@/lib/design/sticker-css';

interface StickerFooterProps {
  /** Position in the card cycle; picks the decorative bar width. */
  index: number;
  /** Action word, e.g. "Read guide". The arrow is added here. */
  action: string;
}

/** Card footer pinned to the bottom: accent bar plus the action word. Decorative. */
export default function StickerFooter({ index, action }: StickerFooterProps) {
  return (
    <span className="stk-bar" aria-hidden="true">
      <span className="stk-track">
        <span className="stk-fill" style={{ width: stickerBarWidth(index) }} />
      </span>
      <span className="stk-action">{action} →</span>
    </span>
  );
}
