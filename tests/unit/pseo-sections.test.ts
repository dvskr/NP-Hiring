/**
 * pSEO data sections and landing bands (PLAN.md B.4, W1B-SECTIONS), clay.
 *
 * Rendered with react-dom/server against fixture facts, no database:
 *   - every section renders nothing for empty facts (a null builder result
 *     removes the whole card, never a padded one);
 *   - no dollar figure appears without a gated benchmark, except the cited
 *     BLS median from lib/stats-sources.ts;
 *   - links exist only where the gate prop says the target renders;
 *   - the accordion output carries the `faq-answer` Speakable hook and the
 *     FAQPage schema comes from the same array, only at 2 or more entries;
 *   - every surface is the clay token (owner decision 2026-09-20), nothing
 *     from the sticker kit, and the one stylesheet is hoisted once per page;
 *   - house style: no em dash, en dash or spaced hyphen in any output;
 *   - one inline snapshot per component for a full fixture.
 *
 * Written as .test.ts with React.createElement because vitest.config.ts
 * includes only `tests/** /*.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React, { type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { NAV_ICONS, SHARED_ART } from '@/lib/pseo/category-asset-registry';
import { emptyListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts';
import { getNearbyStates, getPracticeEnvironment } from '@/lib/pseo/practice-environment';
import {
  BenefitBento,
  ClayCard,
  EmployerRoster,
  ExploreGrid,
  InlineFaq,
  ListingsWithSidebar,
  LocationSpread,
  MarketSnapshot,
  NearbyStatesTable,
  PSEO_CLAY_CSS,
  PostedPay,
  PracticeCard,
  RoleSetup,
  StepsBand,
  clayCard,
  faqPageJsonLd,
  type LocationSpreadPlace,
  type NearbyStateRow,
} from '@/components/seo/pseo';

const ROOT = path.resolve(__dirname, '../..');
const SECTIONS_DIR = path.join(ROOT, 'components', 'seo', 'pseo');

/** Typed createElement: props are checked against the component's own props. */
function h<P extends object>(component: (props: P) => ReactNode, props: P, ...children: ReactNode[]): ReactElement {
  return React.createElement(component, props, ...children);
}
const html = (node: ReactElement): string => renderToStaticMarkup(node);

/* Fixtures */

const NOW = new Date('2026-09-17T00:00:00Z');

const FULL: ListingFacts = {
  total: 12,
  distinctEmployers: 3,
  topEmployers: [
    { name: 'Lakeside Health', count: 6, companyPath: '/companies/lakeside-health' },
    { name: 'Northwind Clinics', count: 4, companyPath: null },
    { name: 'Harbor Medical Group', count: 2, companyPath: null },
  ],
  cities: [
    { name: 'Austin', stateCode: 'TX', count: 5 },
    { name: 'Dallas', stateCode: 'TX', count: 4 },
    { name: 'Waco', stateCode: 'TX', count: 2 },
    { name: 'Tyler', stateCode: 'TX', count: 1 },
  ],
  states: [
    { name: 'Texas', count: 8 },
    { name: 'Ohio', count: 3 },
    { name: 'Oregon', count: 1 },
  ],
  workMode: { total: 12, remote: 4, hybrid: 0, onsite: 8 },
  jobTypes: { total: 12, labeledTotal: 10, top: [{ label: 'Full-Time', count: 7 }, { label: 'Part-Time', count: 3 }] },
  settings: { total: 12, labeledTotal: 9, top: [{ label: 'Outpatient', count: 6 }, { label: 'Inpatient', count: 3 }] },
  categoryTop: [{ label: 'Family Practice', count: 5 }],
  recency: { total: 12, datedCount: 12, last7: 2, last30: 7, newestPostedAt: new Date('2026-09-15T00:00:00Z') },
  newGradFriendly: 2,
  salaryDisclosedCount: 7,
  benchmark: { scope: 'Texas', median: 128_000, p25: 115_000, p75: 142_000, postings: 7, employers: 3 },
  computedAt: NOW,
  sampled: false,
};

const NO_BENCHMARK: ListingFacts = { ...FULL, benchmark: null };
const EMPTY = emptyListingFacts(NOW);

const PLACES: LocationSpreadPlace[] = [
  { name: 'Austin', count: 5, link: { href: '/jobs/remote/city/austin-tx', renders: true } },
  { name: 'Dallas', count: 4, link: { href: '/jobs/remote/city/dallas-tx', renders: true } },
  { name: 'Waco', count: 2, link: { href: '/jobs/remote/city/waco-tx', renders: false } },
  { name: 'Tyler', count: 1, link: null },
];

const TEXAS = getPracticeEnvironment('Texas');
if (!TEXAS) throw new Error('fixture: Texas is missing from the practice dataset');

const NEARBY_JOBS = [4, 0, 2];
const NEARBY_ROWS: NearbyStateRow[] = getNearbyStates('Texas').slice(0, 3).map((env, i) => ({
  env,
  jobs: NEARBY_JOBS[i],
  medianK: i === 0 ? 131 : null,
  link: { href: `/jobs/state/${env.stateSlug}`, renders: NEARBY_JOBS[i] >= 1 },
  guide: { href: `/blog/${env.licenseGuideSlug}`, renders: i !== 1 },
}));

const FAQS = [
  { question: 'How many remote listings are open?', answer: 'There are 12 current remote listings from 3 employers.' },
  { question: 'What do remote listings pay?', answer: 'The median posted pay is $128K across 7 listings. <script> stays escaped.' },
];

const DOLLARS = /\$[\d,]+(?:\.\d+)?K?/g;
/** En dash and em dash (U+2013, U+2014), built from code points so this file carries neither byte. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
/** The clay card shadow, the token every surface shares. */
const CLAY_SHADOW = '6px 6px 16px rgba(0,0,0,0.06)';
/** The foreground layer of components/ImmersiveImage.tsx, one per picture. */
const IMMERSIVE_FOREGROUND = /left:50%;transform:translateX\(-50%\)/g;
/* Forbidden tokens, assembled at runtime so this file never carries them literally. */
const STYLED_JSX = new RegExp('<style' + ' jsx');
const STICKER_CLASS = new RegExp('\\bstk' + '-');
const STICKER_IMPORT = new RegExp('@/components' + '/sticker|sticker' + '-css|Sticker[A-Z]');

const hub = { kind: 'hub', stateName: 'Texas' } as const;
const categoryPay = { kind: 'category', slug: 'family-practice' } as const;
const statePay = { kind: 'location', scopeName: 'Texas', scopeNoun: 'state' } as const;

