/**
 * P2 seeker-UX package — static regression guards.
 *
 * Covers three audit items:
 *   #2  job-detail sidebar (employer context + internal links) was
 *       `hidden lg:block`, so it never rendered on mobile.
 *   #3  job-alert forms were missing the specialty/keyword and salary fields
 *       the schema and API already support, and the prefill contract only
 *       understood location/mode/jobType.
 *   #23 seeker retention: /my-applications was an orphan, the dashboard stat
 *       card that should link there was dead, the BottomNav had no seeker
 *       dashboard entry, and unsubscribe was delete-or-nothing.
 *
 * These read the real source so a future edit can't silently undo the fix.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALERT_KEYWORD_SUGGESTIONS,
  ALERT_KEYWORD_PLACEHOLDER,
} from '@/config/niche/alert-keywords';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ── #2 — job-detail sidebar renders on mobile ─────────────────────────── */

describe('P2 #2 — job-detail sidebar is not desktop-only', () => {
  const src = read('app/jobs/[slug]/page.tsx');

  it('renders AboutEmployer, the resource cards and InternalLinks at every breakpoint', () => {
    // Each of these used to sit inside a `hidden lg:block` wrapper. Assert on
    // the wrapper immediately preceding each component rather than on a global
    // count, so a re-introduction is pinned to the exact card.
    for (const component of [
      '<AboutEmployer',
      '<ApplicationTipsCard',
      '<CareerPulseCard',
      '<RelatedBlogPosts',
      '<InternalLinks',
    ]) {
      const at = src.indexOf(component);
      expect(at, `${component} missing from the job page`).toBeGreaterThan(-1);
      const preceding = src.slice(Math.max(0, at - 400), at);
      const lastWrapper = preceding.lastIndexOf('<div className=');
      expect(lastWrapper, `no wrapper div before ${component}`).toBeGreaterThan(-1);
      expect(
        preceding.slice(lastWrapper),
        `${component} is still hidden below lg`,
      ).not.toContain('hidden lg:block');
    }
  });

  it('keeps exactly one ShareButtons block per breakpoint (no duplicate DOM)', () => {
    // One inside the sticky desktop apply card, one in the `lg:hidden` mobile
    // block. Only one is ever rendered at a given viewport width.
    const shareCount = (src.match(/<ShareButtons/g) ?? []).length;
    expect(shareCount).toBe(2);
    expect(src).toContain('lg:hidden rounded-2xl p-5 mb-4');
  });

  it('renders the mobile share block before the employer-context cards', () => {
    expect(src.indexOf('lg:hidden rounded-2xl p-5 mb-4')).toBeLessThan(src.indexOf('<AboutEmployer'));
  });
});

/* ── #3 — alert forms expose keyword + salary, and accept prefill ──────── */

describe('P2 #3 — job-alert create form covers the schema fields', () => {
  const src = read('app/job-alerts/page.tsx');

  it('has labelled specialty/keyword and minimum-salary inputs', () => {
    expect(src).toContain('htmlFor="alert-keyword"');
    expect(src).toContain('id="alert-keyword"');
    expect(src).toContain('htmlFor="alert-min-salary"');
    expect(src).toContain('id="alert-min-salary"');
  });

  it('sources the suggestion list and salary buckets from shared modules, not hardcoded copy', () => {
    expect(src).toContain("from '@/config/niche/alert-keywords'");
    expect(src).toContain("from '@/config/niche/stats'");
    expect(src).toContain('ALERT_KEYWORD_SUGGESTIONS');
    expect(src).toContain('SALARY_FILTER_BUCKETS');
  });

  it('submits keyword and minSalary to the API', () => {
    expect(src).toMatch(/keyword:\s*keyword\.trim\(\)\s*\|\|\s*undefined/);
    expect(src).toMatch(/minSalary:\s*minSalary\s*\?\s*Number\(minSalary\)\s*:\s*undefined/);
  });

  it('accepts specialty/keyword/salary prefill from pSEO CTAs', () => {
    expect(src).toContain("KEYWORD_PARAM_ALIASES = ['keyword', 'specialty', 'q']");
    expect(src).toContain("MIN_SALARY_PARAM_ALIASES = ['minSalary', 'salaryMin']");
    // Prefill must survive a client-side param change, not just first mount.
    expect(src).toMatch(/setKeyword\(readParam\(searchParams, KEYWORD_PARAM_ALIASES\)\)/);
  });

  it('only honours a prefilled salary that matches an offered bucket', () => {
    expect(src).toMatch(/SALARY_FILTER_BUCKETS\.some\(\(b\) => String\(b\.value\) === raw\)/);
  });

  it('keeps a city-level prefilled location selectable', () => {
    // /jobs/city and /jobs/metro link with `?location=Sacramento, CA`, which
    // the state dropdown has no option for — the controlled select rendered
    // blank and dropped the location the visitor arrived with.
    expect(src).toContain('const isCustomLocation =');
    expect(src).toContain('{isCustomLocation && (');
  });
});

