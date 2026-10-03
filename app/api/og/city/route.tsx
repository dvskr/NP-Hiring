import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { brand } from '@/config/brand';
import {
  OG_CACHE_HEADERS,
  OG_SIZE,
  OgBadge,
  OgBody,
  OgFactTile,
  OgFooter,
  OgHeader,
  OgStack,
  OgSurface,
  og,
  ogClamp,
} from '../og-theme';
import { resolveOgCitySalaryLabel } from './salary-label';

export const runtime = 'edge';

/**
 * Dynamic OG image for pSEO city pages.
 * URL: /api/og/city?category=Remote&city=New+York,+NY&jobs=142&salary=<p25>+to+<p75>
 *
 * `salary` arrives formatted and is printed as given (only clamped to the
 * tile); this route never builds a figure. The city and category pages send
 * the gated middle half of posted pay as formatK(p25) to formatK(p75)
 * (formatK in lib/pseo/listing-narrative.ts), the metro guide sends the gated
 * median alone, and every caller omits the param below the benchmark gate,
 * which drops the tile. The example names no dollar figure on purpose: a
 * typed band in this comment was the only thing the hand-typed band scan in
 * tests/regressions/p2-data-accuracy-stats-and-guides.test.ts ever found in
 * this file, and a "to" range would still match it.
 *
 * `label` names that figure on the tile, from the allow-list in
 * ./salary-label.ts: "Salary Range" when absent or unknown (the range the
 * city and category pages send), "Median Posted Pay" from the metro guide
 * (the words that page's hero uses for the same median).
 *
 * P3 #8: the chrome (cream/clay ground, berry accents, clay tiles, domain
 * pill) now lives in ../og-theme and is shared with the general-purpose
 * /api/og generator, which used to render a completely different dark-navy
 * card.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const category = searchParams.get('category') || '';
  const city = searchParams.get('city') || 'United States';
  const jobs = searchParams.get('jobs') || '0';
  const salary = searchParams.get('salary') || '';
  // Allow-listed, never printed as sent: the label is a claim about what the
  // figure is, and free text would let any URL put its own claim on the card.
  const salaryLabel = resolveOgCitySalaryLabel(searchParams.get('label'));
  const shortage = searchParams.get('shortage') === 'true';

  // Fetch logo
  let logoSrc = '';
  try {
    // Fixed origin — never the request Host header (attacker-controlled; using
    // it makes this OG route an SSRF proxy). brand.baseUrl is a build-time
    // constant, so the fixed-origin guarantee holds per deployment.
    const logoRes = await fetch(`${brand.baseUrl}/logo.png`);
    if (logoRes.ok) {
      const logoBuf = await logoRes.arrayBuffer();
      logoSrc = `data:image/png;base64,${Buffer.from(logoBuf).toString('base64')}`;
    }
  } catch { /* fallback text */ }

  // Truncate long city / category names so the headline cannot overflow.
  const displayCity = ogClamp(city, 28);
  const displayCategory = ogClamp(category, 26);
  // The category prefix is dropped rather than doubled when it IS the
  // credential, and when a param-less request supplies no category at all —
  // otherwise the headline reads "NP NP Jobs".
  const showCategory =
    Boolean(displayCategory) &&
    displayCategory.toLowerCase() !== brand.niche.short.toLowerCase();
  const headline = showCategory
    ? `${displayCategory} ${brand.niche.short} Jobs`
    : `${brand.niche.short} Jobs`;

  return new ImageResponse(
    (
      <OgSurface>
        <OgStack>
          {/*
            Header chip carries the category ALONE, not "{category} Jobs": the
            headline directly below already ends in "Jobs", and the longest
            label in ALL_CATEGORY_CONFIGS is 25 characters — long enough that
            a suffix would run the chip into the right margin.
          */}
          <OgHeader
            left={
              logoSrc ? (
                <img
                  src={logoSrc}
                  alt={brand.name}
                  width={180}
                  height={60}
                  style={{ objectFit: 'contain' }}
                />
              ) : (
                <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, color: og.berry }}>
                  {brand.name}
                </div>
              )
            }
            right={showCategory ? <OgBadge icon="briefcase">{displayCategory}</OgBadge> : null}
          />

          <OgBody>
            <div
              style={{
                display: 'flex',
                fontSize: displayCity.length > 20 ? 52 : 62,
                fontWeight: 800,
                color: og.ink,
                lineHeight: 1.05,
                letterSpacing: '-0.03em',
              }}
            >
              {headline}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: displayCity.length > 20 ? 44 : 52,
                fontWeight: 800,
                color: og.berry,
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                marginTop: 6,
              }}
            >
              {`in ${displayCity}`}
            </div>
            {/*
              P2 #7 follow-up: this badge used to carry an unlabelled shortage
              designation, which on a share card reads as an all-specialty
              provider-shortage claim. The only data behind the `shortage`
              param is the caller's behavioral-health HPSA flag — see the
              `mentalHealthShortage` contract in lib/pseo/city-data/types.ts
              and the shortageIsOnTopic() gate in
              lib/pseo/category-city-template.tsx, which is what limits the
              param to the category that designation actually describes. The
              label now names the discipline, so the card claims exactly what
              HRSA designated and nothing wider.
            */}
            {shortage ? (
              <div style={{ display: 'flex', marginTop: 18 }}>
                <OgBadge tone="amber" icon="shieldAlert">
                  Behavioral-Health HPSA
                </OgBadge>
              </div>
            ) : null}
          </OgBody>

          <OgFooter>
            <OgFactTile icon="briefcase" label="Open Positions" value={ogClamp(jobs, 9)} />
            {salary ? (
              <OgFactTile
                icon="dollar"
                iconTone="clay"
                label={salaryLabel}
                value={ogClamp(salary, 18)}
              />
            ) : null}
          </OgFooter>
        </OgStack>
      </OgSurface>
    ),
    {
      ...OG_SIZE,
      headers: { ...OG_CACHE_HEADERS },
    }
  );
}
