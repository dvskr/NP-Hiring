/**
 * GA4 conversion coverage ratchet.
 *
 * Google Analytics is off in production: NEXT_PUBLIC_GA_MEASUREMENT_ID is
 * empty and it is inlined at build time, so gtag.js never loads and no live
 * report can tell anyone a conversion went missing. Every gap this file
 * pins was found by reading source, and every one of them survived months
 * of refactoring precisely because nothing failed when it was dropped.
 *
 * So the pins guard the code path, not the data:
 *
 *   1. the on-site (Easy Apply) conversion reaches GA4, not just the
 *      first-party click counter
 *   2. both job-alert signup surfaces report a subscribe, once per alert
 *   3. the main /jobs board emits a list impression like the category hubs
 *   4. a card click can be joined back to that impression
 *   5. item payloads carry real fields and never a placeholder
 *   6. the Google signup path is counted alongside the email path
 *
 * Gap 4 is the one to read carefully. JobCard can now fire select_item, but
 * no surface supplies the list attribution it needs, so the event is still
 * emitted nowhere. These tests say that plainly instead of reporting the
 * gap as closed, and the pair invariant below is what catches a half-done
 * wiring when someone does connect a surface.
 *
 * Static source reads plus runtime checks of the item builder, matching the
 * repo's regression style (see shell-isr-static-layout.test.ts).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildTrackedJobItem, JOBS_BOARD_LIST_NAME } from '@/components/analytics/ViewTrackers';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const APPLY_BUTTON = 'components/ApplyButton.tsx';
const SAVE_BUTTON = 'components/SaveJobButton.tsx';
const ALERT_FORM = 'components/CreateAlertForm.tsx';
const EXIT_POPUP = 'components/ExitIntentPopup.tsx';
const SIGNUP_FORM = 'components/auth/SignUpForm.tsx';
const VIEW_TRACKERS = 'components/analytics/ViewTrackers.tsx';
const JOBS_PAGE = 'app/jobs/page.tsx';
const JOB_CARD = 'components/JobCard.tsx';

/** Every surface this file guards, for the shared consent-model check. */
const TRACKED_SURFACES = [
  APPLY_BUTTON,
  SAVE_BUTTON,
  ALERT_FORM,
  EXIT_POPUP,
  SIGNUP_FORM,
  JOBS_PAGE,
  JOB_CARD,
];

/** Every .tsx under app/ and components/, for the whole-repo scans below. */
function collectTsx(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collectTsx(rel, found);
    } else if (entry.name.endsWith('.tsx')) {
      found.push(rel);
    }
  }
  return found;
}

const ALL_TSX = [...collectTsx('app'), ...collectTsx('components')];

