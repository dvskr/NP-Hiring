/**
 * P1 #18 regression pins — employer content hub (/for-employers/resources).
 *
 * The hub ships two evergreen hiring guides plus the public JD-template
 * library rendered from the frozen lib/jd-templates.ts registry. These
 * pins enforce the audit's truth rules on the new surface:
 *
 *  - Template pages DERIVE from JD_TEMPLATES (read-only consume) — no
 *    hand-copied template inventory that could drift from the post-job
 *    wizard's starter panel.
 *  - Guide statistics come from lib/stats-sources.ts /
 *    config/niche/salary.ts imports, never typed inline.
 *  - Article dateModified renders a review-date constant — never
 *    new Date() (fabricated-freshness rule, audit P0 #23).
 *  - JSON-LD derives from the same arrays the visible content renders,
 *    serialized through the < escape chain.
 *  - The template-detail CTA links to /post-job WITHOUT inventing a
 *    template query param (the wizard reads only `resume` today, and
 *    post-job belongs to another workstream).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JD_TEMPLATES, renderTemplate } from '@/lib/jd-templates';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const HUB = 'app/for-employers/resources/page.tsx';
const HOW_TO_HIRE = 'app/for-employers/resources/how-to-hire/page.tsx';
const JD_GUIDE = 'app/for-employers/resources/job-description-guide/page.tsx';
const LIBRARY = 'app/for-employers/resources/job-description-templates/page.tsx';
const DETAIL = 'app/for-employers/resources/job-description-templates/[id]/page.tsx';
const ALL_PAGES = [HUB, HOW_TO_HIRE, JD_GUIDE, LIBRARY, DETAIL];

// Raw-source spelling of the JSON-LD escape chain (escaped backslash —
// same convention as p1-eeat-editorial-trust.test.ts).
const ESCAPE_CHAIN = ".replace(/</g, '\\\\u003c').replace(/>/g, '\\\\u003e')";

describe('P1 #18: employer content hub pages exist', () => {
  it.each(ALL_PAGES)('%s exists', (rel) => {
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
  });

  it('every page ships canonical metadata and breadcrumbs', () => {
    for (const rel of ALL_PAGES) {
      const src = read(rel);
      expect(src, rel).toContain('alternates: { canonical:');
      expect(src, rel).toContain('Breadcrumbs');
    }
  });

  it('every page escapes its JSON-LD with the \\u003c chain', () => {
    for (const rel of ALL_PAGES) {
      const src = read(rel);
      expect(src, rel).toContain(ESCAPE_CHAIN);
    }
  });
});

describe('P1 #18: template surfaces derive from the frozen registry', () => {
  it('the registry ships 12 templates with unique ids (public route inventory)', () => {
    expect(JD_TEMPLATES.length).toBe(12);
    expect(new Set(JD_TEMPLATES.map((t) => t.id)).size).toBe(12);
  });

  it.each([HUB, LIBRARY, DETAIL])('%s imports lib/jd-templates instead of hardcoding the inventory', (rel) => {
    const src = read(rel);
    expect(src).toContain("from '@/lib/jd-templates'");
    expect(src).toContain('JD_TEMPLATES');
  });

  it('the detail page statically generates one route per registry entry', () => {
    const src = read(DETAIL);
    expect(src).toContain('generateStaticParams');
    expect(src).toContain('JD_TEMPLATES.map((t) => ({ id: t.id }))');
    expect(src).toContain('notFound()');
  });

  it('the detail page renders the registry body via renderTemplate fallbacks', () => {
    const src = read(DETAIL);
    expect(src).toContain('renderTemplate(template, {})');
  });

  it('template pages do not overclaim what the wizard auto-fills', () => {
    // components/post-job/JdStarterPanel.tsx:527-531 calls renderTemplate
    // with { employer, city: '', state: formContext.location } — the city
    // token is never populated, so copy promising a city auto-fill would
    // be false. Only practice name + location may be claimed.
    for (const rel of [LIBRARY, DETAIL]) {
      expect(read(rel), rel).not.toMatch(/city,? and state/i);
    }
  });

  it('the detail CTA links to /post-job without inventing a template query param', () => {
    const src = read(DETAIL);
    expect(src).toContain('href="/post-job"');
    // The wizard reads only `resume` (app/post-job/page.tsx); a template
    // param would be a dead link contract until that workstream adds one.
    expect(src).not.toContain('template=');
    expect(src).not.toContain('post-job?');
  });
});

/**
 * The guide's headline claim is that its anatomy IS the skeleton the
 * registry emits ("the same structure every skeleton in our template
 * library uses"). Nothing enforced that, and it was wrong on first
 * ship: JD_ANATOMY listed 8 sections while buildTemplate() emits 9,
 * omitting "Why join us". The false count was also serialized into the
 * FAQPage JSON-LD, so it shipped to rich results.
 *
 * These pins make the claim structural: the anatomy names are read out
 * of the guide source and compared to the headings renderTemplate()
 * actually produces, and the prose count word is derived from that same
 * length. Adding a section to buildTemplate() without updating the
 * guide (or vice versa) now fails here.
 */
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
] as const;

/** `<h2>`/`<h3>` heading text, in document order, from rendered template HTML. */
const renderedHeadings = (html: string): string[] =>
  [...html.matchAll(/<h[23]>(.*?)<\/h[23]>/g)].map((m) => m[1]);

/** The ordered `section:` labels declared in the guide's JD_ANATOMY array. */
function anatomySections(src: string): string[] {
  const start = src.indexOf('const JD_ANATOMY = [');
  expect(start, 'JD_ANATOMY declaration not found in the guide').toBeGreaterThan(-1);
  const end = src.indexOf('] as const;', start);
  expect(end, 'JD_ANATOMY terminator not found').toBeGreaterThan(start);
  const block = src.slice(start, end);
  return [...block.matchAll(/^\s*section: '([^']+)',$/gm)].map((m) => m[1]);
}