describe('P2 #3 — manage page create form matches the public form', () => {
  const src = read('app/job-alerts/manage/page.tsx');

  it('has keyword and minimum-salary inputs wired into the POST body', () => {
    expect(src).toContain('id="new-alert-keyword"');
    expect(src).toContain('id="new-alert-min-salary"');
    expect(src).toMatch(/keyword:\s*newKeyword\.trim\(\)\s*\|\|\s*undefined/);
    expect(src).toMatch(/minSalary:\s*newMinSalary\s*\?\s*Number\(newMinSalary\)\s*:\s*undefined/);
  });

  it('re-reads the list after create instead of trusting the partial POST response', () => {
    // POST /api/job-alerts returns only { id, token }; pushing that straight
    // into state rendered an "Invalid Date", criteria-less, "Paused" row.
    expect(src).not.toMatch(/setAlerts\(prev => \[data\.alert, \.\.\.prev\]\)/);
    expect(src).toContain('await loadAlerts({ silent: true })');
  });

  it('states the real edit limitation rather than implying criteria are editable', () => {
    expect(src).toMatch(/create a new alert and delete the old one/i);
  });
});

/* ── #3 follow-up — the keyword suggestions have to match how keyword is
      actually matched (literal `contains` on job title/employer), and the
      salary field must not claim a parity with /jobs that does not exist. */

