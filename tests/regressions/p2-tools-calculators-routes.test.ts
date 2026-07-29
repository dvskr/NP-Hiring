/**
 * P2 #4 / #5 / #6 / #17 — structural guards for the /tools package.
 *
 * The four tools are indexable SEO surfaces as much as they are widgets, so
 * these tests pin the properties that make them worth indexing and safe to
 * publish:
 *
 *   - every registry path has a real route (the drift rule that governs
 *     SALARY_SPECIALTY_SLUGS and JD_TEMPLATES);
 *   - each route ships canonical metadata, FAQPage JSON-LD escaped with the
 *     repo's < chain, and a VISIBLE assumptions panel — a calculator that
 *     hides its assumptions is the thing this package exists to avoid;
 *   - the public benchmark never reaches for the auth-gated employer
 *     analytics endpoint, and the 4,135-city dataset never reaches a client
 *     component;
 *   - every tool control is a labelled, keyboard-operable form element.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { TOOLS, TOOL_PATHS, TOOLS_HUB_PATH } from '@/app/tools/tools-registry';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

/** Source with block and line comments removed — prose about JSX is not JSX. */
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Route source file for a /tools path. */
const routeFile = (toolPath: string) => `app${toolPath}/page.tsx`;

/**
 * Source with every `jsonLd({ ... })` call removed, so what remains is the
 * markup a reader actually sees. Paren-matched rather than regexed because the
 * schema objects nest braces and contain `)` inside strings is not a concern
 * but nested calls are.
 *
 * This is how the visible-content tests below tell "rendered on the page" from
 * "serialized into structured data" — the distinction the HowTo bug turned on.
 */
function stripJsonLd(src: string): string {
  const NEEDLE = 'jsonLd(';
  let out = '';
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf(NEEDLE, i);
    if (start === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, start);
    let depth = 0;
    let j = start + NEEDLE.length - 1;
    for (; j < src.length; j += 1) {
      if (src[j] === '(') depth += 1;
      else if (src[j] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
  return out;
}

const TOOL_COMPONENT_DIR = 'components/tools';

function toolComponentFiles(): string[] {
  return fs
    .readdirSync(path.join(ROOT, TOOL_COMPONENT_DIR))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `${TOOL_COMPONENT_DIR}/${f}`);
}

describe('tools registry ↔ routes', () => {
  it('advertises four tools plus a hub', () => {
    expect(TOOLS.length).toBe(4);
    expect(TOOL_PATHS.length).toBe(TOOLS.length);
    expect(new Set(TOOL_PATHS).size).toBe(TOOL_PATHS.length);
    expect(exists(`app${TOOLS_HUB_PATH}/page.tsx`)).toBe(true);
  });

  it.each([...TOOL_PATHS])('%s resolves to a route file', (toolPath) => {
    expect(toolPath.startsWith('/tools/')).toBe(true);
    expect(exists(routeFile(toolPath))).toBe(true);
  });

  it('covers both audiences', () => {
    const audiences = new Set(TOOLS.map((t) => t.audience));
    expect(audiences.has('seeker')).toBe(true);
    expect(audiences.has('employer')).toBe(true);
  });

  it('stays a plain data module the sitemap can import safely', () => {
    const src = read('app/tools/tools-registry.ts');
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['@/config/brand']);
  });
});