describe('P1 #18: the guide anatomy is pinned to the template registry', () => {
  it('every registry template emits the identical heading sequence', () => {
    const [first, ...rest] = JD_TEMPLATES.map((t) => renderedHeadings(renderTemplate(t, {})));
    expect(first.length).toBeGreaterThan(0);
    for (const headings of rest) {
      expect(headings).toEqual(first);
    }
  });

  it('JD_ANATOMY matches the sections buildTemplate() actually emits', () => {
    const sections = anatomySections(read(JD_GUIDE));
    const headings = renderedHeadings(renderTemplate(JD_TEMPLATES[0], {}));

    // Same count — the claim the guide makes in prose.
    expect(sections).toHaveLength(headings.length);

    // The "About …" heading is templated with {{employer}}, so it is
    // matched by prefix; every other section must match exactly, in order.
    expect(sections[0]).toMatch(/^About /);
    expect(headings[0]).toMatch(/^About /);
    expect(sections.slice(1)).toEqual(headings.slice(1));

    // Explicit guard for the section that was missing on first ship.
    expect(sections).toContain('Why join us');
  });

  it('the prose section count on both surfaces matches JD_ANATOMY', () => {
    const expected = NUMBER_WORDS[anatomySections(read(JD_GUIDE)).length];
    expect(expected, 'anatomy longer than the number-word table').toBeDefined();

    for (const rel of [JD_GUIDE, LIBRARY, DETAIL, HUB]) {
      const claims = [
        ...read(rel).matchAll(
          new RegExp(`\\b(${NUMBER_WORDS.join('|')})[- ]sections?\\b`, 'gi'),
        ),
      ].map((m) => m[1].toLowerCase());
      for (const claim of claims) {
        expect(claim, `${rel} claims a "${claim}-section" structure`).toBe(expected);
      }
    }
  });

  it('the FAQ answer feeding FAQPage JSON-LD states the pinned count', () => {
    const src = read(JD_GUIDE);
    const expected = NUMBER_WORDS[anatomySections(src).length];
    // FAQS[0].a is serialized into the FAQPage schema, so a wrong count
    // here ships to Google rich results, not just the visible page.
    expect(src).toContain(`a: \`${expected.charAt(0).toUpperCase()}${expected.slice(1)} sections:`);
  });
});

describe('P1 #18: guide truth rules', () => {
  it.each([HOW_TO_HIRE, JD_GUIDE])('%s renders honest review dates into Article schema', (rel) => {
    const src = read(rel);
    expect(src).toContain('dateModified: LAST_REVIEWED');
    expect(src).toContain('datePublished: PUBLISHED_AT');
    // Fabricated-freshness guard (audit P0 #23): no live clock feeding
    // schema or "Last reviewed" copy. Rendering the constant through
    // Date(`${LAST_REVIEWED}...`) is fine; a zero-arg `new Date()` fed
    // into schema fields or date rendering is not.
    expect(src).not.toMatch(/:\s*new Date\(\)/);
    expect(src).not.toMatch(/new Date\(\)\.toLocale/);
  });

  it('how-to-hire sources every figure from repo data, never inline', () => {
    const src = read(HOW_TO_HIRE);
    expect(src).toContain("from '@/lib/stats-sources'");
    expect(src).toContain("from '@/config/niche/salary'");
    expect(src).toContain('STAT_SOURCES.averageSalary');
    expect(src).toContain('salaryConfig.normalizer.typical');
    // No literal dollar figures typed into the page source — every
    // rendered number must flow through the imports above.
    expect(src).not.toMatch(/\$\d/);
  });

  it('jd-guide contains no dollar figures at all (evergreen craft guide)', () => {
    expect(read(JD_GUIDE)).not.toMatch(/\$\d/);
  });

  it('how-to-hire names the correct certification body per role', () => {
    const src = read(HOW_TO_HIRE);
    // NPs certify via AANP/ANCC; the APRN-cohort note must name NBCRNA
    // (CRNA) and AMCB (CNM) — never blur them together.
    expect(src).toContain('AANP or ANCC');
    expect(src).toContain('NBCRNA');
    expect(src).toContain('AMCB');
  });

  it('state-licensure specifics defer to the state board, not invented facts', () => {
    const src = read(HOW_TO_HIRE);
    expect(src).toContain('state board of nursing');
    expect(src).toContain('STAT_SOURCES.fullPracticeStates.sourceUrl');
  });

  it.each([HOW_TO_HIRE, JD_GUIDE])('%s derives FAQPage JSON-LD from the same FAQS array the page renders', (rel) => {
    const src = read(rel);
    expect(src).toContain("'@type': 'FAQPage'");
    expect(src).toContain('FAQS.map(({ q, a })');
    // Visible render of the same array.
    expect(src).toContain('{FAQS.map(({ q, a }) =>');
  });

  it.each(ALL_PAGES)('%s carries no reference-niche copy (ratchet belt-and-braces)', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/PMHNP|psychiatric|mental[ -]health/i);
  });
});

describe('P1 #18: /for-employers links into the hub', () => {
  it('the employer landing page links the hub and all three resources', () => {
    const src = read('app/for-employers/page.tsx');
    expect(src).toContain('href="/for-employers/resources"');
    expect(src).toContain("href: '/for-employers/resources/how-to-hire'");
    expect(src).toContain("href: '/for-employers/resources/job-description-guide'");
    expect(src).toContain("href: '/for-employers/resources/job-description-templates'");
  });
});
