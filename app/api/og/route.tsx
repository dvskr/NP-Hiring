import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { brand } from '@/config/brand';
import { OG_HOMEPAGE_HEADLINE, OG_HOMEPAGE_STATS, OG_HOMEPAGE_SUBHEADLINE } from '@/config/niche/copy';
import {
  OG_CACHE_HEADERS,
  OG_SIZE,
  OgBadge,
  OgBody,
  OgFactTile,
  OgFooter,
  OgHeader,
  OgStack,
  OgStatTile,
  OgSurface,
  og,
  ogClamp,
} from './og-theme';

export const runtime = 'edge';

/**
 * General-purpose OG card generator. Three modes, selected by params:
 *
 *   /api/og                                    → homepage card
 *   /api/og?type=page&title=…[&subtitle=…]     → page / category card
 *   /api/og?title=…[&company][&salary][&location][&jobType][&isNew]
 *          [&experience]                       → job-post card
 *
 * P3 #8: this card used to render in donor-era dark navy while
 * /api/og/city shipped the live warm cream/clay look, so two share cards
 * from the same site looked like two different products. All three modes now
 * compose the same chrome as the city generator (./og-theme). The
 * query-param contract above is UNCHANGED — roughly 70 pages build URLs
 * against it — and a param-less request still renders the branded homepage
 * card.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Get dynamic parameters
  const title = searchParams.get('title');
  const type = searchParams.get('type'); // 'page' for category/blog/location pages
  const subtitle = searchParams.get('subtitle') || '';
  // F2: default company is the board's own brand (job pages always pass
  // job.employer; this only fires when the param is missing entirely).
  const company = searchParams.get('company') || brand.name;
  const salary = searchParams.get('salary') || 'Competitive Pay';
  const location = searchParams.get('location') || 'Remote / On-site';
  const jobType = searchParams.get('jobType') || 'Full-time';
  const isNew = searchParams.get('isNew') === 'true';
  // Phase 1 #19 — optional experience chip ("New grad welcome", "5+ yrs", etc.)
  // forwarded by the JD page metadata. Renders as a footer tile when present.
  const experience = searchParams.get('experience') || '';
  const isHomepage = !title && type !== 'page';
  const isPageType = type === 'page';
  const displayTitle = title ? ogClamp(title, 58) : '';

  // A default is a placeholder, not a fact. Every slot on the job card renders
  // only when the caller actually supplied the value, so a share card never
  // asserts an employer, a schedule, a pay range or a location that the JD
  // page did not state. (The salary/location suppression matches the previous
  // card exactly; the employer and type gates are new — those two used to
  // print their placeholder default, which on the redesigned card reads as a
  // stated fact rather than a filler tile.)
  const hasSalary = Boolean(salary) && !['0', 'Hidden', 'Competitive Pay'].includes(salary);
  const hasLocation = Boolean(location) && location !== 'Remote / On-site';
  const hasCompany = Boolean(searchParams.get('company'));
  const hasJobType = Boolean(searchParams.get('jobType'));

  // Fetch Logo
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
  } catch (e) {
    console.error('Failed to fetch logo:', e);
  }

  /**
   * Wordmark slot. Deliberately NOT lifted into og-theme:
   * tests/regressions/shell-brand-remnants.test.ts pins that this file
   * derives both the image alt text and the no-logo fallback wordmark from
   * config/brand.ts, so the config-derived pattern stays visible here.
   */
  const brandMark = logoSrc ? (
    <img src={logoSrc} alt={brand.name} width={180} height={60} style={{ objectFit: 'contain' }} />
  ) : (
    <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, color: og.berry }}>
      {brand.name}
    </div>
  );

  /* ===== HOMEPAGE ===== */
  const homepageCard = (
    <OgStack>
      <OgHeader left={brandMark} />
      <OgBody>
        <div
          style={{
            display: 'flex',
            fontSize: 54,
            fontWeight: 800,
            color: og.ink,
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
            maxWidth: 900,
          }}
        >
          {OG_HOMEPAGE_HEADLINE}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 24,
            fontWeight: 500,
            color: og.inkMuted,
            lineHeight: 1.4,
            marginTop: 16,
            maxWidth: 820,
          }}
        >
          {OG_HOMEPAGE_SUBHEADLINE}
        </div>
      </OgBody>
      <OgFooter>
        {OG_HOMEPAGE_STATS.map((stat) => (
          <OgStatTile key={stat.label} value={stat.number} label={stat.label} />
        ))}
      </OgFooter>
    </OgStack>
  );

  /* ===== PAGE / CATEGORY ===== */
  const pageCard = (
    <OgStack>
      <OgHeader left={brandMark} />
      <OgBody>
        <div
          style={{
            display: 'flex',
            fontSize: displayTitle.length > 35 ? 48 : 56,
            fontWeight: 800,
            color: og.ink,
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
            maxWidth: 1000,
          }}
        >
          {displayTitle}
        </div>
        {subtitle ? (
          <div
            style={{
              display: 'flex',
              fontSize: 24,
              fontWeight: 500,
              color: og.inkMuted,
              lineHeight: 1.4,
              marginTop: 16,
              maxWidth: 860,
            }}
          >
            {ogClamp(subtitle, 130)}
          </div>
        ) : null}
      </OgBody>
      <OgFooter>
        <div style={{ display: 'flex', fontSize: 18, fontWeight: 600, color: og.inkFaint }}>
          {OG_HOMEPAGE_HEADLINE}
        </div>
      </OgFooter>
    </OgStack>
  );

  /* ===== JOB POST ===== */
  const jobCard = (
    <OgStack>
      <OgHeader
        left={brandMark}
        right={isNew ? <OgBadge tone="clay">Featured</OgBadge> : null}
      />
      <OgBody>
        <div
          style={{
            display: 'flex',
            fontSize: displayTitle.length > 38 ? 46 : 52,
            fontWeight: 800,
            color: og.ink,
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
            maxWidth: 1000,
          }}
        >
          {displayTitle}
        </div>
        {hasCompany ? (
          <div
            style={{
              display: 'flex',
              fontSize: 30,
              fontWeight: 800,
              color: og.berry,
              lineHeight: 1.2,
              letterSpacing: '-0.01em',
              marginTop: 14,
            }}
          >
            {ogClamp(company, 40)}
          </div>
        ) : null}
        {hasLocation ? (
          <div
            style={{
              display: 'flex',
              fontSize: 22,
              fontWeight: 500,
              color: og.inkMuted,
              marginTop: 8,
            }}
          >
            {ogClamp(location, 44)}
          </div>
        ) : null}
      </OgBody>
      <OgFooter>
        {hasJobType ? (
          <OgFactTile compact icon="briefcase" label="Type" value={ogClamp(jobType, 18)} />
        ) : null}
        {hasSalary ? (
          <OgFactTile
            compact
            icon="dollar"
            iconTone="clay"
            label="Salary"
            value={ogClamp(salary, 18)}
          />
        ) : null}
        {experience ? (
          <OgFactTile compact icon="layers" label="Experience" value={ogClamp(experience, 18)} />
        ) : null}
      </OgFooter>
    </OgStack>
  );

  return new ImageResponse(
    <OgSurface>{isHomepage ? homepageCard : isPageType ? pageCard : jobCard}</OgSurface>,
    {
      ...OG_SIZE,
      headers: { ...OG_CACHE_HEADERS },
    }
  );
}
