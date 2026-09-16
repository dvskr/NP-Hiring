import { STICKER_CSS } from '@/lib/design/sticker-css';

/**
 * The sticker stylesheet, rendered once per page by the page root. A plain
 * <style> with a static string: never styled-jsx (inventory.md 6.7).
 */
export default function StickerStyles() {
  return <style>{STICKER_CSS}</style>;
}