describe('P2 #3 — alert keyword suggestions are title-shaped, not profile presets', () => {
  const publicForm = read('app/job-alerts/page.tsx');
  const manageForm = read('app/job-alerts/manage/page.tsx');

  it('neither alert form offers SPECIALTY_PRESETS', () => {
    // SPECIALTY_PRESETS is an exact-match token list for a structured
    // profile field (settings / onboarding / employer candidate search).
    // 11 of its 19 entries carry a parenthetical credential that no job
    // title contains verbatim, so an alert built from one matched zero
    // rows on every run and silently never sent.
    // Asserted on USE, not on mention — both files name the list in a
    // comment explaining why it is the wrong vocabulary here.
    for (const [name, src] of [['public', publicForm], ['manage', manageForm]] as const) {
      expect(src, `${name} form still imports the credentials pack`)
        .not.toContain("from '@/config/niche/credentials'");
      expect(src, `${name} form still renders SPECIALTY_PRESETS`)
        .not.toMatch(/SPECIALTY_PRESETS\s*[.[]/);
    }
  });

  it('both forms feed their datalist from ALERT_KEYWORD_SUGGESTIONS', () => {
    for (const src of [publicForm, manageForm]) {
      expect(src).toContain("from '@/config/niche/alert-keywords'");
      expect(src).toContain('ALERT_KEYWORD_SUGGESTIONS.map');
    }
  });

  it('no suggestion carries a parenthetical credential', () => {
    for (const suggestion of ALERT_KEYWORD_SUGGESTIONS) {
      expect(suggestion, `"${suggestion}" is display copy, not a title substring`)
        .not.toMatch(/[()]/);
    }
  });

  it('every suggestion occurs verbatim in the repo’s own job-title vocabulary', () => {
    // The two files that define what this board's job TITLES look like:
    // the title-anchored classifier rules (matchDescription: false) and
    // the relevance role/specialty vocabulary. A suggestion absent from
    // both is a term we have no evidence appears in a title, which means
    // the alert it creates would never match anything.
    const titleVocabulary = (
      read('lib/pseo/category-tagger.ts') + read('config/niche/relevance.ts')
    ).toLowerCase();

    for (const suggestion of ALERT_KEYWORD_SUGGESTIONS) {
      expect(
        titleVocabulary.includes(suggestion.toLowerCase()),
        `"${suggestion}" is not in category-tagger.ts or relevance.ts — no evidence it appears in a job title`,
      ).toBe(true);
    }
  });

  it('the public form’s placeholder is itself a matchable suggestion', () => {
    // The placeholder is the value a hurried visitor is most likely to
    // accept, so it must be the safest term in the list, not a decoration.
    expect(ALERT_KEYWORD_SUGGESTIONS).toContain(ALERT_KEYWORD_PLACEHOLDER);
    expect(publicForm).toContain('placeholder={ALERT_KEYWORD_PLACEHOLDER}');
  });
});

describe('P2 #3 — the salary field does not claim parity with the /jobs filter', () => {
  const publicForm = read('app/job-alerts/page.tsx');
  const manageForm = read('app/job-alerts/manage/page.tsx');

  it('drops the "can’t disagree" claim from both forms', () => {
    for (const src of [publicForm, manageForm]) {
      expect(src).not.toMatch(/can['’]t disagree/i);
    }
  });

  it('names both matchers so the divergence is visible to the next reader', () => {
    for (const src of [publicForm, manageForm]) {
      expect(src).toContain('lib/filters.ts');
      expect(src).toContain('lib/job-alerts-service.ts');
    }
  });

  it('tells the visitor the digest and the jobs board will not agree', () => {
    // Sharing SALARY_FILTER_BUCKETS makes the LABELS identical; it does
    // not make the two queries identical. The hint has to say so, because
    // the digest's "View All Matching Jobs" button links straight at
    // /jobs?salaryMin= (buildFilteredJobsUrl).
    for (const src of [publicForm, manageForm]) {
      expect(src).toMatch(/won&apos;t be identical/);
      expect(src).toMatch(/top of (its|a) posted range/);
    }
  });

  it('never describes the jobs board as the stricter rule — it is backwards', () => {
    // The two matchers diverge in BOTH directions:
    //   board  : min >= X OR max >= X  → drops salary-less, keeps floor-only
    //   digest : max >= X OR both null → keeps salary-less, drops floor-only
    // Calling the board "stricter" tells a seeker the board would show them
    // FEWER jobs than the alert, when for the floor-only case — the case the
    // alert silently drops — the board shows them MORE.
    for (const src of [publicForm, manageForm]) {
      const hint = src.slice(
        src.indexOf('min-salary-note'),
        src.indexOf('won&apos;t be identical'),
      );
      expect(hint).not.toMatch(/stricter/i);
    }
  });

  it('discloses the floor-only gap, which is what a seeker actually loses', () => {
    // A job posted "$130,000/yr" normalizes to {min:130000, max:null}
    // (job-normalizer.ts ANNUAL branch, no second capture group), so the
    // digest's `normalizedMaxSalary >= X` clause never matches it and a
    // $100k+ alert silently omits a job that clears the bar. Exposing
    // minSalary in the UI made this dormant matcher gap user-visible, so
    // the copy has to name it rather than imply the job is included.
    // JSX wraps the sentence across source lines, so compare on collapsed
    // whitespace rather than pinning one particular line break.
    for (const src of [publicForm, manageForm]) {
      const flat = src.replace(/\s+/g, ' ');
      expect(flat).toMatch(/single figure rather than a range/);
      expect(flat).toMatch(/are missed/);
    }
  });

  it('pins the normalizer behaviour the floor-only disclosure depends on', () => {
    // If the ANNUAL branch ever starts inferring a max, the disclosure above
    // becomes stale and should be revisited.
    const normalizer = read('lib/job-normalizer.ts');
    expect(normalizer).toMatch(
      /max:\s*match\[2\]\s*\?\s*parseDollar\(match\[2\]\)\s*:\s*null,\s*period:\s*'year'/,
    );
  });

  it('pins the known divergence — if these are aligned, update the copy above', () => {
    // Deliberately asserts the CURRENT (divergent) clauses. Aligning the
    // digest matcher with the board filter is the real fix and lives
    // outside this package; when it lands this test fails, which is the
    // signal to rewrite the two hints that currently disclose the gap.
    const boardFilter = read('lib/filters.ts');
    const digestMatcher = read('lib/job-alerts-service.ts');

    // /jobs: min >= X OR max >= X → salary-less EXCLUDED, floor-only INCLUDED.
    expect(boardFilter).toMatch(
      /normalizedMinSalary:\s*\{\s*gte:\s*filters\.salaryMin\s*\}[\s\S]{0,120}normalizedMaxSalary:\s*\{\s*gte:\s*filters\.salaryMin\s*\}/,
    );
    // digest: max >= X OR both null → salary-less INCLUDED, floor-only EXCLUDED.
    expect(digestMatcher).toMatch(
      /normalizedMaxSalary:\s*\{\s*gte:\s*alert\.minSalary\s*\}[\s\S]{0,200}AND:\s*\[\{\s*normalizedMinSalary:\s*null\s*\},\s*\{\s*normalizedMaxSalary:\s*null\s*\}\]/,
    );
  });
});

/* ── #23 — seeker retention ────────────────────────────────────────────── */

describe('P2 #23 — /my-applications is reachable', () => {
  it('the dashboard "applications sent" stat card links there', () => {
    const src = read('components/dashboard/DashboardContent.tsx');
    expect(src).toMatch(/label: 'applications sent'[^}]*href: '\/my-applications'/);
    expect(src).not.toMatch(/label: 'applications sent'[^}]*href: null/);
  });

  it('the dashboard Recent Applications section has a View All link', () => {
    const src = read('components/dashboard/DashboardContent.tsx');
    expect(src).toContain('<Link href="/my-applications" style={viewAllLink}>');
  });

  it('the seeker bottom nav carries a dashboard entry and an applications entry', () => {
    const src = read('components/BottomNav.tsx');
    expect(src).toContain("href: '/dashboard'");
    expect(src).toContain("href: '/my-applications'");
    // The marketing variant must keep pointing at the marketing home.
    expect(src).toContain("{ label: 'Home', href: '/', icon: Home }");
  });

  it('bottom-nav active state matches on a path-segment boundary', () => {
    const src = read('components/BottomNav.tsx');
    expect(src).toContain('function matchesPrefix');
    expect(src).toMatch(/pathname === prefix \|\| pathname\.startsWith\(`\$\{prefix\}\/`\)/);
  });

  it('does not swap to the signed-in nav on routes a logged-out visitor can reach', () => {
    const src = read('components/BottomNav.tsx');
    const block = src.slice(
      src.indexOf('const SEEKER_APP_PREFIXES'),
      src.indexOf('function matchesPrefix'),
    );
    expect(block).toContain("'/dashboard'");
    expect(block).toContain("'/my-applications'");
    // /job-alerts and /saved are linked from public pSEO surfaces, and
    // /messages is shared with employers.
    expect(block).not.toContain("'/job-alerts'");
    expect(block).not.toContain("'/saved'");
    expect(block).not.toContain("'/messages'");
  });
});

describe('P2 #23 — applied-tab naming collision is named out loud', () => {
  it('the bottom-nav entry is "Applications", not "Applied"', () => {
    const src = read('components/BottomNav.tsx');
    expect(src).toMatch(/label: 'Applications', href: '\/my-applications'/);
    expect(src).not.toMatch(/label: 'Applied'/);
  });

  it('/my-applications distinguishes itself from the /saved "Applied" tab', () => {
    const src = read('app/my-applications/page.tsx');
    expect(src).toContain('href="/saved"');
    expect(src).toMatch(/marked applied yourself/i);
  });
});

describe('P2 #23 — unsubscribe offers a step-down, not just delete', () => {
  const src = read('app/job-alerts/unsubscribe/page.tsx');

  it('offers pause and weekly alongside delete', () => {
    expect(src).toContain("patchAlert('pause', { isActive: false }, 'paused')");
    expect(src).toContain("patchAlert('weekly', { frequency: 'weekly' }, 'weekly')");
    expect(src).toContain("method: 'DELETE'");
  });

  it('never resumes a paused alert from the unsubscribe page', () => {
    // A `frequency` PATCH that also set isActive:true would re-subscribe
    // someone who arrived here to stop receiving mail.
    expect(src).not.toMatch(/frequency: 'weekly', isActive: true/);
  });

  it('every manage link carries a token — a bare one is a dead end here', () => {
    // /job-alerts/manage with no token falls back to /api/auth/me and renders
    // "Please sign in to manage your alerts." Job-alert subscribers are
    // email-only by design, so a token-less link strands the page's primary
    // audience. GET /api/job-alerts?token= resolves the email and returns
    // EVERY alert on it, so the token is what makes "manage them all" true.
    expect(src).not.toMatch(/href="\/job-alerts\/manage"/);
    // Scope to real href values — a bare mention of the path inside a code
    // comment is documentation, not a link, and must not fail this.
    const manageLinks = [...src.matchAll(/href=\{?[`"']([^`"']*\/job-alerts\/manage[^`"']*)/g)]
      .map((m) => m[1]);
    expect(manageLinks.length).toBeGreaterThan(0);
    for (const link of manageLinks) {
      expect(link).toMatch(/\?token=/);
    }
  });

  it('the sibling-alerts footnote links to the token-bearing manage page', () => {
    // This footnote is the page's ONLY pointer to the user's other alerts,
    // and it matters because the digest merges multiple alerts into one
    // email under the first alert's token — so pausing "this one alert"
    // does not necessarily stop the mail.
    const footnote = src.slice(src.indexOf('Pausing and cadence changes'));
    expect(footnote).toMatch(/\/job-alerts\/manage\?token=\$\{encodeURIComponent\(token/);
  });

  it('pins the digest merge that makes the footnote load-bearing', () => {
    const service = read('lib/job-alerts-service.ts');
    expect(service).toMatch(/const primary = group\[0\]\.alert/);
  });

  it('only offers the weekly step-down when it is a real step down', () => {
    expect(src).toMatch(/const canDownsellToWeekly = isRunning && \(!alertSummary \|\| alertSummary\.frequency !== 'weekly'\)/);
  });

  it('never sends a deleted token back to the manage page', () => {
    // GET /api/job-alerts?token= 404s "Job alert not found" once the row is
    // gone, so reusing the just-deleted token made "Manage My Alerts" land
    // on an error banner with an empty list — even for someone who still
    // has other alerts. Pause/weekly leave the token valid and keep it.
    expect(src).toContain("const manageHref = outcome !== 'deleted'");
    expect(src).toContain('siblingToken');
    // The sibling has to be captured while the alert still exists.
    expect(src).toMatch(/setSiblingToken\(allAlerts\.find\(\(a\) => a\.token !== alertToken\)\?\.token \?\? null\)/);
    const outcomeBlock = src.slice(src.indexOf('if (outcome) {'), src.indexOf('// ── Loading'));
    expect(outcomeBlock).not.toMatch(/href=\{`\/job-alerts\/manage\?token=\$\{encodeURIComponent\(token \?\? ''\)\}`\}/);
  });

  it('the "keep everything as-is" escape hatch is a real navigation', () => {
    // The file's own header comment cites router.back() as the OLD page's
    // defect: mail clients open the digest link in a fresh tab where
    // history.length === 1, so the button did nothing at all.
    expect(src).not.toContain('onClick={() => router.back()}');
    expect(src).not.toMatch(/useRouter/);
    const at = src.indexOf('Never mind, keep everything as-is');
    expect(at).toBeGreaterThan(-1);
    const control = src.slice(Math.max(0, at - 500), at);
    expect(control).toContain('<Link');
    expect(control).toContain('href="/jobs"');
  });

  it('surfaces failures instead of claiming success', () => {
    expect(src).toContain('role="alert"');
    expect(src).toMatch(/if \(!res\.ok \|\| !data\.success\)/);
    // setOutcome must never run before the API confirmed the change.
    const patchBody = src.slice(src.indexOf('const patchAlert'), src.indexOf('const handlePause'));
    expect(patchBody.indexOf('setActionError(data.error')).toBeLessThan(patchBody.indexOf('setOutcome(nextOutcome)'));
  });
});

describe('P2 #23 — destructive seeker mutations use the shared confirm dialog', () => {
  it('/my-applications withdraw no longer uses window.confirm', () => {
    const src = read('app/my-applications/page.tsx');
    expect(src).toContain("import ConfirmDialog, { type ConfirmConfig } from '@/components/ui/ConfirmDialog'");
    expect(src).not.toMatch(/if \(!confirm\(/);
    expect(src).toContain('requestWithdraw');
  });

  it('the withdraw dialog does not promise the employer stops seeing the seeker', () => {
    // DELETE /api/applications/withdraw only sets status:'withdrawn'. The
    // employer listing (GET /api/employer/applicants) builds `where` from
    // jobId with no status exclusion, and ApplicantsTab renders a
    // "Withdrawn" chip — so the row, the name and the profile all remain.
    // This is the last screen before an irreversible action; it must not
    // buy consent with a promise the system does not keep.
    const src = read('app/my-applications/page.tsx');
    const dialog = src.slice(src.indexOf('const requestWithdraw'), src.indexOf('confirmLabel'));
    expect(dialog).not.toMatch(/stops seeing you/i);
    expect(dialog).toMatch(/employer still sees this application/i);
  });

  it('the withdraw dialog does not overstate the scrub', () => {
    // The endpoint nulls coverLetter, resumeUrl and notes but NOT
    // coverLetterUrl, which ApplicantsTab still renders as a live download
    // link. "Your personal data is removed" is therefore false.
    const src = read('app/my-applications/page.tsx');
    const dialog = src.slice(src.indexOf('const requestWithdraw'), src.indexOf('confirmLabel'));
    expect(dialog).not.toMatch(/personal data on this application is removed/i);
    expect(dialog).toMatch(/uploaded as a file stays attached/i);
  });

  it('pins the withdraw endpoint fields the dialog copy describes', () => {
    // If coverLetterUrl is ever added to the scrub, the "stays attached"
    // clause becomes wrong and this test is the signal to update it.
    const endpoint = read('app/api/applications/withdraw/route.ts');
    expect(endpoint).toMatch(/coverLetter:\s*null/);
    expect(endpoint).toMatch(/resumeUrl:\s*null/);
    expect(endpoint).toMatch(/status:\s*'withdrawn'/);
    expect(endpoint).not.toMatch(/coverLetterUrl:\s*null/);
    // And the employer listing still has no status exclusion.
    const employerList = read('app/api/employer/applicants/route.ts');
    expect(employerList).not.toMatch(/status:\s*\{\s*not:\s*'withdrawn'/);
  });
});
