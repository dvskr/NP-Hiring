import { PSEO_CLAY_CSS } from './clay';

/**
 * The sections' one stylesheet (column grids, bento spans, hover lift,
 * accordion marker) as a React 19 hoistable <style>: React moves it into
 * <head> and keeps a single copy however many sections render it, so every
 * band that uses a pseo-clay-* layout or behavior class includes
 * <ClayStyles /> itself and no page has to remember to. The string is
 * static (no interpolation), a plain style element, not styled-jsx.
 */
export default function ClayStyles() {
  return (
    <style href="pseo-clay" precedence="default">
      {PSEO_CLAY_CSS}
    </style>
  );
}