function fullRenders(): Record<string, string> {
  return {
    EmployerRoster: html(h(EmployerRoster, { variant: hub, facts: FULL })),
    LocationSpread: html(h(LocationSpread, {
      variant: { kind: 'hub' },
      places: PLACES,
      tileIcon: NAV_ICONS.location,
      directory: { href: '/jobs/locations/texas', label: 'See every Texas city with open roles', renders: true },
    })),
    RoleSetup: html(h(RoleSetup, { slug: 'family-practice', facts: FULL })),
    PostedPay: html(h(PostedPay, {
      variant: categoryPay,
      facts: FULL,
      salaryGuide: { href: '/salary-guide/texas', label: 'Texas salary guide', renders: true },
    })),
    PracticeCard: html(h(PracticeCard, { env: TEXAS, variant: { kind: 'licensure', slug: 'anesthesia' }, licenseGuideLive: true })),
    MarketSnapshot: html(h(MarketSnapshot, { slug: 'family-practice', label: 'Family practice', scope: 'nationwide', facts: FULL })),
    NearbyStatesTable: html(h(NearbyStatesTable, { variant: 'salary', rows: NEARBY_ROWS })),
    ListingsWithSidebar: html(h(ListingsWithSidebar, {
      title: 'Remote positions (12)',
      action: { href: '/jobs', label: 'View all jobs' },
      alert: { title: 'Remote alerts', lede: 'New remote listings by email.', href: '/job-alerts?mode=Remote', cta: 'Create alert' },
      cards: h(ClayCard, { title: 'Tips', desc: 'Confirm the schedule in each listing.' }),
      children: React.createElement('div', { className: 'job-list' }, 'jobs'),
    })),
    BenefitBento: html(h(BenefitBento, {
      cells: [
        { kind: 'picture', span: 8, src: SHARED_ART.multistateMap, alt: 'Multi-state licensure map', title: 'Multi-state licensure', desc: 'Care for patients in more than one state.' },
        { kind: 'picture', span: 4, src: SHARED_ART.stateSalary, alt: 'Salary chart', title: 'Posted pay', desc: 'Medians publish at 5 postings from 3 employers.' },
        { kind: 'icon', icon: NAV_ICONS.remote, title: 'Flexible hours', desc: 'Design a schedule around your life.' },
        { kind: 'icon', icon: { glyph: 'House' }, title: 'Home office', desc: 'A quiet, well-lit room with a locked door.' },
      ],
    })),
    StepsBand: html(h(StepsBand, {
      steps: [
        { title: 'Platform setup', text: 'Most employers provide the telehealth platform.' },
        { title: 'Licensure', text: 'Plan for a license in every state where your patients are.' },
        { title: 'Equipment', text: 'Reliable internet, a webcam and a headset.' },
      ],
    })),
    ExploreGrid: html(h(ExploreGrid, {
      cards: [
        { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual patient care', slug: 'telehealth', renders: true },
        { href: '/jobs/oncology', label: 'Oncology', sub: 'Cancer care roles', slug: 'oncology', renders: true },
        { href: '/salary-guide', label: 'Salary guide', sub: 'Posted pay by state', icon: NAV_ICONS.salary, renders: true },
      ],
    })),
    InlineFaq: html(h(InlineFaq, { items: FAQS, eyebrow: 'Questions', title: 'Remote FAQ', headingId: 'faq' })),
  };
}

/* Empty facts */

describe('pSEO sections: empty facts render nothing', () => {
  it('EmployerRoster renders nothing below every variant floor', () => {
    expect(html(h(EmployerRoster, { variant: hub, facts: EMPTY }))).toBe('');
    expect(html(h(EmployerRoster, { variant: { kind: 'city', city: 'Austin' }, facts: EMPTY }))).toBe('');
    expect(html(h(EmployerRoster, { variant: { kind: 'scoped', label: 'Remote', scope: 'nationwide' }, facts: EMPTY }))).toBe('');
    expect(html(h(EmployerRoster, { variant: { kind: 'category-city', labelSentence: 'remote', city: 'Austin' }, facts: EMPTY }))).toBe('');
    expect(html(h(EmployerRoster, { variant: { kind: 'statewide', stateName: 'Texas' }, facts: EMPTY }))).toBe('');
    const single: ListingFacts = { ...FULL, distinctEmployers: 1, topEmployers: FULL.topEmployers.slice(0, 1) };
    expect(html(h(EmployerRoster, { variant: hub, facts: single }))).toBe('');
  });

  it('LocationSpread renders nothing without places', () => {
    expect(html(h(LocationSpread, { variant: { kind: 'hub' }, places: [] }))).toBe('');
    expect(html(h(LocationSpread, { variant: { kind: 'scoped', slug: 'remote' }, places: PLACES.slice(0, 1) }))).toBe('');
    expect(html(h(LocationSpread, { variant: { kind: 'landing' }, places: [] }))).toBe('');
    expect(html(h(LocationSpread, {
      variant: { kind: 'category-city', city: 'Austin', stateName: 'Texas', labelSentence: 'remote', cityCount: 0, stateCount: null },
      places: [],
    }))).toBe('');
  });

  it('RoleSetup renders nothing below the floor and on its own axis', () => {
    expect(html(h(RoleSetup, { slug: 'family-practice', facts: EMPTY }))).toBe('');
    const onlyMode: ListingFacts = { ...FULL, jobTypes: EMPTY.jobTypes, settings: EMPTY.settings };
    expect(html(h(RoleSetup, { slug: 'remote', facts: onlyMode }))).toBe('');
  });

  it('PostedPay renders nothing without a benchmark or disclosed pay', () => {
    expect(html(h(PostedPay, { variant: { kind: 'category', slug: 'remote' }, facts: EMPTY }))).toBe('');
    expect(html(h(PostedPay, { variant: statePay, facts: EMPTY }))).toBe('');
    const undisclosed: ListingFacts = { ...NO_BENCHMARK, salaryDisclosedCount: 0 };
    expect(html(h(PostedPay, { variant: { kind: 'category', slug: 'remote' }, facts: undisclosed }))).toBe('');
    expect(html(h(PostedPay, { variant: statePay, facts: undisclosed }))).toBe('');
  });

  it('PostedPay never prints the NP median on anesthesia or midwifery below the gate', () => {
    expect(html(h(PostedPay, { variant: { kind: 'category', slug: 'anesthesia' }, facts: NO_BENCHMARK }))).toBe('');
    expect(html(h(PostedPay, { variant: { kind: 'category', slug: 'midwifery' }, facts: NO_BENCHMARK }))).toBe('');
  });

  it('PracticeCard renders nothing off the dataset', () => {
    expect(html(h(PracticeCard, { env: null, licenseGuideLive: false }))).toBe('');
    expect(html(h(PracticeCard, { env: getPracticeEnvironment('Atlantis'), licenseGuideLive: true }))).toBe('');
  });

  it('MarketSnapshot renders nothing for an empty scope', () => {
    expect(html(h(MarketSnapshot, { slug: 'remote', label: 'Remote', scope: 'nationwide', facts: EMPTY }))).toBe('');
  });

  it('NearbyStatesTable renders nothing without live rows', () => {
    expect(html(h(NearbyStatesTable, { variant: 'hub', rows: [] }))).toBe('');
    expect(html(h(NearbyStatesTable, { variant: 'salary', rows: [] }))).toBe('');
    expect(html(h(NearbyStatesTable, { variant: 'license', rows: [] }))).toBe('');
    const idle = NEARBY_ROWS.map((row) => ({ ...row, jobs: 0 }));
    expect(html(h(NearbyStatesTable, { variant: 'hub', rows: idle }))).toBe('');
    expect(html(h(NearbyStatesTable, { variant: 'salary', rows: NEARBY_ROWS.slice(0, 1) }))).toBe('');
  });

  it('landing bands render nothing without content', () => {
    expect(html(h(BenefitBento, { cells: [] }))).toBe('');
    expect(html(h(StepsBand, { steps: [] }))).toBe('');
    expect(html(h(ExploreGrid, { cards: [] }))).toBe('');
    expect(html(h(ExploreGrid, { cards: [{ href: '/jobs/remote/texas', label: 'Remote in Texas', renders: false }] }))).toBe('');
    expect(html(h(InlineFaq, { items: [] }))).toBe('');
  });
});

/* Dollar figures */

describe('pSEO sections: no dollar figure without a benchmark', () => {
  it('only the cited BLS median survives when the benchmark is null', () => {
    const outputs = [
      html(h(EmployerRoster, { variant: hub, facts: NO_BENCHMARK })),
      html(h(LocationSpread, { variant: { kind: 'landing' }, places: PLACES })),
      html(h(RoleSetup, { slug: 'family-practice', facts: NO_BENCHMARK })),
      html(h(PostedPay, { variant: categoryPay, facts: NO_BENCHMARK })),
      html(h(PostedPay, { variant: statePay, facts: NO_BENCHMARK })),
      html(h(MarketSnapshot, { slug: 'family-practice', label: 'Family practice', scope: 'nationwide', facts: NO_BENCHMARK })),
      html(h(NearbyStatesTable, { variant: 'salary', rows: NEARBY_ROWS.map((row) => ({ ...row, medianK: null })) })),
    ];
    const figures = outputs.join('\n').match(DOLLARS) ?? [];
    expect(figures.length).toBeGreaterThan(0);
    for (const figure of figures) expect(figure).toBe(STAT_SOURCES.averageSalary.formatted);
  });

  it('PostedPay cites the BLS source inline below the gate, linked to its source page, and draws no bars', () => {
    for (const variant of [categoryPay, statePay]) {
      const out = html(h(PostedPay, { variant, facts: NO_BENCHMARK }));
      expect(out).toContain(STAT_SOURCES.averageSalary.source);
      expect(out).toContain(STAT_SOURCES.averageSalary.sourceUrl);
      expect(out.match(/<a /g)).toHaveLength(1);
      expect(out).not.toContain('pseo-clay-bar');
    }
    const gated = html(h(PostedPay, { variant: categoryPay, facts: FULL }));
    expect(gated).not.toContain(STAT_SOURCES.averageSalary.sourceUrl);
  });

  it('PostedPay draws p25, median and p75 as flat accent bars on the oxblood track from the benchmark', () => {
    const out = html(h(PostedPay, { variant: categoryPay, facts: FULL }));
    expect(out).toContain('$128K');
    expect(out).toContain('$115K');
    expect(out).toContain('$142K');
    expect(out.match(/class="pseo-clay-bar-fill"/g)).toHaveLength(3);
    expect(out.match(/background:rgba\(122,28,43,0\.12\)/g)).toHaveLength(3);
    expect(out.match(/background:#BE185D;width:\d+%/g)).toHaveLength(3);
    expect(out).toContain('width:100%');
    expect(out).not.toMatch(/gradient/i);
  });

  it('NearbyStatesTable prints a median only for gated rows', () => {
    const out = html(h(NearbyStatesTable, { variant: 'salary', rows: NEARBY_ROWS }));
    expect(out).toContain('$131K');
    expect(out.match(/Not published \(sample below minimum\)/g)).toHaveLength(2);
    expect(out.match(DOLLARS)).toEqual(['$131K']);
  });
});

/* Link gates */

describe('pSEO sections: links only to targets that render', () => {
  it('EmployerRoster links only rows with a companyPath', () => {
    const out = html(h(EmployerRoster, { variant: hub, facts: FULL }));
    expect(out).toContain('href="/companies/lakeside-health"');
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toContain('Northwind Clinics');
  });

  it('LocationSpread tiles only places whose target renders and names the rest', () => {
    const out = html(h(LocationSpread, { variant: { kind: 'hub' }, places: PLACES }));
    expect(out).toContain('href="/jobs/remote/city/austin-tx"');
    expect(out).toContain('href="/jobs/remote/city/dallas-tx"');
    expect(out).not.toContain('waco-tx');
    expect(out).toContain('Waco');
    expect(out.match(/class="pseo-clay-tile pseo-clay-lift"/g)).toHaveLength(2);
    expect(out).not.toContain('/jobs/locations/texas');
    const gated = html(h(LocationSpread, {
      variant: { kind: 'hub' },
      places: PLACES,
      directory: { href: '/jobs/locations/texas', label: 'Every city', renders: false },
    }));
    expect(gated).not.toContain('/jobs/locations/texas');
  });

  it('NearbyStatesTable links a state only through a passed gate', () => {
    const out = html(h(NearbyStatesTable, { variant: 'hub', rows: NEARBY_ROWS }));
    const [live, idle, other] = NEARBY_ROWS;
    expect(out).toContain(`href="/jobs/state/${live.env.stateSlug}"`);
    expect(out).toContain(`href="/jobs/state/${other.env.stateSlug}"`);
    expect(out).not.toContain(idle.env.stateSlug);
    expect(out).toContain('Nearby states with open');
    const guides = html(h(NearbyStatesTable, { variant: 'license', rows: NEARBY_ROWS }));
    expect(guides).toContain(`href="/blog/${live.env.licenseGuideSlug}"`);
    expect(guides).not.toContain(`href="/blog/${idle.env.licenseGuideSlug}"`);
    expect(guides).toContain(idle.env.stateName);
  });

  it('NearbyStatesTable license variant is the three-column table of the spec, guide linked once per row', () => {
    const out = html(h(NearbyStatesTable, { variant: 'license', rows: NEARBY_ROWS }));
    expect(out.match(/<th scope="col"/g)).toHaveLength(3);
    expect(out.match(/<th scope="row"/g)).toHaveLength(3);
    expect(out).toContain('<caption');
    expect(out).toContain('Nurse Licensure Compact');
    expect(out).not.toContain('License guide');
    expect(out.match(/<a /g)).toHaveLength(2);
    expect(out.match(/<tr[ >]/g)).toHaveLength(4);
  });

  it('PracticeCard links the guide only while it is live and the board with nofollow', () => {
    const dark = html(h(PracticeCard, { env: TEXAS, licenseGuideLive: false }));
    expect(dark).not.toContain(`/blog/${TEXAS.licenseGuideSlug}`);
    const live = html(h(PracticeCard, { env: TEXAS, licenseGuideLive: true }));
    expect(live).toContain(`href="/blog/${TEXAS.licenseGuideSlug}"`);
    expect(live).toContain(`href="${TEXAS.boardUrl}" rel="nofollow noopener"`);
    expect(live).toContain(TEXAS.details);
    expect(live).toContain(TEXAS.authorityDescription);
    const bare = html(h(PracticeCard, { env: TEXAS, licenseGuideLive: false, links: {} }));
    expect(bare).not.toContain('<ul');
  });

  it('PostedPay links the salary guide only when it renders', () => {
    const gated = html(h(PostedPay, {
      variant: { kind: 'category', slug: 'remote' },
      facts: FULL,
      salaryGuide: { href: '/salary-guide/texas', label: 'Guide', renders: false },
    }));
    expect(gated).not.toContain('/salary-guide/texas');
  });

  it('ExploreGrid drops cards whose page would not render', () => {
    const out = html(h(ExploreGrid, {
      cards: [
        { href: '/jobs/telehealth', label: 'Telehealth', slug: 'telehealth', renders: true },
        { href: '/jobs/remote/texas', label: 'Remote in Texas', renders: false },
      ],
    }));
    expect(out).toContain('href="/jobs/telehealth"');
    expect(out).not.toContain('/jobs/remote/texas');
    expect(out.match(/<a class="pseo-clay-card pseo-clay-lift"/g)).toHaveLength(1);
  });
});

/* Bands and FAQ */

describe('pSEO landing bands', () => {
  it('ListingsWithSidebar wraps the listings beside exactly one alert CTA card on the pastel gradient', () => {
    const out = fullRenders().ListingsWithSidebar;
    expect(out).toContain('class="pseo-clay-jobs"');
    expect(out.match(/class="pseo-clay-cta"/g)).toHaveLength(1);
    expect(out).toContain('linear-gradient(145deg, #FDF2F8, #FCE7F3)');
    expect(out).toContain('border:2px solid rgba(190,24,93,0.15)');
    expect(out).toContain('href="/job-alerts?mode=Remote"');
    expect(out).toContain('href="/jobs"');
    expect(out).toContain('Tips');
  });

  it('BenefitBento shows every picture through ImmersiveImage inside a padding-0 clay card, never padded or rounded itself', () => {
    const out = fullRenders().BenefitBento;
    expect(out.match(IMMERSIVE_FOREGROUND)).toHaveLength(2);
    expect(out).toContain('alt="Multi-state licensure map"');
    expect(out).toContain('alt="Salary chart"');
    expect(out).toContain('pseo-clay-span-8');
    expect(out).toContain('pseo-clay-span-4');
    expect(out.match(/class="pseo-clay-card pseo-clay-span-3"/g)).toHaveLength(2);
    expect(out).toContain('/_next/image?url=');
    expect(out).not.toMatch(/<img[^>]*border-radius/i);
    expect(out).not.toMatch(/<img[^>]*src="\/images/);
    expect(out).not.toMatch(/position:relative;overflow:hidden;min-height:[^"]*padding/);
    expect(out.match(/padding:0;overflow:hidden/g)).toHaveLength(2);
  });

  it('BenefitBento card cells place a section card beside its framed picture instead of a copy card', () => {
    const out = html(h(BenefitBento, {
      cells: [
        {
          kind: 'card',
          span: 8,
          src: SHARED_ART.statePractice,
          alt: 'Practice rules',
          card: h(PracticeCard, { env: TEXAS, licenseGuideLive: false, links: {} }),
        },
        { kind: 'card', span: 4, src: SHARED_ART.stateSalary, alt: 'Pay', card: h(PostedPay, { variant: statePay, facts: FULL }) },
      ],
    }));
    expect(out.match(IMMERSIVE_FOREGROUND)).toHaveLength(2);
    expect(out.match(/class="pseo-clay-card"/g)).toHaveLength(4);
    expect(out).toContain('Practicing in Texas');
    expect(out).toContain('Posted pay');
    expect(out).toContain(TEXAS.boardUrl);
    expect(out).toContain('$128K');
    expect(out).toContain('pseo-clay-span-8');
    expect(out).toContain('pseo-clay-span-4');
  });

  it('StepsBand numbers each step above its title in a berry-ruled card', () => {
    const out = fullRenders().StepsBand;
    expect(out).toContain('>01<');
    expect(out).toContain('>03<');
    expect(out).toContain('pseo-clay-cols-3');
    expect(out.match(/class="pseo-clay-card"/g)).toHaveLength(3);
    expect(out.match(/border-top:3px solid #BE185D/g)).toHaveLength(3);
  });

  it('InlineFaq carries faq-answer and a FAQPage schema from the same array', () => {
    const out = fullRenders().InlineFaq;
    expect(out).toContain('faq-answer');
    expect(out).toContain('<details');
    expect(out.match(/<details[^>]*open/g)).toHaveLength(1);
    expect(out).toContain('application/ld+json');
    const schema = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(out);
    expect(schema).not.toBeNull();
    const body = schema ? schema[1] : '';
    const parsed = JSON.parse(body) as { '@type': string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(parsed['@type']).toBe('FAQPage');
    expect(parsed.mainEntity.map((q) => q.name)).toEqual(FAQS.map((f) => f.question));
    expect(parsed.mainEntity[1].acceptedAnswer.text).toBe(FAQS[1].answer);
    expect(body).not.toContain('<script>');
  });

  it('InlineFaq emits no schema for one entry or when the page keeps its own', () => {
    const one = html(h(InlineFaq, { items: FAQS.slice(0, 1) }));
    expect(one).toContain('faq-answer');
    expect(one).not.toContain('application/ld+json');
    const own = html(h(InlineFaq, { items: FAQS, jsonLd: false }));
    expect(own).toContain('faq-answer');
    expect(own).not.toContain('application/ld+json');
    expect(faqPageJsonLd(FAQS.slice(0, 1))).toBeNull();
    expect(faqPageJsonLd(FAQS)).toContain('\\u003cscript');
  });

  it('RoleSetup shows one stat tile per kept bucket and never a zero', () => {
    const out = fullRenders().RoleSetup;
    expect(out.match(/class="pseo-clay-stat"/g)).toHaveLength(4);
    expect(out).not.toContain('hybrid');
    expect(out).toContain('Full-Time');
    expect(out).toContain('Outpatient');
  });

  it('MarketSnapshot composes the three cards and sizes its grid to what rendered', () => {
    const full = fullRenders().MarketSnapshot;
    expect(full).toContain('pseo-clay-cols-3');
    expect(full.match(/class="pseo-clay-card"/g)).toHaveLength(3);
    const noDates: ListingFacts = { ...FULL, recency: { ...FULL.recency, newestPostedAt: null } };
    const out = html(h(MarketSnapshot, { slug: 'family-practice', label: 'Family practice', scope: 'nationwide', facts: noDates }));
    expect(out).toContain('pseo-clay-cols-2');
    expect(out.match(/class="pseo-clay-card"/g)).toHaveLength(2);
    expect(out).not.toContain('Recency');
  });
});

/* Clay surface */

describe('pSEO sections: clay surface', () => {
  it('every section renders on the clay token and nothing from the sticker kit', () => {
    for (const [name, out] of Object.entries(fullRenders())) {
      expect(out, name).toContain(CLAY_SHADOW);
      expect(out, name).toContain('border-radius:');
      expect(out, name).not.toMatch(STICKER_CLASS);
    }
    expect(clayCard.boxShadow).toContain(CLAY_SHADOW);
    expect(clayCard.borderRadius).toBe('20px');
  });

  it('the one stylesheet is hoisted once per page, static, and lifts only by transform under a reduced-motion gate', () => {
    const page = html(React.createElement(
      'div',
      null,
      h(ExploreGrid, { cards: [{ href: '/jobs/telehealth', label: 'Telehealth', slug: 'telehealth', renders: true }] }),
      h(InlineFaq, { items: FAQS }),
      h(LocationSpread, { variant: { kind: 'hub' }, places: PLACES }),
      h(StepsBand, { steps: [{ title: 'Licensure', text: 'Plan for a license in every state.' }] }),
    ));
    expect(page.match(/<style/g)).toHaveLength(1);
    expect(page).toContain('data-href="pseo-clay"');
    expect(page).toContain(PSEO_CLAY_CSS);
    expect(PSEO_CLAY_CSS).not.toContain('${');
    expect(PSEO_CLAY_CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(PSEO_CLAY_CSS).toMatch(/\.pseo-clay-lift:hover \{ transform: translateY\(-3px\); \}/);
    expect(PSEO_CLAY_CSS).not.toMatch(/:hover \{[^}]*(box-shadow|background|width|height|margin|padding)/);
    const staticCard = html(h(ClayCard, { title: 'Static' }));
    expect(staticCard).not.toContain('pseo-clay-lift');
    expect(staticCard).not.toContain('<style');
  });
});

/* House style */

describe('pSEO sections: house style', () => {
  it('renders no em dash, en dash or spaced hyphen', () => {
    const all = Object.values(fullRenders()).join('\n');
    expect(all).not.toMatch(DASHES);
    expect(all).not.toMatch(/\S - \S/);
  });

  it('source files stay server-only, clay-only, static-styled and dash free', () => {
    for (const entry of fs.readdirSync(SECTIONS_DIR)) {
      const src = fs.readFileSync(path.join(SECTIONS_DIR, entry), 'utf8');
      expect(src, entry).not.toMatch(STYLED_JSX);
      expect(src, entry).not.toMatch(/console\.log/);
      expect(src, entry).not.toMatch(/['"]use client['"]/);
      expect(src, entry).not.toMatch(STICKER_CLASS);
      expect(src, entry).not.toMatch(STICKER_IMPORT);
      expect(src, entry).not.toMatch(DASHES);
      expect(src, entry).not.toMatch(/['"`][^'"`\n]*\S - \S[^'"`\n]*['"`]/);
    }
  });
});

/* Snapshots */

describe('pSEO sections: markup snapshots for a full fixture', () => {
  const renders = fullRenders();

  it('EmployerRoster markup', () => {
    expect(renders.EmployerRoster).toMatchInlineSnapshot(`"<div class="pseo-clay-card" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px"><div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px"><span style="background:#F9F7F1;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:56px;height:56px;border-radius:16px" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#BE185D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-building2 lucide-building-2" aria-hidden="true"><path d="M10 12h4"></path><path d="M10 8h4"></path><path d="M14 21v-3a2 2 0 0 0-4 0v3"></path><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"></path><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"></path></svg></span><span style="display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1A2E35;border:1px solid rgba(255,255,255,0.6);box-shadow:3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6);white-space:nowrap;background:#FDF2F8;margin-left:auto">Employers</span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Who is hiring</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">The employers with the most open NP roles in Texas right now are Lakeside Health (6 roles), Northwind Clinics (4) and Harbor Medical Group (2).</p><ul class="pseo-clay-list" style="list-style:none;margin:16px 0 0;padding:0"><li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:14px;color:#5A4A42;border-bottom:1px solid rgba(0,0,0,0.06)"><a style="color:#BE185D;font-weight:600;text-decoration:none" href="/companies/lakeside-health">Lakeside Health</a><span style="font-size:12px;font-weight:700;color:#BE185D;white-space:nowrap">6 listings</span></li><li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:14px;color:#5A4A42;border-bottom:1px solid rgba(0,0,0,0.06)"><span>Northwind Clinics</span><span style="font-size:12px;font-weight:700;color:#BE185D;white-space:nowrap">4 listings</span></li><li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:14px;color:#5A4A42"><span>Harbor Medical Group</span><span style="font-size:12px;font-weight:700;color:#BE185D;white-space:nowrap">2 listings</span></li></ul></div>"`);
  });

  it('LocationSpread markup', () => {
    expect(renders.LocationSpread).toMatchInlineSnapshot(`
      "<style data-precedence="default" data-href="pseo-clay">
      .pseo-clay-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
      .pseo-clay-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .pseo-clay-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .pseo-clay-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
      .pseo-clay-span-3 { grid-column: span 3; }
      .pseo-clay-span-4 { grid-column: span 4; }
      .pseo-clay-span-6 { grid-column: span 6; }
      .pseo-clay-span-8 { grid-column: span 8; }
      .pseo-clay-span-12 { grid-column: span 12; }
      .pseo-clay-split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-lift { transition: transform 0.25s ease; }
      .pseo-clay-lift:hover { transform: translateY(-3px); }
      .pseo-clay-faq summary { list-style: none; }
      .pseo-clay-faq summary::-webkit-details-marker { display: none; }
      .pseo-clay-chevron svg { transition: transform 0.2s ease; }
      .pseo-clay-faq details[open] .pseo-clay-chevron svg { transform: rotate(180deg); }
      @media (min-width: 769px) and (max-width: 1024px) {
        .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pseo-clay-bento { grid-template-columns: repeat(6, minmax(0, 1fr)); }
        .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 6; }
      }
      @media (max-width: 768px) {
        .pseo-clay-cols-2, .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-bento { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-span-3, .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 1; }
        .pseo-clay-split { grid-template-columns: minmax(0, 1fr); }
      }
      @media (prefers-reduced-motion: reduce) {
        .pseo-clay-lift { transition: none; }
        .pseo-clay-lift:hover { transform: none; }
        .pseo-clay-chevron svg { transition: none; }
      }
      </style><div class="pseo-clay-card" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px"><div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px"><span style="background:#F9F7F1;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:56px;height:56px;border-radius:16px" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#BE185D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg></span><span style="display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1A2E35;border:1px solid rgba(255,255,255,0.6);box-shadow:3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6);white-space:nowrap;background:#E6FFFA;margin-left:auto">Locations</span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Where the listings are</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">Open roles are spread across 4 cities. Austin leads with 5, followed by Dallas (4) and Waco (2). Cities with fewer than 3 open roles: Tyler.</p><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px"><a class="pseo-clay-tile pseo-clay-lift" style="display:inline-flex;align-items:center;gap:10px;padding:8px 14px;border-radius:12px;background:#FFFFFF;border:1px solid rgba(255,255,255,0.5);box-shadow:3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6);color:#1A2E35;font-size:13px;font-weight:600;text-decoration:none" href="/jobs/remote/city/austin-tx"><span style="background:#f3f3f0;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:32px;border-radius:10px" aria-hidden="true"><img alt="" loading="lazy" width="22" height="22" decoding="async" data-nimg="1" style="color:transparent;width:22px;height:22px;object-fit:contain" sizes="22px" srcSet="/_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=64&amp;q=75 64w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=96&amp;q=75 96w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=128&amp;q=75 128w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=256&amp;q=75 256w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=750&amp;q=75 750w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=828&amp;q=75 828w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=1080&amp;q=75 1080w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=1920&amp;q=75 1920w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=2048&amp;q=75 2048w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=3840&amp;q=75"/></span><span>Austin</span><span style="font-size:12px;font-weight:700;color:#BE185D;white-space:nowrap">5</span></a><a class="pseo-clay-tile pseo-clay-lift" style="display:inline-flex;align-items:center;gap:10px;padding:8px 14px;border-radius:12px;background:#FFFFFF;border:1px solid rgba(255,255,255,0.5);box-shadow:3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6);color:#1A2E35;font-size:13px;font-weight:600;text-decoration:none" href="/jobs/remote/city/dallas-tx"><span style="background:#f3f3f0;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:32px;border-radius:10px" aria-hidden="true"><img alt="" loading="lazy" width="22" height="22" decoding="async" data-nimg="1" style="color:transparent;width:22px;height:22px;object-fit:contain" sizes="22px" srcSet="/_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=64&amp;q=75 64w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=96&amp;q=75 96w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=128&amp;q=75 128w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=256&amp;q=75 256w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=750&amp;q=75 750w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=828&amp;q=75 828w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=1080&amp;q=75 1080w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=1920&amp;q=75 1920w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=2048&amp;q=75 2048w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fcategories%2Fnav%2Flocation.webp&amp;w=3840&amp;q=75"/></span><span>Dallas</span><span style="font-size:12px;font-weight:700;color:#BE185D;white-space:nowrap">4</span></a></div><p style="margin:16px 0 0;font-size:13px"><a style="color:#BE185D;font-weight:600;text-decoration:none" href="/jobs/locations/texas">See every Texas city with open roles</a></p></div>"
    `);
  });

  it('RoleSetup markup', () => {
    expect(renders.RoleSetup).toMatchInlineSnapshot(`"<div class="pseo-clay-card" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px"><div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px"><span style="background:#F9F7F1;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:56px;height:56px;border-radius:16px" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#BE185D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layers" aria-hidden="true"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"></path><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"></path><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"></path></svg></span><span style="display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1A2E35;border:1px solid rgba(255,255,255,0.6);box-shadow:3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6);white-space:nowrap;background:#FFF3E8;margin-left:auto">Role setup</span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">How these roles are set up</h3><div style="display:flex;flex-wrap:wrap;gap:10px;margin:4px 0 16px"><div class="pseo-clay-stat" style="background:#FFFFFF;border-radius:16px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:12px 16px;min-width:96px;text-align:center"><span style="display:block;font-size:22px;font-weight:800;color:#1A2E35;line-height:1.1">4</span><span style="display:block;margin-top:4px;font-size:11px;font-weight:600;color:#7A6A62;text-transform:uppercase;letter-spacing:0.04em">remote</span></div><div class="pseo-clay-stat" style="background:#FFFFFF;border-radius:16px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:12px 16px;min-width:96px;text-align:center"><span style="display:block;font-size:22px;font-weight:800;color:#1A2E35;line-height:1.1">8</span><span style="display:block;margin-top:4px;font-size:11px;font-weight:600;color:#7A6A62;text-transform:uppercase;letter-spacing:0.04em">on site</span></div><div class="pseo-clay-stat" style="background:#FFFFFF;border-radius:16px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:12px 16px;min-width:96px;text-align:center"><span style="display:block;font-size:22px;font-weight:800;color:#1A2E35;line-height:1.1">7</span><span style="display:block;margin-top:4px;font-size:11px;font-weight:600;color:#7A6A62;text-transform:uppercase;letter-spacing:0.04em">Full-Time</span></div><div class="pseo-clay-stat" style="background:#FFFFFF;border-radius:16px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:12px 16px;min-width:96px;text-align:center"><span style="display:block;font-size:22px;font-weight:800;color:#1A2E35;line-height:1.1">6</span><span style="display:block;margin-top:4px;font-size:11px;font-weight:600;color:#7A6A62;text-transform:uppercase;letter-spacing:0.04em">Outpatient</span></div></div><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0 0 8px">4 of 12 are remote and 8 on site.</p><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0 0 8px">Full-Time is the most common arrangement (7), followed by Part-Time (3).</p><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">The most common setting is Outpatient (6), followed by Inpatient (3).</p></div>"`);
  });

  it('PostedPay markup', () => {
    expect(renders.PostedPay).toMatchInlineSnapshot(`"<div class="pseo-clay-card" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px"><div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px"><span style="background:#F9F7F1;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:56px;height:56px;border-radius:16px" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#BE185D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-wallet" aria-hidden="true"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"></path><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"></path></svg></span><span style="display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1A2E35;border:1px solid rgba(255,255,255,0.6);box-shadow:3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6);white-space:nowrap;background:#FCE7F3;margin-left:auto">Pay</span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Posted pay</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">Across 7 listings from 3 employers that state an annual salary, the median posted pay is $128K. The middle half of those listings fall between $115K and $142K.</p><ul class="pseo-clay-list" style="list-style:none;margin:16px 0 0;padding:0"><li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:13px;color:#5A4A42;border-bottom:1px solid rgba(0,0,0,0.06)"><span style="min-width:104px">25th percentile</span><span class="pseo-clay-bar" aria-hidden="true" style="flex:1;height:8px;border-radius:999px;background:rgba(122,28,43,0.12);overflow:hidden"><span class="pseo-clay-bar-fill" style="display:block;height:100%;border-radius:999px;background:#BE185D;width:81%"></span></span><span style="font-size:12px;font-weight:700;color:#BE185D;white-space:nowrap;min-width:48px;text-align:right">$115K</span></li><li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:13px;color:#5A4A42;border-bottom:1px solid rgba(0,0,0,0.06)"><span style="min-width:104px">Median</span><span class="pseo-clay-bar" aria-hidden="true" style="flex:1;height:8px;border-radius:999px;background:rgba(122,28,43,0.12);overflow:hidden"><span class="pseo-clay-bar-fill" style="display:block;height:100%;border-radius:999px;background:#BE185D;width:90%"></span></span><span style="font-size:12px;font-weight:700;color:#BE185D;white-space:nowrap;min-width:48px;text-align:right">$128K</span></li><li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:13px;color:#5A4A42"><span style="min-width:104px">75th percentile</span><span class="pseo-clay-bar" aria-hidden="true" style="flex:1;height:8px;border-radius:999px;background:rgba(122,28,43,0.12);overflow:hidden"><span class="pseo-clay-bar-fill" style="display:block;height:100%;border-radius:999px;background:#BE185D;width:100%"></span></span><span style="font-size:12px;font-weight:700;color:#BE185D;white-space:nowrap;min-width:48px;text-align:right">$142K</span></li></ul><p style="margin:16px 0 0;font-size:13px"><a style="color:#BE185D;font-weight:600;text-decoration:none" href="/salary-guide/texas">Texas salary guide</a></p></div>"`);
  });

  it('PracticeCard markup', () => {
    expect(renders.PracticeCard).toMatchInlineSnapshot(`"<div class="pseo-clay-card" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px"><div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px"><span style="background:#F9F7F1;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:56px;height:56px;border-radius:16px" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#BE185D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield-check" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg></span><span style="display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1A2E35;border:1px solid rgba(255,255,255,0.6);box-shadow:3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6);white-space:nowrap;background:#FDF2F8;margin-left:auto">Restricted Practice</span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Practicing in Texas</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0 0 10px">AANP classifies Texas as a restricted practice state. Texas requires NPs to have a prescriptive authority agreement with a supervising physician.</p><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0 0 10px">Texas is a Nurse Licensure Compact member. The compact covers the RN license beneath your APRN credential; the APRN license itself is still issued by Texas.</p><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0 0 10px">Applications, fees and renewal rules come from the <a href="https://www.ncsbn.org/bon-member-details/Texas" rel="nofollow noopener" style="color:#BE185D;font-weight:600;text-decoration:none">Texas Board of Nursing</a>.</p><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">CRNA certification is administered by NBCRNA.</p><ul class="pseo-clay-list" style="list-style:none;margin:16px 0 0;padding:0"><li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:14px;color:#5A4A42;border-bottom:1px solid rgba(0,0,0,0.06)"><a style="color:#BE185D;font-weight:600;text-decoration:none" href="/blog/np-license-texas">Read the Texas license guide</a></li><li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:14px;color:#5A4A42;border-bottom:1px solid rgba(0,0,0,0.06)"><a style="color:#BE185D;font-weight:600;text-decoration:none" href="/resources/fpa-guide">Full practice authority guide</a></li><li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:14px;color:#5A4A42"><a style="color:#BE185D;font-weight:600;text-decoration:none" href="/scope-of-practice#texas">Scope of practice by state</a></li></ul></div>"`);
  });

  it('MarketSnapshot markup', () => {
    expect(renders.MarketSnapshot).toMatchInlineSnapshot(`
      "<style data-precedence="default" data-href="pseo-clay">
      .pseo-clay-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
      .pseo-clay-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .pseo-clay-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .pseo-clay-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
      .pseo-clay-span-3 { grid-column: span 3; }
      .pseo-clay-span-4 { grid-column: span 4; }
      .pseo-clay-span-6 { grid-column: span 6; }
      .pseo-clay-span-8 { grid-column: span 8; }
      .pseo-clay-span-12 { grid-column: span 12; }
      .pseo-clay-split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-lift { transition: transform 0.25s ease; }
      .pseo-clay-lift:hover { transform: translateY(-3px); }
      .pseo-clay-faq summary { list-style: none; }
      .pseo-clay-faq summary::-webkit-details-marker { display: none; }
      .pseo-clay-chevron svg { transition: transform 0.2s ease; }
      .pseo-clay-faq details[open] .pseo-clay-chevron svg { transform: rotate(180deg); }
      @media (min-width: 769px) and (max-width: 1024px) {
        .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pseo-clay-bento { grid-template-columns: repeat(6, minmax(0, 1fr)); }
        .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 6; }
      }
      @media (max-width: 768px) {
        .pseo-clay-cols-2, .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-bento { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-span-3, .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 1; }
        .pseo-clay-split { grid-template-columns: minmax(0, 1fr); }
      }
      @media (prefers-reduced-motion: reduce) {
        .pseo-clay-lift { transition: none; }
        .pseo-clay-lift:hover { transform: none; }
        .pseo-clay-chevron svg { transition: none; }
      }
      </style><div class="pseo-clay-grid pseo-clay-cols-3"><div class="pseo-clay-card" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px"><div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px"><span style="background:#F9F7F1;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:56px;height:56px;border-radius:16px" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#BE185D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-building2 lucide-building-2" aria-hidden="true"><path d="M10 12h4"></path><path d="M10 8h4"></path><path d="M14 21v-3a2 2 0 0 0-4 0v3"></path><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"></path><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"></path></svg></span><span style="display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1A2E35;border:1px solid rgba(255,255,255,0.6);box-shadow:3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6);white-space:nowrap;background:#FDF2F8;margin-left:auto">Employers</span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Who is hiring</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">12 listings nationwide come from 3 employers. Lakeside Health has the most, with 6.</p><ul class="pseo-clay-list" style="list-style:none;margin:16px 0 0;padding:0"><li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:14px;color:#5A4A42;border-bottom:1px solid rgba(0,0,0,0.06)"><a style="color:#BE185D;font-weight:600;text-decoration:none" href="/companies/lakeside-health">Lakeside Health</a><span style="font-size:12px;font-weight:700;color:#BE185D;white-space:nowrap">6 listings</span></li><li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:14px;color:#5A4A42;border-bottom:1px solid rgba(0,0,0,0.06)"><span>Northwind Clinics</span><span style="font-size:12px;font-weight:700;color:#BE185D;white-space:nowrap">4 listings</span></li><li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;font-size:14px;color:#5A4A42"><span>Harbor Medical Group</span><span style="font-size:12px;font-weight:700;color:#BE185D;white-space:nowrap">2 listings</span></li></ul></div><div class="pseo-clay-card" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px"><div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px"><span style="background:#F9F7F1;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:56px;height:56px;border-radius:16px" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#BE185D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layers" aria-hidden="true"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"></path><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"></path><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"></path></svg></span><span style="display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1A2E35;border:1px solid rgba(255,255,255,0.6);box-shadow:3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6);white-space:nowrap;background:#E6FFFA;margin-left:auto">Role setup</span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">How these roles are set up</h3><div style="display:flex;flex-wrap:wrap;gap:10px;margin:4px 0 16px"><div class="pseo-clay-stat" style="background:#FFFFFF;border-radius:16px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:12px 16px;min-width:96px;text-align:center"><span style="display:block;font-size:22px;font-weight:800;color:#1A2E35;line-height:1.1">4</span><span style="display:block;margin-top:4px;font-size:11px;font-weight:600;color:#7A6A62;text-transform:uppercase;letter-spacing:0.04em">remote</span></div><div class="pseo-clay-stat" style="background:#FFFFFF;border-radius:16px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:12px 16px;min-width:96px;text-align:center"><span style="display:block;font-size:22px;font-weight:800;color:#1A2E35;line-height:1.1">8</span><span style="display:block;margin-top:4px;font-size:11px;font-weight:600;color:#7A6A62;text-transform:uppercase;letter-spacing:0.04em">on site</span></div><div class="pseo-clay-stat" style="background:#FFFFFF;border-radius:16px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:12px 16px;min-width:96px;text-align:center"><span style="display:block;font-size:22px;font-weight:800;color:#1A2E35;line-height:1.1">7</span><span style="display:block;margin-top:4px;font-size:11px;font-weight:600;color:#7A6A62;text-transform:uppercase;letter-spacing:0.04em">Full-Time</span></div><div class="pseo-clay-stat" style="background:#FFFFFF;border-radius:16px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:12px 16px;min-width:96px;text-align:center"><span style="display:block;font-size:22px;font-weight:800;color:#1A2E35;line-height:1.1">6</span><span style="display:block;margin-top:4px;font-size:11px;font-weight:600;color:#7A6A62;text-transform:uppercase;letter-spacing:0.04em">Outpatient</span></div></div><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0 0 8px">4 of 12 are remote and 8 on site.</p><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0 0 8px">Full-Time is the most common arrangement (7), followed by Part-Time (3).</p><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">The most common setting is Outpatient (6), followed by Inpatient (3).</p></div><div class="pseo-clay-card" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px"><div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px"><span style="background:#F9F7F1;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:56px;height:56px;border-radius:16px" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#BE185D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-clock" aria-hidden="true"><path d="M16 14v2.2l1.6 1"></path><path d="M16 2v4"></path><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"></path><path d="M3 10h5"></path><path d="M8 2v4"></path><circle cx="16" cy="16" r="6"></circle></svg></span><span style="display:inline-flex;align-items:center;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1A2E35;border:1px solid rgba(255,255,255,0.6);box-shadow:3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6);white-space:nowrap;background:#FFF3E8;margin-left:auto">Recency</span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">How current the listings are</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">7 of these 12 listings were posted in the last 30 days, and the newest was posted on September 15, 2026.</p></div></div>"
    `);
  });

  it('NearbyStatesTable markup', () => {
    expect(renders.NearbyStatesTable).toMatchInlineSnapshot(`"<div><div class="pseo-clay-table" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:8px 24px 12px;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><caption style="caption-side:top;text-align:left;padding:12px 0;font-size:12px;color:#7A6A62;line-height:1.5">Practice classifications from AANP; compact status verified against the NCSBN roster on August 11, 2026; medians from NP Hiring postings with disclosed pay, published at 5 or more postings from 3 or more employers.</caption><thead><tr><th scope="col" style="padding:10px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#7A6A62;border-bottom:1px solid rgba(0,0,0,0.06);white-space:nowrap;text-align:left">State</th><th scope="col" style="padding:10px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#7A6A62;border-bottom:1px solid rgba(0,0,0,0.06);white-space:nowrap;text-align:left">AANP classification</th><th scope="col" style="padding:10px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#7A6A62;border-bottom:1px solid rgba(0,0,0,0.06);white-space:nowrap;text-align:left">Compact status</th><th scope="col" style="padding:10px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#7A6A62;border-bottom:1px solid rgba(0,0,0,0.06);white-space:nowrap;text-align:right">Open NP roles</th><th scope="col" style="padding:10px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#7A6A62;border-bottom:1px solid rgba(0,0,0,0.06);white-space:nowrap;text-align:right">Posted median</th><th scope="col" style="padding:10px 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#7A6A62;border-bottom:1px solid rgba(0,0,0,0.06);white-space:nowrap;text-align:left">License guide</th></tr></thead><tbody><tr><th scope="row" style="padding:10px 8px;text-align:left;vertical-align:top;border-bottom:1px solid rgba(0,0,0,0.06);font-weight:600;color:#1A2E35"><a style="color:#BE185D;font-weight:600;text-decoration:none" href="/jobs/state/new-mexico">New Mexico</a></th><td style="padding:10px 8px;text-align:left;vertical-align:top;border-bottom:1px solid rgba(0,0,0,0.06);color:#5A4A42">Full Practice</td><td style="padding:10px 8px;text-align:left;vertical-align:top;border-bottom:1px solid rgba(0,0,0,0.06);color:#5A4A42">Compact State</td><td style="padding:10px 8px;text-align:right;vertical-align:top;border-bottom:1px solid rgba(0,0,0,0.06);color:#5A4A42">4</td><td style="padding:10px 8px;text-align:right;vertical-align:top;border-bottom:1px solid rgba(0,0,0,0.06);color:#5A4A42">$131K</td><td style="padding:10px 8px;text-align:left;vertical-align:top;border-bottom:1px solid rgba(0,0,0,0.06);color:#5A4A42"><a style="color:#BE185D;font-weight:600;text-decoration:none" href="/blog/np-license-new-mexico">Read guide</a></td></tr><tr><th scope="row" style="padding:10px 8px;text-align:left;vertical-align:top;border-bottom:1px solid rgba(0,0,0,0.06);font-weight:600;color:#1A2E35">Oklahoma</th><td style="padding:10px 8px;text-align:left;vertical-align:top;border-bottom:1px solid rgba(0,0,0,0.06);color:#5A4A42">Restricted Practice</td><td style="padding:10px 8px;text-align:left;vertical-align:top;border-bottom:1px solid rgba(0,0,0,0.06);color:#5A4A42">Compact State</td><td style="padding:10px 8px;text-align:right;vertical-align:top;border-bottom:1px solid rgba(0,0,0,0.06);color:#5A4A42">None</td><td style="padding:10px 8px;text-align:right;vertical-align:top;border-bottom:1px solid rgba(0,0,0,0.06);color:#5A4A42">Not published (sample below minimum)</td><td style="padding:10px 8px;text-align:left;vertical-align:top;border-bottom:1px solid rgba(0,0,0,0.06);color:#5A4A42"></td></tr><tr><th scope="row" style="padding:10px 8px;text-align:left;vertical-align:top;font-weight:600;color:#1A2E35"><a style="color:#BE185D;font-weight:600;text-decoration:none" href="/jobs/state/arkansas">Arkansas</a></th><td style="padding:10px 8px;text-align:left;vertical-align:top;color:#5A4A42">Reduced Practice</td><td style="padding:10px 8px;text-align:left;vertical-align:top;color:#5A4A42">Compact State</td><td style="padding:10px 8px;text-align:right;vertical-align:top;color:#5A4A42">2</td><td style="padding:10px 8px;text-align:right;vertical-align:top;color:#5A4A42">Not published (sample below minimum)</td><td style="padding:10px 8px;text-align:left;vertical-align:top;color:#5A4A42"><a style="color:#BE185D;font-weight:600;text-decoration:none" href="/blog/np-license-arkansas">Read guide</a></td></tr></tbody></table></div></div>"`);
  });

  it('ListingsWithSidebar markup', () => {
    expect(renders.ListingsWithSidebar).toMatchInlineSnapshot(`
      "<style data-precedence="default" data-href="pseo-clay">
      .pseo-clay-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
      .pseo-clay-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .pseo-clay-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .pseo-clay-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
      .pseo-clay-span-3 { grid-column: span 3; }
      .pseo-clay-span-4 { grid-column: span 4; }
      .pseo-clay-span-6 { grid-column: span 6; }
      .pseo-clay-span-8 { grid-column: span 8; }
      .pseo-clay-span-12 { grid-column: span 12; }
      .pseo-clay-split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-lift { transition: transform 0.25s ease; }
      .pseo-clay-lift:hover { transform: translateY(-3px); }
      .pseo-clay-faq summary { list-style: none; }
      .pseo-clay-faq summary::-webkit-details-marker { display: none; }
      .pseo-clay-chevron svg { transition: transform 0.2s ease; }
      .pseo-clay-faq details[open] .pseo-clay-chevron svg { transform: rotate(180deg); }
      @media (min-width: 769px) and (max-width: 1024px) {
        .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pseo-clay-bento { grid-template-columns: repeat(6, minmax(0, 1fr)); }
        .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 6; }
      }
      @media (max-width: 768px) {
        .pseo-clay-cols-2, .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-bento { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-span-3, .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 1; }
        .pseo-clay-split { grid-template-columns: minmax(0, 1fr); }
      }
      @media (prefers-reduced-motion: reduce) {
        .pseo-clay-lift { transition: none; }
        .pseo-clay-lift:hover { transform: none; }
        .pseo-clay-chevron svg { transition: none; }
      }
      </style><div class="grid gap-8 lg:grid-cols-4"><div class="lg:col-span-3"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:24px"><div><h2 class="font-lora" style="font-size:20px;font-weight:700;color:#1A2E35;line-height:1.2;margin:0">Remote positions (12)</h2></div><a style="display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600;color:#BE185D;text-decoration:none" href="/jobs">View all jobs<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></a></div><div class="pseo-clay-jobs"><div class="job-list">jobs</div></div></div><aside class="lg:col-span-1" style="display:grid;gap:20px;align-content:start"><div class="pseo-clay-cta" style="background:linear-gradient(145deg, #FDF2F8, #FCE7F3);border-radius:20px;border:2px solid rgba(190,24,93,0.15);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px"><img alt="" loading="lazy" width="48" height="48" decoding="async" data-nimg="1" style="color:transparent;width:48px;height:48px;object-fit:contain" sizes="48px" srcSet="/_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=64&amp;q=75 64w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=96&amp;q=75 96w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=128&amp;q=75 128w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=256&amp;q=75 256w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=750&amp;q=75 750w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=828&amp;q=75 828w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=1080&amp;q=75 1080w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=1920&amp;q=75 1920w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=2048&amp;q=75 2048w, /_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fcategories%2Ficons%2Falert-bell.webp&amp;w=3840&amp;q=75"/><h3 class="font-lora" style="font-size:18px;font-weight:700;color:#831843;margin:12px 0 8px">Remote alerts</h3><p style="font-size:13px;color:#BE185D;font-weight:500;line-height:1.6;margin:0 0 16px">New remote listings by email.</p><a class="pseo-clay-lift" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 28px;border-radius:12px;background:#BE185D;color:#FFFFFF;font-size:14px;font-weight:700;text-decoration:none;box-shadow:3px 3px 8px rgba(190,24,93,0.15);width:100%" href="/job-alerts?mode=Remote">Create alert</a></div><div class="pseo-clay-card" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px"><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Tips</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">Confirm the schedule in each listing.</p></div></aside></div>"
    `);
  });

  it('BenefitBento markup', () => {
    expect(renders.BenefitBento).toMatchInlineSnapshot(`
      "<style data-precedence="default" data-href="pseo-clay">
      .pseo-clay-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
      .pseo-clay-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .pseo-clay-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .pseo-clay-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
      .pseo-clay-span-3 { grid-column: span 3; }
      .pseo-clay-span-4 { grid-column: span 4; }
      .pseo-clay-span-6 { grid-column: span 6; }
      .pseo-clay-span-8 { grid-column: span 8; }
      .pseo-clay-span-12 { grid-column: span 12; }
      .pseo-clay-split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-lift { transition: transform 0.25s ease; }
      .pseo-clay-lift:hover { transform: translateY(-3px); }
      .pseo-clay-faq summary { list-style: none; }
      .pseo-clay-faq summary::-webkit-details-marker { display: none; }
      .pseo-clay-chevron svg { transition: transform 0.2s ease; }
      .pseo-clay-faq details[open] .pseo-clay-chevron svg { transform: rotate(180deg); }
      @media (min-width: 769px) and (max-width: 1024px) {
        .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pseo-clay-bento { grid-template-columns: repeat(6, minmax(0, 1fr)); }
        .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 6; }
      }
      @media (max-width: 768px) {
        .pseo-clay-cols-2, .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-bento { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-span-3, .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 1; }
        .pseo-clay-split { grid-template-columns: minmax(0, 1fr); }
      }
      @media (prefers-reduced-motion: reduce) {
        .pseo-clay-lift { transition: none; }
        .pseo-clay-lift:hover { transform: none; }
        .pseo-clay-chevron svg { transition: none; }
      }
      </style><div class="pseo-clay-bento"><div class="pseo-clay-card pseo-clay-span-8 pseo-clay-split" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:0;overflow:hidden"><div style="padding:32px 28px;display:flex;flex-direction:column;justify-content:center"><h3 style="font-size:20px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Multi-state licensure</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">Care for patients in more than one state.</p></div><div style="position:relative;overflow:hidden;min-height:240px;background:#f2eee9"><div aria-hidden="true" style="position:absolute;top:0;bottom:0;height:auto;left:0;aspect-ratio:1;transform-origin:left center;transform:scaleX(40)"><img alt="" loading="lazy" decoding="async" data-nimg="fill" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;object-fit:fill;color:transparent" sizes="300px" srcSet="/_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=64&amp;q=75 64w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=96&amp;q=75 96w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=128&amp;q=75 128w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=256&amp;q=75 256w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=750&amp;q=75 750w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=828&amp;q=75 828w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=1080&amp;q=75 1080w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=1920&amp;q=75 1920w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=2048&amp;q=75 2048w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=3840&amp;q=75"/></div><div aria-hidden="true" style="position:absolute;top:0;bottom:0;height:auto;right:0;aspect-ratio:1;transform-origin:right center;transform:scaleX(40)"><img alt="" loading="lazy" decoding="async" data-nimg="fill" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;object-fit:fill;color:transparent" sizes="300px" srcSet="/_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=64&amp;q=75 64w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=96&amp;q=75 96w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=128&amp;q=75 128w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=256&amp;q=75 256w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=750&amp;q=75 750w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=828&amp;q=75 828w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=1080&amp;q=75 1080w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=1920&amp;q=75 1920w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=2048&amp;q=75 2048w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=3840&amp;q=75"/></div><div style="position:absolute;top:0;bottom:0;height:auto;left:50%;transform:translateX(-50%);aspect-ratio:1;max-width:100%"><img alt="Multi-state licensure map" loading="lazy" decoding="async" data-nimg="fill" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;object-fit:contain;color:transparent" sizes="300px" srcSet="/_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=64&amp;q=75 64w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=96&amp;q=75 96w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=128&amp;q=75 128w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=256&amp;q=75 256w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=750&amp;q=75 750w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=828&amp;q=75 828w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=1080&amp;q=75 1080w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=1920&amp;q=75 1920w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=2048&amp;q=75 2048w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fmultistate-map.webp&amp;w=3840&amp;q=75"/></div></div></div><div class="pseo-clay-card pseo-clay-span-4" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:0;overflow:hidden;display:flex;flex-direction:column"><div style="position:relative;overflow:hidden;min-height:200px;background:#e8e7e2"><div aria-hidden="true" style="position:absolute;top:0;bottom:0;height:auto;left:0;aspect-ratio:1;transform-origin:left center;transform:scaleX(40)"><img alt="" loading="lazy" decoding="async" data-nimg="fill" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;object-fit:fill;color:transparent" sizes="250px" srcSet="/_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=64&amp;q=75 64w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=96&amp;q=75 96w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=128&amp;q=75 128w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=256&amp;q=75 256w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=750&amp;q=75 750w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=828&amp;q=75 828w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=1080&amp;q=75 1080w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=1920&amp;q=75 1920w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=2048&amp;q=75 2048w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=3840&amp;q=75"/></div><div aria-hidden="true" style="position:absolute;top:0;bottom:0;height:auto;right:0;aspect-ratio:1;transform-origin:right center;transform:scaleX(40)"><img alt="" loading="lazy" decoding="async" data-nimg="fill" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;object-fit:fill;color:transparent" sizes="250px" srcSet="/_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=64&amp;q=75 64w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=96&amp;q=75 96w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=128&amp;q=75 128w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=256&amp;q=75 256w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=750&amp;q=75 750w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=828&amp;q=75 828w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=1080&amp;q=75 1080w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=1920&amp;q=75 1920w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=2048&amp;q=75 2048w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=3840&amp;q=75"/></div><div style="position:absolute;top:0;bottom:0;height:auto;left:50%;transform:translateX(-50%);aspect-ratio:1;max-width:100%"><img alt="Salary chart" loading="lazy" decoding="async" data-nimg="fill" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;object-fit:contain;color:transparent" sizes="250px" srcSet="/_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=64&amp;q=75 64w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=96&amp;q=75 96w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=128&amp;q=75 128w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=256&amp;q=75 256w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=750&amp;q=75 750w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=828&amp;q=75 828w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=1080&amp;q=75 1080w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=1920&amp;q=75 1920w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=2048&amp;q=75 2048w, /_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fcategories%2Fbento%2Fstate-salary.webp&amp;w=3840&amp;q=75"/></div></div><div style="padding:24px 22px;flex:1;display:flex;flex-direction:column"><h3 style="font-size:16px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 6px">Posted pay</h3><p style="font-size:13px;color:#7A6A62;line-height:1.65;margin:0">Medians publish at 5 postings from 3 employers.</p></div></div><div class="pseo-clay-card pseo-clay-span-3" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px;text-align:center"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;margin-bottom:14px"><span style="background:#f4f4f4;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:72px;height:72px;border-radius:20px" aria-hidden="true"><img alt="" loading="lazy" width="48" height="48" decoding="async" data-nimg="1" style="color:transparent;width:48px;height:48px;object-fit:contain" sizes="48px" srcSet="/_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=64&amp;q=75 64w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=96&amp;q=75 96w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=128&amp;q=75 128w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=256&amp;q=75 256w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=750&amp;q=75 750w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=828&amp;q=75 828w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=1080&amp;q=75 1080w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=1920&amp;q=75 1920w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=2048&amp;q=75 2048w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fremote.webp&amp;w=3840&amp;q=75"/></span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Flexible hours</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">Design a schedule around your life.</p></div><div class="pseo-clay-card pseo-clay-span-3" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px;text-align:center"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;margin-bottom:14px"><span style="background:#F9F7F1;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:72px;height:72px;border-radius:20px" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#BE185D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-house" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"></path><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg></span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Home office</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">A quiet, well-lit room with a locked door.</p></div></div>"
    `);
  });

  it('StepsBand markup', () => {
    expect(renders.StepsBand).toMatchInlineSnapshot(`
      "<style data-precedence="default" data-href="pseo-clay">
      .pseo-clay-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
      .pseo-clay-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .pseo-clay-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .pseo-clay-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
      .pseo-clay-span-3 { grid-column: span 3; }
      .pseo-clay-span-4 { grid-column: span 4; }
      .pseo-clay-span-6 { grid-column: span 6; }
      .pseo-clay-span-8 { grid-column: span 8; }
      .pseo-clay-span-12 { grid-column: span 12; }
      .pseo-clay-split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-lift { transition: transform 0.25s ease; }
      .pseo-clay-lift:hover { transform: translateY(-3px); }
      .pseo-clay-faq summary { list-style: none; }
      .pseo-clay-faq summary::-webkit-details-marker { display: none; }
      .pseo-clay-chevron svg { transition: transform 0.2s ease; }
      .pseo-clay-faq details[open] .pseo-clay-chevron svg { transform: rotate(180deg); }
      @media (min-width: 769px) and (max-width: 1024px) {
        .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pseo-clay-bento { grid-template-columns: repeat(6, minmax(0, 1fr)); }
        .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 6; }
      }
      @media (max-width: 768px) {
        .pseo-clay-cols-2, .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-bento { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-span-3, .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 1; }
        .pseo-clay-split { grid-template-columns: minmax(0, 1fr); }
      }
      @media (prefers-reduced-motion: reduce) {
        .pseo-clay-lift { transition: none; }
        .pseo-clay-lift:hover { transform: none; }
        .pseo-clay-chevron svg { transition: none; }
      }
      </style><div class="pseo-clay-grid pseo-clay-cols-3"><div class="pseo-clay-card" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:28px 24px;border-top:3px solid #BE185D"><span style="display:block;margin-bottom:12px;font-size:28px;font-weight:800;line-height:1;color:#BE185D;opacity:0.4;font-family:var(--font-mono)">01</span><h3 style="font-size:15px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Platform setup</h3><p style="font-size:13px;color:#5A4A42;line-height:1.65;margin:0">Most employers provide the telehealth platform.</p></div><div class="pseo-clay-card" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:28px 24px;border-top:3px solid #BE185D"><span style="display:block;margin-bottom:12px;font-size:28px;font-weight:800;line-height:1;color:#BE185D;opacity:0.4;font-family:var(--font-mono)">02</span><h3 style="font-size:15px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Licensure</h3><p style="font-size:13px;color:#5A4A42;line-height:1.65;margin:0">Plan for a license in every state where your patients are.</p></div><div class="pseo-clay-card" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:28px 24px;border-top:3px solid #BE185D"><span style="display:block;margin-bottom:12px;font-size:28px;font-weight:800;line-height:1;color:#BE185D;opacity:0.4;font-family:var(--font-mono)">03</span><h3 style="font-size:15px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Equipment</h3><p style="font-size:13px;color:#5A4A42;line-height:1.65;margin:0">Reliable internet, a webcam and a headset.</p></div></div>"
    `);
  });

  it('ExploreGrid markup', () => {
    expect(renders.ExploreGrid).toMatchInlineSnapshot(`
      "<style data-precedence="default" data-href="pseo-clay">
      .pseo-clay-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
      .pseo-clay-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .pseo-clay-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .pseo-clay-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
      .pseo-clay-span-3 { grid-column: span 3; }
      .pseo-clay-span-4 { grid-column: span 4; }
      .pseo-clay-span-6 { grid-column: span 6; }
      .pseo-clay-span-8 { grid-column: span 8; }
      .pseo-clay-span-12 { grid-column: span 12; }
      .pseo-clay-split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-lift { transition: transform 0.25s ease; }
      .pseo-clay-lift:hover { transform: translateY(-3px); }
      .pseo-clay-faq summary { list-style: none; }
      .pseo-clay-faq summary::-webkit-details-marker { display: none; }
      .pseo-clay-chevron svg { transition: transform 0.2s ease; }
      .pseo-clay-faq details[open] .pseo-clay-chevron svg { transform: rotate(180deg); }
      @media (min-width: 769px) and (max-width: 1024px) {
        .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pseo-clay-bento { grid-template-columns: repeat(6, minmax(0, 1fr)); }
        .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 6; }
      }
      @media (max-width: 768px) {
        .pseo-clay-cols-2, .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-bento { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-span-3, .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 1; }
        .pseo-clay-split { grid-template-columns: minmax(0, 1fr); }
      }
      @media (prefers-reduced-motion: reduce) {
        .pseo-clay-lift { transition: none; }
        .pseo-clay-lift:hover { transform: none; }
        .pseo-clay-chevron svg { transition: none; }
      }
      </style><div class="pseo-clay-grid pseo-clay-cols-3"><a class="pseo-clay-card pseo-clay-lift" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px;text-align:center;display:block;text-decoration:none;color:inherit" href="/jobs/telehealth"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;margin-bottom:14px"><span style="background:#f6f6f6;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:72px;height:72px;border-radius:20px" aria-hidden="true"><img alt="" loading="lazy" width="48" height="48" decoding="async" data-nimg="1" style="color:transparent;width:48px;height:48px;object-fit:contain" sizes="48px" srcSet="/_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=64&amp;q=75 64w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=96&amp;q=75 96w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=128&amp;q=75 128w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=256&amp;q=75 256w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=750&amp;q=75 750w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=828&amp;q=75 828w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=1080&amp;q=75 1080w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=1920&amp;q=75 1920w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=2048&amp;q=75 2048w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fcategories%2Fnav%2Ftelehealth.webp&amp;w=3840&amp;q=75"/></span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Telehealth</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">Virtual patient care</p><span style="display:inline-flex;align-items:center;gap:4px;margin-top:12px;font-size:12px;font-weight:700;color:#BE185D">Explore<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></span></a><a class="pseo-clay-card pseo-clay-lift" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px;text-align:center;display:block;text-decoration:none;color:inherit" href="/jobs/oncology"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;margin-bottom:14px"><span style="background:#F9F7F1;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:72px;height:72px;border-radius:20px" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#BE185D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-ribbon" aria-hidden="true"><path d="M12 11.22C11 9.997 10 9 10 8a2 2 0 0 1 4 0c0 1-.998 2.002-2.01 3.22"></path><path d="m12 18 2.57-3.5"></path><path d="M6.243 9.016a7 7 0 0 1 11.507-.009"></path><path d="M9.35 14.53 12 11.22"></path><path d="M9.35 14.53C7.728 12.246 6 10.221 6 7a6 5 0 0 1 12 0c-.005 3.22-1.778 5.235-3.43 7.5l3.557 4.527a1 1 0 0 1-.203 1.43l-1.894 1.36a1 1 0 0 1-1.384-.215L12 18l-2.679 3.593a1 1 0 0 1-1.39.213l-1.865-1.353a1 1 0 0 1-.203-1.422z"></path></svg></span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Oncology</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">Cancer care roles</p><span style="display:inline-flex;align-items:center;gap:4px;margin-top:12px;font-size:12px;font-weight:700;color:#BE185D">Explore<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></span></a><a class="pseo-clay-card pseo-clay-lift" style="background:#FFFFFF;border-radius:20px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);padding:24px;text-align:center;display:block;text-decoration:none;color:inherit" href="/salary-guide"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;margin-bottom:14px"><span style="background:#ffffff;border:1px solid #EAE6DF;box-shadow:inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:72px;height:72px;border-radius:20px" aria-hidden="true"><img alt="" loading="lazy" width="48" height="48" decoding="async" data-nimg="1" style="color:transparent;width:48px;height:48px;object-fit:contain" sizes="48px" srcSet="/_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=32&amp;q=75 32w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=48&amp;q=75 48w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=64&amp;q=75 64w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=96&amp;q=75 96w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=128&amp;q=75 128w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=256&amp;q=75 256w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=750&amp;q=75 750w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=828&amp;q=75 828w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=1080&amp;q=75 1080w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=1200&amp;q=75 1200w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=1920&amp;q=75 1920w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=2048&amp;q=75 2048w, /_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=3840&amp;q=75 3840w" src="/_next/image?url=%2Fimages%2Fcategories%2Fnav%2Fsalary.webp&amp;w=3840&amp;q=75"/></span></div><h3 style="font-size:17px;font-weight:800;color:#1A2E35;line-height:1.3;margin:0 0 8px">Salary guide</h3><p style="font-size:14px;color:#5A4A42;line-height:1.65;margin:0">Posted pay by state</p><span style="display:inline-flex;align-items:center;gap:4px;margin-top:12px;font-size:12px;font-weight:700;color:#BE185D">Explore<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></span></a></div>"
    `);
  });

  it('InlineFaq markup', () => {
    expect(renders.InlineFaq).toMatchInlineSnapshot(`
      "<style data-precedence="default" data-href="pseo-clay">
      .pseo-clay-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
      .pseo-clay-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .pseo-clay-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .pseo-clay-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
      .pseo-clay-span-3 { grid-column: span 3; }
      .pseo-clay-span-4 { grid-column: span 4; }
      .pseo-clay-span-6 { grid-column: span 6; }
      .pseo-clay-span-8 { grid-column: span 8; }
      .pseo-clay-span-12 { grid-column: span 12; }
      .pseo-clay-split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pseo-clay-lift { transition: transform 0.25s ease; }
      .pseo-clay-lift:hover { transform: translateY(-3px); }
      .pseo-clay-faq summary { list-style: none; }
      .pseo-clay-faq summary::-webkit-details-marker { display: none; }
      .pseo-clay-chevron svg { transition: transform 0.2s ease; }
      .pseo-clay-faq details[open] .pseo-clay-chevron svg { transform: rotate(180deg); }
      @media (min-width: 769px) and (max-width: 1024px) {
        .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pseo-clay-bento { grid-template-columns: repeat(6, minmax(0, 1fr)); }
        .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 6; }
      }
      @media (max-width: 768px) {
        .pseo-clay-cols-2, .pseo-clay-cols-3, .pseo-clay-cols-4 { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-bento { grid-template-columns: minmax(0, 1fr); }
        .pseo-clay-span-3, .pseo-clay-span-4, .pseo-clay-span-6, .pseo-clay-span-8, .pseo-clay-span-12 { grid-column: span 1; }
        .pseo-clay-split { grid-template-columns: minmax(0, 1fr); }
      }
      @media (prefers-reduced-motion: reduce) {
        .pseo-clay-lift { transition: none; }
        .pseo-clay-lift:hover { transform: none; }
        .pseo-clay-chevron svg { transition: none; }
      }
      </style><div><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How many remote listings are open?","acceptedAnswer":{"@type":"Answer","text":"There are 12 current remote listings from 3 employers."}},{"@type":"Question","name":"What do remote listings pay?","acceptedAnswer":{"@type":"Answer","text":"The median posted pay is $128K across 7 listings. \\u003cscript\\u003e stays escaped."}}]}</script><div style="text-align:center;margin-bottom:40px"><p style="font-size:13px;font-weight:600;color:#E86C2C;text-transform:uppercase;letter-spacing:0.15em;margin:0 0 8px">Questions</p><h2 id="faq" class="font-lora" style="font-size:clamp(24px, 3.2vw, 34px);font-weight:700;color:#1A2E35;line-height:1.2;margin:0">Remote FAQ</h2></div><div class="pseo-clay-faq" style="display:grid;gap:12px"><details style="background:#FFFFFF;border-radius:16px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);overflow:hidden" open=""><summary style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px;cursor:pointer"><h3 style="font-size:15px;font-weight:600;color:#1A2E35;line-height:1.4;margin:0">How many remote listings are open?</h3><span class="pseo-clay-chevron" aria-hidden="true" style="width:28px;height:28px;border-radius:8px;background:#FDF2F8;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#BE185D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></span></summary><div style="padding:0 24px 20px;border-top:1px solid rgba(0,0,0,0.04)"><p class="faq-answer" style="font-size:14px;color:#5A4A42;line-height:1.7;margin:16px 0 0">There are 12 current remote listings from 3 employers.</p></div></details><details style="background:#FFFFFF;border-radius:16px;border:1px solid rgba(255,255,255,0.5);box-shadow:6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02);overflow:hidden"><summary style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px;cursor:pointer"><h3 style="font-size:15px;font-weight:600;color:#1A2E35;line-height:1.4;margin:0">What do remote listings pay?</h3><span class="pseo-clay-chevron" aria-hidden="true" style="width:28px;height:28px;border-radius:8px;background:#FDF2F8;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#BE185D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></span></summary><div style="padding:0 24px 20px;border-top:1px solid rgba(0,0,0,0.04)"><p class="faq-answer" style="font-size:14px;color:#5A4A42;line-height:1.7;margin:16px 0 0">The median posted pay is $128K across 7 listings. &lt;script&gt; stays escaped.</p></div></details></div></div>"
    `);
  });
});
