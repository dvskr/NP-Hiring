/**
 * The label above the /api/og/city salary tile, which a caller picks with
 * `?label=` from this allow-list.
 *
 * WHY A LABEL AT ALL: the label says what kind of figure the tile prints.
 * The city and category pages send the gated middle half of posted pay
 * (formatK(p25) to formatK(p75)), which is a range. The metro guide sends
 * one gated median, and a median printed under "Salary Range" misdescribes
 * it on every share of that page.
 *
 * WHY "MEDIAN POSTED PAY" AND NOT "MEDIAN SALARY": the figure is the median
 * of the pay employers posted for that metro, not of what NPs there earn,
 * and the page the card links to already calls it "median posted pay" in its
 * hero (buildHeroStats in app/jobs/metro/[slug]/page.tsx). The card uses the
 * page's words, so one number is not named two ways;
 * tests/regressions/og-city-salary-label.test.ts pins the label to the hero.
 *
 * WHY AN ALLOW-LIST: free text would let any URL on this domain print its
 * own claim on a share card. A missing or unknown value falls back to the
 * range label, the card every caller got before the param existed, so the
 * URLs those callers already send render exactly as they did.
 *
 * A plain module with no next/og import, so the metro page can import the
 * value it sends from here and the caller and the route cannot spell a label
 * differently.
 */
export const OG_CITY_SALARY_LABELS = {
  /** The middle half of posted pay, p25 to p75 (city and category pages). */
  range: 'Salary Range',
  /** One gated median of posted pay (the metro guide, in its hero's words). */
  median: 'Median Posted Pay',
} as const;

export type OgCitySalaryLabel = (typeof OG_CITY_SALARY_LABELS)[keyof typeof OG_CITY_SALARY_LABELS];

const ALLOWED_LABELS: ReadonlySet<string> = new Set(Object.values(OG_CITY_SALARY_LABELS));

function isOgCitySalaryLabel(value: string): value is OgCitySalaryLabel {
  return ALLOWED_LABELS.has(value);
}

/** The `label` query value when it is on the allow-list (exact match), else the range label. */
export function resolveOgCitySalaryLabel(raw: string | null): OgCitySalaryLabel {
  return raw !== null && isOgCitySalaryLabel(raw) ? raw : OG_CITY_SALARY_LABELS.range;
}