describe.each([...TOOL_PATHS])('%s route', (toolPath) => {
  const src = read(routeFile(toolPath));

  it('declares a canonical URL', () => {
    expect(src).toMatch(/alternates:\s*\{\s*canonical/);
  });

  it('emits FAQPage JSON-LD from the same array the page renders', () => {
    expect(src).toContain("'@type': 'FAQPage'");
    // The visible accordion must map the same FAQS constant the schema does.
    expect(src).toMatch(/FAQS\.map\(\(\{ q, a \}\) => \(/);
  });

  it('escapes serialized JSON-LD with the repo pattern', () => {
    expect(src).toContain("replace(/</g, '\\\\u003c').replace(/>/g, '\\\\u003e')");
  });

  it('renders a visible assumptions panel', () => {
    expect(src).toContain('AssumptionsPanel');
    expect(src).toMatch(/assumptions=\{/);
  });

  it('renders visible breadcrumbs, not schema-only ones', () => {
    expect(src).toContain("from '@/components/Breadcrumbs'");
    expect(src).toContain("label: 'Tools', href: '/tools'");
  });

  it('cross-links to other surfaces', () => {
    expect(src).toContain('<Link');
  });

  it('hardcodes no niche name in copy', () => {
    // Niche identity always comes from config/brand.ts.
    expect(src).not.toMatch(/\bNurse Practitioners?\b/);
    expect(src).not.toMatch(/\bPMHNP\b/);
  });
});

describe('1099 vs W-2 calculator (P2 #4)', () => {
  const src = read(routeFile('/tools/1099-vs-w2-calculator'));

  it('states the tax-year model from the module the math uses', () => {
    expect(src).toContain("from '@/components/tools/federal-tax-model'");
    expect(src).toContain('TAX_MODEL_YEAR');
    expect(src).toContain('TAX_MODEL_SOURCES');
    expect(src).toContain('TAX_MODEL_EXCLUSIONS');
  });

  it('says on the page that state income tax is excluded', () => {
    expect(src.toLowerCase()).toContain('state and local income tax');
  });

  it('derives its salary placeholders from the niche salary config', () => {
    const component = read('components/tools/TakeHomeCalculator.tsx');
    expect(component).toContain("from '@/config/niche/salary'");
    expect(component).toContain('salaryConfig.normalizer.typical');
  });

  /**
   * HowTo JSON-LD used to mark up steps that rendered NOWHERE on the page:
   * HOW_TO_STEPS was consumed only by the schema script, while the page showed
   * a hero, the calculator, the assumptions panel, FAQs and cross-links. That
   * is content marked up but not visible to readers, which Google's
   * structured-data general guidelines prohibit — and it contradicted the
   * repo's own HowTo precedent at /resources/private-practice-guide, which
   * renders the same `steps` array it feeds to schema.
   *
   * The previous guard asserted only that the string 'HOW_TO_STEPS.map'
   * appeared somewhere, which the broken version satisfied. These assert the
   * array survives removal of the JSON-LD.
   */
  it('carries HowTo schema whose steps are real tool steps', () => {
    expect(src).toContain("'@type': 'HowTo'");
    expect(src).toContain('HOW_TO_STEPS.map');
  });

  it('renders the HowTo steps visibly, not only inside the JSON-LD', () => {
    const visible = stripJsonLd(readCode(routeFile('/tools/1099-vs-w2-calculator')));
    expect(visible).not.toContain("'@type': 'HowTo'");
    expect(visible).toContain('HOW_TO_STEPS.map');
    // The step name and body both reach the DOM, not just the array reference.
    expect(visible).toMatch(/\{step\.name\}/);
    expect(visible).toMatch(/\{step\.text\}/);
  });

  it('gives the visible step list a heading a reader can find it by', () => {
    const visible = stripJsonLd(read(routeFile('/tools/1099-vs-w2-calculator')));
    expect(visible.toLowerCase()).toMatch(/how to compare/);
  });
});

/**
 * Generalizes the HowTo rule to the whole package: any tool route that ships
 * HowTo structured data must also render the array it serialized. A future
 * tool cannot reintroduce the same defect on a different page.
 */
describe.each([...TOOL_PATHS])('%s — structured data describes visible content', (toolPath) => {
  const src = readCode(routeFile(toolPath));

  it('renders the source array of any HowTo schema it emits', () => {
    if (!src.includes("'@type': 'HowTo'")) return;
    const stepArray = src.match(/step:\s*([A-Z_][A-Z0-9_]*)\.map/);
    expect(stepArray).not.toBeNull();
    const arrayName = stepArray![1];
    const visible = stripJsonLd(src);
    expect(visible).toContain(`${arrayName}.map`);
  });

  it('renders the source array of its FAQPage schema', () => {
    expect(src).toContain("'@type': 'FAQPage'");
    expect(stripJsonLd(src)).toContain('FAQS.map');
  });
});

describe('cost-of-living comparator (P2 #5)', () => {
  it('keeps the 4,135-city dataset on the server', () => {
    const dataModule = read('components/tools/city-picker-data.ts');
    expect(dataModule).toContain("from '@/lib/pseo/city-data/cities'");
    expect(dataModule).not.toContain("'use client'");

    const clientComponent = readCode('components/tools/CostOfLivingComparator.tsx');
    expect(clientComponent).toContain("'use client'");
    expect(clientComponent).not.toContain('city-data/cities');
    // The only link to the data module is a type-only import, which is erased
    // at build time — the option list itself arrives as props from the server.
    expect(clientComponent).toContain("import type { CityOption } from './city-picker-data'");
    expect(clientComponent).not.toMatch(/import \{[^}]*\} from '\.\/city-picker-data'/);
  });

  it('excludes inferred-pay rows from the aggregation', () => {
    const src = read(routeFile('/tools/cost-of-living-comparison'));
    expect(src).toContain('salaryIsEstimated: false');
  });

  it('handles an aggregation failure without taking the route down', () => {
    const src = read(routeFile('/tools/cost-of-living-comparison'));
    expect(src).toContain('catch (error)');
    expect(src).toContain('logger.error');
  });

  /**
   * THE "ALWAYS AGREE" OVERCLAIM.
   *
   * The first FAQ answer used to end "so the numbers here and on our city pages
   * always agree", and that string is emitted verbatim into FAQPage JSON-LD —
   * published to Google as a fact. The formula does match, but the population
   * does not: this page filters `salaryIsEstimated: false` (correctly), while
   * getCityStats in app/jobs/city/[slug]/page.tsx, app/salary-guide/[state],
   * and the pSEO aggregation cron all aggregate WITHOUT that filter. Any city
   * carrying inferred-pay rows shows a different nominal here than on its own
   * city page, so the claim was false for exactly the cities it named.
   *
   * Excluding inferred pay is the right call; the overclaim was the defect.
   */
  it('publishes no claim that its figures always match the city pages', () => {
    const src = read(routeFile('/tools/cost-of-living-comparison'));
    const prose = src.replace(/\s+/g, ' ').toLowerCase();
    expect(prose).not.toContain('always agree');
    expect(prose).not.toMatch(/numbers here and on our city pages/);
  });

  it('discloses that it is stricter about inferred pay than the other surfaces', () => {
    const src = read(routeFile('/tools/cost-of-living-comparison'));
    const prose = src.replace(/\s+/g, ' ');
    // The accurate part of the claim survives...
    expect(prose).toContain('exactly the formula the rest of this site uses');
    // ...and the divergence it used to deny is stated.
    expect(prose.toLowerCase()).toContain('inferred');
    expect(prose.toLowerCase()).toMatch(/can differ|different nominal/);
  });
});

/**
 * THE CITY-LINK 404 GATE — structural half.
 *
 * The behavioural gate is unit-tested in p2-tools-calculators-models.test.ts
 * (cityJobsHref). These tests stop the component from going back to building
 * the URL itself, which is how the ungated `/jobs/city/${option.slug}` link
 * shipped in the first place.
 */
describe('cost-of-living comparator city links (P2 #5)', () => {
  const component = readCode('components/tools/CostOfLivingComparator.tsx');
  const dataModule = readCode('components/tools/city-picker-data.ts');

  it('never composes a /jobs/city URL in the client component', () => {
    expect(component).not.toMatch(/`\/jobs\/city\/\$\{/);
    expect(component).not.toContain('/jobs/city/');
  });

  it('renders the jobs link only when the server resolved one', () => {
    expect(component).toContain('option.jobsHref &&');
    expect(component).toContain('href={option.jobsHref}');
  });

  it('reuses the repo’s existing resolution guard rather than a second copy', () => {
    // cityLinkResolves and buildCitySlug are the functions the state directory
    // already ships for this exact trap; a private reimplementation here would
    // be free to drift away from what the city route actually parses.
    expect(dataModule).toContain('cityLinkResolves');
    expect(dataModule).toContain('buildCitySlug');
    expect(dataModule).toContain("from '@/app/jobs/locations/[state]/directory'");
  });

  it('keeps the state pay link ungated — /salary-guide/<state> always resolves', () => {
    expect(component).toContain('/salary-guide/${stateSlug(option.state)}');
  });
});

describe('licensure checker + multi-state planner (P2 #6)', () => {
  const src = read(routeFile('/tools/licensure-checker'));
  const PLANNER = 'components/tools/MultiStatePlanner.tsx';

  it('reuses the existing checker component rather than forking it', () => {
    expect(src).toContain("from '@/components/LicensureChecker'");
  });

  it('reads practice authority from the sourced regulatory module', () => {
    expect(src).toContain('STATE_PRACTICE_AUTHORITY');
    expect(src).toContain("from '@/lib/state-practice-authority'");
  });

  /**
   * THE COMPACT-MEMBERSHIP EMBARGO.
   *
   * LICENSE_GUIDE_NLC_NON_MEMBERS (lib/blog-license-guides.ts, mirrored in
   * lib/pseo/state-narrative.ts) is wrong in both directions as of 2026-07: it
   * omits Alaska, which is not an NLC member, and lists Connecticut, Rhode
   * Island and Washington as non-members when all three are members. NCSBN put
   * the count at 43 member jurisdictions; the set implies 38 of 51. The drift
   * test guarding it compares the two copies to each other, so it proves
   * consistency, not accuracy.
   *
   * The data is not this package's to fix, but turning it into a per-state
   * "no separate RN application" verdict IS this package's doing, and that is
   * personalized licensure advice on a YMYL surface. These tests keep it out
   * until the owner re-verifies the dataset against NCSBN.
   */
  describe('publishes no per-state compact-membership claim', () => {
    const surfaces = [routeFile('/tools/licensure-checker'), PLANNER];

    it.each(surfaces)('%s does not import the membership set', (file) => {
      expect(readCode(file)).not.toContain('LICENSE_GUIDE_NLC_NON_MEMBERS');
      expect(readCode(file)).not.toContain("from '@/lib/blog-license-guides'");
    });

    it('keeps membership out of the planner\'s per-state type', () => {
      // A PlannerState that cannot carry membership cannot render a verdict.
      const planner = readCode(PLANNER);
      expect(planner).not.toMatch(/nlcMember/);
      expect(planner).not.toMatch(/isNlcMember/);
    });

    it('renders no member / not-a-member badge or verdict', () => {
      const planner = readCode(PLANNER);
      expect(planner).not.toContain('Not in the compact');
      expect(planner).not.toContain('Compact member');
      expect(planner).not.toContain('no separate RN application');
    });

    it('publishes no derived "N of 51 are compact members" statistic', () => {
      const page = readCode(routeFile('/tools/licensure-checker'));
      expect(page).not.toMatch(/compactCount/);
      expect(page).not.toMatch(/jurisdictions are compact members/);
    });

    it('carries no hand-typed membership list of its own', () => {
      const planner = readCode(PLANNER);
      expect(planner).not.toContain('new Set([');
      // A state name in the planner source would mean a hardcoded list.
      for (const state of ['Alaska', 'California', 'Connecticut', 'Rhode Island', 'Washington']) {
        expect(planner).not.toContain(state);
      }
    });

    it('sends the reader to NCSBN for the current member list instead', () => {
      const planner = read(PLANNER);
      expect(planner).toContain('nursecompact.com');
      expect(planner).toContain('We do not publish a per-state member list here');
      // And the omission is declared where the page declares what it excludes.
      expect(src).toContain('Which specific states are Nurse Licensure Compact members');
    });
  });

  it('still states the compact rules, which are stable and correct', () => {
    // Removing the wrong per-state data must not remove the correct general
    // rules — they are the reason the section is worth reading.
    const planner = read(PLANNER).replace(/\s+/g, ' ');
    expect(planner).toContain('primary state of residence');
    expect(planner).toContain('never makes an APRN license portable');
    expect(planner).toContain('there is no multistate privilege to carry anywhere');
  });

  it('never claims the compact makes an APRN license portable', () => {
    const planner = read(PLANNER);
    expect(planner).toContain('issues its own APRN license');
    expect(src.toLowerCase()).toContain('aprn licensure is treated as state-by-state');
  });

  it('declines to state fees, CE hours, or processing times', () => {
    expect(src).toContain('Application fees, renewal cycles, CE hour requirements, and processing times');
  });
});

describe('employer salary benchmark (P2 #17)', () => {
  it('never calls the auth-gated employer analytics endpoint', () => {
    for (const file of [
      routeFile('/tools/salary-benchmark'),
      'components/tools/EmployerBenchmarkWidget.tsx',
      'components/tools/EmployerBenchmarkPicker.tsx',
      'components/tools/benchmark-model.ts',
    ]) {
      // A prose reference explaining WHY we don't call it is fine; a quoted
      // path (fetch target, rewrite, link) is not.
      expect(readCode(file)).not.toMatch(/['"`][^'"`]*\/api\/employer\/analytics/);
      expect(readCode(file)).not.toContain('fetch(');
    }
  });

  it('aggregates on the server and passes only summarized rows to the client', () => {
    const widget = read('components/tools/EmployerBenchmarkWidget.tsx');
    expect(widget).not.toContain("'use client'");
    expect(widget).toContain('summarizeBenchmarks');
    expect(widget).toContain('salaryIsEstimated: false');

    const picker = read('components/tools/EmployerBenchmarkPicker.tsx');
    expect(picker).toContain("'use client'");
    expect(picker).not.toContain('prisma');
  });

  it('is placed on /for-employers as well as its own route', () => {
    const employers = read('app/for-employers/page.tsx');
    expect(employers).toContain('EmployerBenchmarkWidget');
    expect(employers).toContain('/tools/salary-benchmark');
  });

  it('publishes the suppression thresholds on the page', () => {
    const src = read(routeFile('/tools/salary-benchmark'));
    expect(src).toContain('BENCHMARK_MIN_POSTINGS');
    expect(src).toContain('BENCHMARK_MIN_EMPLOYERS');
  });
});

describe('tool components — accessibility and hygiene', () => {
  const files = toolComponentFiles();

  it('found the tool components', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it.each(files)('%s gives every input and select an id', (file) => {
    const src = readCode(file);
    for (const tag of ['<input', '<select']) {
      for (const chunk of src.split(tag).slice(1)) {
        const attrs = chunk.slice(0, chunk.indexOf('>'));
        // Checkbox inputs inside a wrapping <label> still carry an id so the
        // label's htmlFor can target them.
        expect(attrs).toMatch(/\sid=/);
      }
    }
  });

  it.each(files)('%s ships no debug logging', (file) => {
    expect(read(file)).not.toContain('console.log');
  });

  it('labels every control it renders', () => {
    for (const file of files) {
      const src = readCode(file);
      const labelCount = (src.match(/<label/g) ?? []).length;
      const controlCount =
        (src.match(/<input/g) ?? []).length + (src.match(/<select/g) ?? []).length;
      if (controlCount > 0) expect(labelCount).toBeGreaterThanOrEqual(1);
    }
  });
});

/**
 * WCAG 2.4.7 — the focus indicator must survive the widget being embedded.
 *
 * The tool controls are styled with inline style objects, and a focus ring
 * cannot be expressed inline. That ring used to come only from the four
 * app/tools/**\/page.tsx routes injecting TOOL_CONTROL_CSS, which was fine
 * until EmployerBenchmarkPicker was mounted inside /for-employers: that page
 * has no reason to know about tool styling, so both of its controls were
 * focusable with no visible focus state at all — on a live, high-traffic page.
 * (The mobile collapse of .tool-two-col was lost there for the same reason.)
 *
 * So the styles travel with the widget now. These tests fail if a control is
 * ever added without them, or if the inline styles start suppressing the
 * user-agent ring that is the floor when no stylesheet has loaded.
 */
describe('tool controls keep a visible focus indicator on any host page', () => {
  const theme = read('components/tools/tool-theme.ts');

  it('never suppresses the user-agent focus ring in the inline control styles', () => {
    // outline:none inline is unconditional — it applies before any stylesheet
    // is considered, on every host page. Nothing may reintroduce it.
    const code = readCode('components/tools/tool-theme.ts');
    expect(code).not.toMatch(/outline:\s*'none'/);
  });

  it('defines a real focus ring, not just a border-colour change', () => {
    // A border tint alone is not a reliable indicator (WCAG 1.4.11).
    expect(theme).toMatch(/\.tool-control:focus-visible[\s\S]{0,200}outline:/);
  });

  it('ships the control CSS from a component, not from the host page', () => {
    const styles = read('components/tools/ToolStyles.tsx');
    expect(styles).toContain('TOOL_CONTROL_CSS');
    expect(styles).toContain('<style>');
  });

  it.each(toolComponentFiles().filter((f) => !f.endsWith('ToolStyles.tsx')))(
    '%s renders <ToolStyles /> if it renders a tool control',
    (file) => {
      const src = readCode(file);
      const usesToolCss = src.includes('tool-control') || src.includes('tool-two-col') || src.includes('tool-link');
      if (!usesToolCss) return;
      expect(src).toContain("from './ToolStyles'");
      expect(src).toContain('<ToolStyles />');
    },
  );

  it('gives the embedded /for-employers placement its focus ring', () => {
    // The specific regression: /for-employers mounts the picker and injects no
    // tool CSS of its own, so the ring has to come from the widget.
    const employers = read('app/for-employers/page.tsx');
    expect(employers).not.toContain('TOOL_CONTROL_CSS');

    const picker = readCode('components/tools/EmployerBenchmarkPicker.tsx');
    expect(picker).toContain('<ToolStyles />');
    // Both controls opt into the styled ring.
    expect(picker.match(/className="tool-control"/g) ?? []).toHaveLength(2);
  });
});

describe('tools are reachable from the resources hub', () => {
  const src = read('app/resources/page.tsx');

  it('renders the band from the registry, not a hand-copied list', () => {
    expect(src).toContain("from '@/app/tools/tools-registry'");
    expect(src).toContain('TOOLS.map');
  });

  it('links the hub', () => {
    expect(src).toContain('href="/tools"');
  });
});
