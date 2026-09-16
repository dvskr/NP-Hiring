/**
 * A category page's headline median, or an honest note when there is none.
 *
 * The bespoke category landings print `$${stats.medianSalaryK}k` in a large
 * figure. When too few listings post a salary the median is 0 and the page
 * showed "$0k" (found 2026-09-16). Until the gated pay sections land, the
 * figure gives way to a short note in body type.
 */
export default function MedianFigure({ k }: { k: number }) {
  if (k > 0) return <>{`$${k}k`}</>;
  return <span style={{ fontSize: '15px', fontWeight: 600, lineHeight: 1.4 }}>Not enough listings post a salary yet.</span>;
}