describe('gap 1: the on-platform apply is a tracked conversion', () => {
  const src = read(APPLY_BUTTON);

  it('fires trackJobApply on BOTH apply branches, not just the external link', () => {
    const calls = src.match(/trackJobApply\(/g) ?? [];
    expect(calls.length).toBe(2);
    // Bounded by the statement, not by a paren: the item argument is itself
    // a call, so a non-greedy paren match would stop inside it.
    expect(src).toMatch(/trackJobApply\([^;]*'external'\);/);
    expect(src).toMatch(/trackJobApply\([^;]*'platform'\);/);
  });

  it('the platform event fires on the submitted application, not on the modal opening', () => {
    const successStart = src.indexOf('const handlePlatformApplySuccess = () => {');
    expect(successStart).toBeGreaterThan(-1);
    const successEnd = src.indexOf('\n  };', successStart);
    expect(successEnd).toBeGreaterThan(successStart);
    expect(src.slice(successStart, successEnd)).toMatch(/trackJobApply\([^;]*'platform'\);/);
  });

  it('counts one lead per application, not one per submission', () => {
    // The apply route upserts on (userId, jobId) and answers 200 whether or
    // not it created a row, and the button offers "Apply Again" to someone who
    // has already applied, so an ungated call books a second generate_lead
    // against one application. The guard must also be READ before markApplied,
    // which flips isApplied(), or it always reports true.
    const successStart = src.indexOf('const handlePlatformApplySuccess = () => {');
    const successEnd = src.indexOf('\n  };', successStart);
    const body = src.slice(successStart, successEnd);

    expect(body).toMatch(/const isFirstApplication = [^;]+;/);
    expect(body).toMatch(/if \(isFirstApplication\) \{\s*\n\s*trackJobApply\([^;]*'platform'\);/);
    expect(body.indexOf('const isFirstApplication')).toBeLessThan(body.indexOf('markApplied(jobId)'));
  });

  it('keeps the first-party click counter beside it (employer dashboards read that one)', () => {
    expect(src).toContain('/track-apply');
  });
});

describe('gap 2: job alert signup reports one subscribe per alert', () => {
  it('the alert modal fires only after the route confirmed the alert', () => {
    const src = read(ALERT_FORM);
    expect(src).toMatch(/import \{ trackEmailSubscribe \} from '@\/lib\/analytics'/);
    // The failure branch throws, so anything below it runs on success only.
    const throwIdx = src.indexOf('throw new Error(result.error');
    const trackIdx = src.indexOf('trackEmailSubscribe(');
    expect(throwIdx).toBeGreaterThan(-1);
    expect(trackIdx).toBeGreaterThan(throwIdx);
  });

  it('neither surface counts a resubmission that the route merged into an existing alert', () => {
    // app/api/job-alerts/route.ts answers 200 for a repeat of identical
    // criteria and updates the row in place, so a 2xx alone does not mean a
    // new alert exists. Both call sites therefore read the route's own
    // `isNew` answer. Written as `!== false` so an older route build that
    // omits the field still reports its real signups: see the comments at
    // each call site.
    expect(read(ALERT_FORM)).toMatch(
      /if \(result\.isNew !== false\) trackEmailSubscribe\(SUBSCRIBE_SOURCE\);/,
    );
    expect(read(EXIT_POPUP)).toMatch(
      /if \(response\.ok && body\?\.isNew !== false\) trackEmailSubscribe\(SUBSCRIBE_SOURCE\);/,
    );
  });

  it('the exit popup still requires a successful response before counting anything', () => {
    const src = read(EXIT_POPUP);
    expect(src).toMatch(/import \{ trackEmailSubscribe \} from '@\/lib\/analytics'/);
    expect(src).toContain('response.ok &&');
    // The body read must not be able to fail the submit handler: a route
    // that answers a non-JSON body would otherwise throw past the "done"
    // state and leave the popup spinning.
    expect(src).toMatch(/await response\.json\(\)\.catch\(\(\) => null\)/);
  });

  it('each surface names itself, so the two are never read as one number', () => {
    expect(read(ALERT_FORM)).toMatch(/const SUBSCRIBE_SOURCE = 'job_alert_modal'/);
    expect(read(EXIT_POPUP)).toMatch(/const SUBSCRIBE_SOURCE = 'exit_intent_popup'/);
  });
});

describe('gap 3: the main /jobs board emits a list impression', () => {
  const src = read(JOBS_PAGE);

  it('mounts the board list tracker, the way the category hubs mount theirs', () => {
    expect(src).toMatch(
      /import \{ JobsBoardListViewTracker \} from '@\/components\/analytics\/ViewTrackers'/,
    );
    expect(src).toContain('<JobsBoardListViewTracker');
  });

  it('feeds it the server-rendered rows, not a hand-rolled list', () => {
    const start = src.indexOf('<JobsBoardListViewTracker');
    const end = src.indexOf('/>', start);
    const block = src.slice(start, end);
    expect(block).toContain('jobs.map(');
    expect(block).toContain('title: j.title');
    expect(block).toContain('employer: j.employer');
  });

  it('sends the state CODE, so item_category3 matches every other surface', () => {
    // Job.state is "California" and Job.stateCode is "CA", in separate
    // columns. item_category3 is one item-scoped dimension, and the detail
    // page (view_item) and the card click (select_item) both send the code,
    // so the long name from this one surface would split every Californian
    // listing across two values.
    const start = src.indexOf('<JobsBoardListViewTracker');
    const end = src.indexOf('/>', start);
    const block = src.slice(start, end);
    expect(block).toContain('stateCode: j.stateCode');
    expect(block).not.toMatch(/\bstate: j\.state\b/);
    // The mapping can only read a column the query selected.
    expect(src).toMatch(/^\s*stateCode: true,$/m);
  });

  it('the list name never crosses the server boundary as a bare constant', () => {
    // A "use client" module's non-component exports arrive in a Server
    // Component as client references, not values, so the page must import
    // the wrapper component and never JOBS_BOARD_LIST_NAME itself.
    expect(src).not.toContain('JOBS_BOARD_LIST_NAME');
    const trackers = read(VIEW_TRACKERS);
    expect(trackers).toMatch(/export function JobsBoardListViewTracker/);
    expect(trackers).toContain('listName={JOBS_BOARD_LIST_NAME}');
  });
});

describe('gap 4: a card click can be joined back to the list impression', () => {
  const src = read(JOB_CARD);

  /**
   * The <JobCard> elements in each file that renders one, which is where
   * attribution enters. Scoped to the element rather than the file on
   * purpose: the category hubs already spell `listName=` on their
   * JobListViewTracker, and a whole-file match would read that impression
   * as a wired card click.
   *
   * The word boundary matters too, or the pattern also claims
   * <JobCardSkeleton>, which renders no job and tracks nothing. Every site
   * self-closes the element, so `/>` is the reliable end marker.
   */
  const elementsPerSite = ALL_TSX.filter((rel) => rel !== JOB_CARD).map((rel) => ({
    rel,
    elements: read(rel).match(/<JobCard\b[\s\S]*?\/>/g) ?? [],
  }));
  const renderSites = elementsPerSite.filter((site) => site.elements.length > 0);

  it('imports trackJobClick and fires it from every route out of the card', () => {
    expect(src).toMatch(/import \{ trackJobClick \} from '@\/lib\/analytics'/);
    const cardClick = src.indexOf('const handleCardClick = () => {');
    const easyApply = src.indexOf('const handleEasyApplyClick = (e: React.MouseEvent) => {');
    expect(cardClick).toBeGreaterThan(-1);
    expect(easyApply).toBeGreaterThan(-1);
    expect(src.slice(cardClick, src.indexOf('};', cardClick))).toContain('trackListClick()');
    expect(src.slice(easyApply, src.indexOf('};', easyApply))).toContain('trackListClick()');
  });

  it('refuses to invent a list name or a position', () => {
    expect(src).toMatch(/if \(!listName \|\| typeof listIndex !== 'number'\) return;/);
  });

  it('keeps both attribution props optional so existing call sites still compile', () => {
    expect(src).toMatch(/listName\?: string;/);
    expect(src).toMatch(/listIndex\?: number;/);
  });

  it('finds the card render sites at all, so the two scans below mean something', () => {
    // A rename that broke the element match would make every scan pass by
    // finding nothing.
    expect(renderSites.length).toBeGreaterThan(10);
    expect(renderSites.map((site) => site.rel)).toContain('app/jobs/JobsPageClient.tsx');
  });

  it('every card supplies the attribution as a pair, or supplies neither', () => {
    // The guard above drops a select_item that carries only one half, so a
    // card wired with a list name but no index would look instrumented in
    // review and emit nothing at runtime. This is the assertion that
    // catches that, on whichever surface is wired first.
    const halfWired = renderSites
      .filter((site) =>
        site.elements.some((el) => el.includes('listName=') !== el.includes('listIndex=')),
      )
      .map((site) => site.rel);
    expect(halfWired).toEqual([]);
  });

  it('states plainly that no surface is wired yet, so nobody reads gap 4 as closed', () => {
    // Deliberately not an assertion that some surface IS wired: this
    // package owns JobCard but not app/jobs/JobsPageClient.tsx or the
    // category hubs, so the wiring ships as a handoff. Until it lands,
    // select_item is emitted nowhere and this test is the record of that.
    // When it lands, this expectation is the one line to update, and its
    // failure is the reminder that the event finally has a source.
    const wired = renderSites
      .filter((site) => site.elements.some((el) => el.includes('listIndex=')))
      .map((site) => site.rel);
    expect(wired).toEqual([]);
    expect(src).toContain('No render site passes them yet');
  });

  it('the shared list name is one exported constant, so impression and click cannot drift', () => {
    expect(read(VIEW_TRACKERS)).toMatch(/export const JOBS_BOARD_LIST_NAME = /);
    expect(typeof JOBS_BOARD_LIST_NAME).toBe('string');
    expect(JOBS_BOARD_LIST_NAME.length).toBeGreaterThan(0);
  });
});

describe('gap 5: item payloads carry real fields, never a placeholder', () => {
  it('omits item_brand rather than sending the literal Unknown', () => {
    const item = buildTrackedJobItem({ id: 'job-1', title: 'Nurse Practitioner' });
    expect(item.item_id).toBe('job-1');
    expect(item.item_name).toBe('Nurse Practitioner');
    expect('item_brand' in item).toBe(false);
  });

  it('omits item_name rather than sending a blank one', () => {
    // The Save button on the job detail page is handed a job id and nothing
    // else, and it used to send item_name: ''. GA4 stores that as a real
    // value, so the same job showed its title on view_item and a blank row
    // on add_to_wishlist. Absent reports as "(not set)".
    const noTitle = buildTrackedJobItem({ id: 'job-2' });
    expect(noTitle.item_id).toBe('job-2');
    expect('item_name' in noTitle).toBe(false);
    const blankTitle = buildTrackedJobItem({ id: 'job-3', title: '' });
    expect('item_name' in blankTitle).toBe(false);
  });

  it('keeps item_id on every item, so an unnamed item still joins its funnel', () => {
    // item_id is the only key GA4 uses to line an item up across view_item,
    // add_to_wishlist and generate_lead, so dropping a name costs a label
    // and not the funnel.
    for (const job of [{ id: 'a' }, { id: 'b', title: 'Family NP' }, { id: 'c', employer: null }]) {
      expect(buildTrackedJobItem(job).item_id).toBe(job.id);
    }
  });

  it('keeps a real employer name and the dimensions the caller supplied', () => {
    const item = buildTrackedJobItem({
      id: 'job-4',
      title: 'Family NP',
      employer: 'Northside Clinic',
      jobType: 'Full-time',
      stateCode: 'CA',
      sourceProvider: 'employer',
      normalizedMinSalary: 120000,
    });
    expect(item.item_brand).toBe('Northside Clinic');
    expect(item.item_category).toBe('Full-time');
    expect(item.item_category3).toBe('CA');
    expect(item.item_category4).toBe('employer');
    expect(item.price).toBe(120000);
  });

  it('treats a null or empty employer as absent, not as a company named Unknown', () => {
    expect('item_brand' in buildTrackedJobItem({ id: 'a', title: 'Acute Care NP', employer: null })).toBe(false);
    expect('item_brand' in buildTrackedJobItem({ id: 'b', title: 'Acute Care NP', employer: '' })).toBe(false);
  });

  it('reports the state as a code or not at all, never as a long name', () => {
    // TrackedJob has no `state` field, so the only way into item_category3
    // is the two-letter code. A row with no recorded code omits the
    // dimension on every surface rather than carrying "California" on one.
    const withCode = buildTrackedJobItem({ id: 'd', title: 'Acute Care NP', stateCode: 'CA' });
    expect(withCode.item_category3).toBe('CA');
    const withoutCode = buildTrackedJobItem({ id: 'e', title: 'Acute Care NP', stateCode: null });
    expect(withoutCode.item_category3).toBeUndefined();
    // Pinned in source too: buildJobItem still accepts `state` and falls
    // back to it, so re-adding the field here would silently reopen the gap.
    const trackers = read(VIEW_TRACKERS);
    expect(trackers).not.toMatch(/^\s*state\?: string \| null;$/m);
    expect(trackers).not.toMatch(/^\s*state: job\.state/m);
  });

  it('every surface that names a state to GA4 names it as a code', () => {
    for (const rel of [JOBS_PAGE, JOB_CARD, APPLY_BUTTON, SAVE_BUTTON]) {
      const src = read(rel);
      if (!src.includes('stateCode')) continue;
      expect(src, rel).not.toMatch(/\bstate: (j|job)\.state\b/);
    }
  });

  it('keeps an employer whose recorded name really is Unknown', () => {
    // The drop is keyed on what the caller supplied, so a row that genuinely
    // carries that name is reported as itself rather than erased.
    const item = buildTrackedJobItem({ id: 'c', title: 'Acute Care NP', employer: 'Unknown' });
    expect(item.item_brand).toBe('Unknown');
  });

  it('the apply and save buttons build their item through the honest builder', () => {
    for (const rel of [APPLY_BUTTON, SAVE_BUTTON]) {
      const src = read(rel);
      expect(src, rel).toContain('buildTrackedJobItem(');
      // The old degraded payload: buildJobItem called with an id and a
      // hand-written title, bypassing the omissions above.
      expect(src, rel).not.toMatch(/buildJobItem\(\{ id: jobId/);
    }
  });

  it('the save button forwards its title untouched instead of defaulting it', () => {
    // `jobTitle ?? ''` reads like a fix and changes nothing: the event still
    // carries a blank name. The prop must reach the builder as undefined so
    // the key is dropped.
    const src = read(SAVE_BUTTON);
    expect(src).toContain('title: jobTitle,');
    expect(src).not.toMatch(/title: jobTitle \?\?/);
    expect(src).not.toMatch(/title: jobTitle \|\|/);
  });

  it('the save button accepts the dimensions the detail page can supply', () => {
    const src = read(SAVE_BUTTON);
    for (const prop of ['jobTitle?', 'employer?', 'jobType?', 'stateCode?', 'sourceProvider?']) {
      expect(src, prop).toContain(prop);
    }
  });

  it('neither conversion button accepts a salary, because it lands as the event value', () => {
    // trackJobApply sends the item's price as generate_lead's `value` and
    // trackJobSave sends it as add_to_wishlist's. A salary there books a
    // six-figure conversion value for one click, which is what Google Ads
    // bidding and every ROAS report would read. The impression and the
    // detail view still carry it, where it is an item attribute.
    for (const rel of [APPLY_BUTTON, SAVE_BUTTON]) {
      expect(read(rel), rel).not.toContain('normalizedMinSalary');
    }
    expect(read(VIEW_TRACKERS)).toContain('normalizedMinSalary');
  });
});

describe('gap 6: the Google signup cohort is counted', () => {
  const src = read(SIGNUP_FORM);

  it('fires trackSignUp for the email path and the Google path', () => {
    expect(src).toMatch(/trackSignUp\('email',/);
    expect(src).toMatch(/trackSignUp\('google', 'job_seeker'\)/);
  });

  it('tracks the Google path from a wrapper, leaving the button props untouched', () => {
    // GoogleSignInButton exposes no callback, and the redirect wiring is
    // pinned by signup-redirect-intent.test.ts, so the wrapper must not
    // rewrite the element.
    expect(src).toMatch(/<GoogleSignInButton\s+mode="signup"\s+redirectTo=\{redirectTo\}/);
    expect(src).toMatch(/onClickCapture=\{\(\) => trackSignUp\('google', 'job_seeker'\)\}/);
  });
});

describe('every tracked surface respects the existing consent model', () => {
  it.each(TRACKED_SURFACES)('%s never touches window.gtag directly', (rel) => {
    // lib/analytics.ts owns the Consent Mode v2 gating and the dataLayer
    // shim. A component reaching for window.gtag would bypass both and
    // start sending hits the visitor did not agree to.
    expect(read(rel)).not.toMatch(/window\.gtag/);
  });

  it.each(TRACKED_SURFACES)('%s carries no console.log', (rel) => {
    expect(read(rel)).not.toMatch(/console\.log\(/);
  });
});
