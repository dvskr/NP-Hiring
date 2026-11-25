/**
 * The widget views and the committed bundle.
 *
 * Views are pure functions from tool data to markup, so they are tested as
 * strings. The properties pinned are the ones that would hurt if lost:
 *  - every value from a job or a person is escaped (titles and descriptions
 *    come from aggregated sources);
 *  - links never become href attributes, and only our hosts can be opened;
 *  - the apply card starts unconsented and has exactly one Submit button,
 *    and a job that must be finished on the website has none;
 *  - applicants appear without scores or rankings;
 *  - the committed bundle is what the sources build to.
 *
 * The bundle names no board: the cards read the board's name, role and
 * hosts from the document (src/board.ts), which useTestBoard() stands in for
 * with the active pack's. All fixtures are fictional.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { brand } from '@/config/brand';
import { MCP_PREFIX } from '@/lib/mcp/prefix';
import { TEST_BOARD, useTestBoard } from '../../helpers/mcp-board';
import { setBoardForTests } from '@/lib/mcp/widgets/src/board';
import { escapeText, html, isOpenableUrl } from '@/lib/mcp/widgets/src/ui';
import { moneyK, postedLabel, initials, statusLabel } from '@/lib/mcp/widgets/src/format';
import { renderJobs, renderJob } from '@/lib/mcp/widgets/src/views/jobs';
import { renderApply, renderSubmitted } from '@/lib/mcp/widgets/src/views/apply';
import { renderPay } from '@/lib/mcp/widgets/src/views/pay';
import { renderApplicants, renderPosting } from '@/lib/mcp/widgets/src/views/employer';
import type {
  ApplyViewData,
  ApplicantsViewData,
  JobCard,
  JobsViewData,
  PayViewData,
  PostingViewData,
} from '@/lib/mcp/widgets/src/contracts';
import { WIDGET_BUNDLE_JS } from '@/lib/mcp/widgets/generated/bundle';
import { WIDGET_CSS } from '@/lib/mcp/widgets/src/styles';
import { widgetHtml, widgetResourceUri, viewForResourceUri } from '@/lib/mcp/widgets/resources';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const HOSTILE = '<img src=x onerror="alert(1)">';
const BASE = brand.baseUrl;
/** An en or em dash, built from code points: an escape typed here can land as the character itself. */
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

beforeAll(() => {
  useTestBoard();
});

const job: JobCard = {
  id: '11111111-2222-4333-8444-555555555555',
  title: `PMHNP ${HOSTILE}`,
  employer: 'Fictional Health',
  location: 'Austin, TX',
  workMode: 'In-Person',
  jobType: 'Full-Time',
  pay: '$150k-$180k/yr',
  postedAt: '2026-10-23T00:00:00Z',
  experience: '2-4 yrs',
  easyApply: true,
  verifiedEmployer: false,
  url: `${BASE}/jobs/pmhnp-11111111-2222-4333-8444-555555555555`,
};

const jobs: JobsViewData = {
  view: 'jobs',
  summary: 'PMHNP jobs in TX',
  searchArgs: {},
  total: 31,
  page: 1,
  pageSize: 8,
  hasMore: true,
  jobs: [job, { ...job, id: '99999999-2222-4333-8444-555555555555', easyApply: false }],
  browseUrl: `${BASE}/jobs?location=TX`,
  signedIn: false,
  savedJobIds: [],
};

describe('escaping', () => {
  it('escapes every interpolated value', () => {
    expect(html`<p>${HOSTILE}</p>`.__safe).toBe('<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>');
    expect(escapeText('`\'"&')).toBe('&#96;&#39;&quot;&amp;');
  });

  it('job cards never render a hostile title as markup', () => {
    const out = renderJobs(jobs, { busy: null, now: NOW }).__safe;
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x');
  });

  it('links travel as data-url, never as href', () => {
    const out = renderJobs(jobs, { busy: null, now: NOW }).__safe;
    expect(out).not.toMatch(/\shref=/);
    expect(out).toContain(`data-url="${BASE}/jobs?location=TX"`);
  });
});

describe('isOpenableUrl', () => {
  // The board's own hosts are the ones the server writes onto the document.
  it.each([
    [`https://${brand.domain}/jobs/x`, true],
    [`https://www.${brand.domain}/`, true],
    ['https://checkout.stripe.com/c/pay/cs_test_x', true],
    // A local dev server opens only where the server named it the board's host.
    ['http://localhost:3100/jobs', false],
    ['javascript:alert(1)', false],
    [`https://${brand.domain}.evil.example/`, false],
    [`http://${brand.domain}/jobs`, false],
    ['data:text/html,x', false],
  ])('%s -> %s', (url, expected) => {
    expect(isOpenableUrl(url)).toBe(expected);
  });

  it('opens a local dev server where the issuer is local, and nothing plain http otherwise', () => {
    setBoardForTests({ ...TEST_BOARD, hosts: [...TEST_BOARD.hosts, 'localhost'] });
    try {
      expect(isOpenableUrl('http://localhost:3100/jobs')).toBe(true);
      expect(isOpenableUrl(`http://${brand.domain}/jobs`)).toBe(false);
    } finally {
      useTestBoard();
    }
  });
});

describe('jobs and job views', () => {
  it('offers Apply only where the application can be sent from here', () => {
    const out = renderJobs(jobs, { busy: null, now: NOW }).__safe;
    expect(out.match(/data-action="apply"/g)).toHaveLength(1);
    expect(out).toContain('Show more jobs');
    expect(out).toContain('Posted 2 days ago');
    // The board the card belongs to, as the document names it.
    expect(out).toContain(`31 open jobs on ${brand.name}`);
  });

  it('the Apply button carries the job id only, never the employer-written title', () => {
    // The card turns Apply into a message the host sends as the person's own words.
    const out = renderJobs(jobs, { busy: null, now: NOW }).__safe;
    const apply = out.match(/<button[^>]*data-action="apply"[^>]*>/)![0];
    expect(apply).toContain(`data-id="${job.id}"`);
    expect(apply).not.toMatch(/data-title|data-employer/);
  });

  it('draws the card the way the site does: Easy Apply, an outline on postings that take applications here, the check on a confirmed employer', () => {
    const out = renderJobs(
      { ...jobs, jobs: [{ ...job, verifiedEmployer: true }, { ...job, id: '99999999-2222-4333-8444-555555555555', easyApply: false }] },
      { busy: null, now: NOW },
    ).__safe;
    const cards = out.split('<article').slice(1);
    expect(cards[0]).toContain('pm-card is-clickable is-easy');
    expect(cards[0]).toContain('Easy Apply</button>');
    expect(cards[0]).toContain('Verified employer');
    expect(cards[1]).not.toContain('is-easy');
    expect(cards[1]).not.toContain('Verified employer');
    expect(cards[1]).toContain('View job</button>');
    // Pay leads the pills, as on the site.
    expect(cards[0].indexOf('pm-chip--pay')).toBeLessThan(cards[0].indexOf('Full-Time'));
  });

  it('colors the entry-level label green in the words NP Hiring sends', () => {
    // lib/mcp/tools/shared.ts sends "New grad welcome"; the card matched only "New grads welcome".
    for (const label of ['New grad welcome', 'New grads welcome']) {
      const out = renderJobs({ ...jobs, jobs: [{ ...job, experience: label }] }, { busy: null, now: NOW }).__safe;
      expect(out, label).toContain(`<span class="pm-chip pm-chip--success">${label}</span>`);
    }
    const years = renderJobs({ ...jobs, jobs: [{ ...job, experience: '2+ yrs' }] }, { busy: null, now: NOW }).__safe;
    expect(years).not.toContain('pm-chip--success');
  });

  it('gives every job card, with Easy Apply or without, the hooks its phone layout hangs on', () => {
    // On a phone a card with Easy Apply (the wider button) broke its date over
    // two lines and stacked its buttons, while a card with View job kept one
    // row. The stylesheet now lays both out the same way through two classes
    // on the card; a card that lost either would fall back to the old wrap.
    // What the rules do was checked in a browser, at fourteen widths.
    const out = renderJobs(
      { ...jobs, jobs: [job, { ...job, id: '99999999-2222-4333-8444-555555555555', easyApply: false }] },
      { busy: null, now: NOW },
    ).__safe;
    const cards = out.split('<article').slice(1);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.slice(0, card.indexOf('>'))).toMatch(/class="[^"]*\bpm-job\b/);
      expect(card).toContain('class="pm-meta pm-meta--job"');
      // The date and the buttons are the last row's two halves, in that order.
      expect(card.indexOf('pm-meta--job')).toBeLessThan(card.indexOf('class="pm-actions"'));
    }
    for (const hook of ['.pm-job .pm-chips', '.pm-job .pm-meta--job', '.pm-meta--job .pm-actions', '.pm-meta--job > span:first-child']) {
      expect(WIDGET_CSS, hook).toContain(hook);
    }
  });

  it('never labels a listing as featured or sponsored', () => {
    const out = renderJobs(jobs, { busy: null, now: NOW }).__safe.toLowerCase();
    expect(out).not.toContain('featured');
    expect(out).not.toContain('sponsored');
  });

  it('renders the job detail facts and context pay', () => {
    const out = renderJob(
      {
        view: 'job',
        job: {
          ...job,
          summary: null,
          description: `Line one\n${HOSTILE}`,
          descriptionTruncated: false,
          benefits: ['CME'],
          setting: 'Outpatient',
          population: 'Adults',
          schedules: ['Full-Time'],
          eligibleStates: [],
          screeningQuestionCount: 2,
          practiceAuthority: { state: 'Texas', level: 'restricted', label: 'Restricted', tone: 'restricted' },
          stateName: 'Texas',
          stateMedianK: 160,
          nationalMedianK: 155,
        },
        signedIn: true,
        saved: true,
      },
      { busy: null, now: NOW, descriptionOpen: false, canGoBack: true },
    ).__safe;
    expect(out).toContain('Texas median $160k');
    expect(out).toContain('<span>Population</span><strong>Adults</strong>');
    expect(out).toContain('Back to results');
    expect(out).toContain('aria-pressed="true"');
    expect(out).not.toContain('<img');
  });
});

describe('apply view', () => {
  const data: ApplyViewData = {
    view: 'apply',
    job,
    channel: 'assistant',
    websiteReason: null,
    reviewId: `${MCP_PREFIX}_rv_fictional`,
    profile: {
      name: 'Avery Example',
      email: 'avery@example.test',
      headline: 'Board-certified PMHNP',
      yearsExperience: 4,
      licenseStates: 'TX, OK',
      certifications: 'PMHNP-BC',
      hasResume: true,
    },
    questions: [
      { id: 'q1', text: 'Do you hold an active Texas APRN license?', type: 'boolean', options: [], required: true },
      { id: 'q2', text: 'Earliest start date?', type: 'text', options: [], required: false },
    ],
    coverLetterDraft: `Dear team, ${HOSTILE}`,
    coverLetterMax: 5000,
    warnings: [],
    existingStatus: null,
    profileUrl: `${BASE}/settings`,
    resumeUrl: `${BASE}/settings`,
  };
  const ui = { coverLetter: data.coverLetterDraft, answers: {}, consent: false, errors: {}, busy: null, formError: null };

  it('starts unconsented, shows what is shared, and has one Submit', () => {
    const out = renderApply(data, ui).__safe;
    expect(out).toMatch(/<input type="checkbox" data-field="consent">/);
    expect(out.match(/data-action="submit-application"/g)).toHaveLength(1);
    expect(out).toContain('What Fictional Health will receive');
    expect(out).toContain('avery@example.test');
    expect(out).toContain('Nothing is sent until you press Submit');
    expect(out).not.toContain('<img');
  });

  it('held up only by a missing resume, the card points to the profile instead of the job page', () => {
    const out = renderApply(
      {
        ...data,
        channel: 'website',
        websiteReason: 'A resume is required to apply. Upload one to your profile and try again.',
        reviewId: null,
        questions: [],
        profile: { ...data.profile, hasResume: false },
      },
      ui,
    ).__safe;
    expect(out).toContain('A resume is required to apply.');
    expect(out).toContain('>Upload a resume</button>');
    expect(out).toContain(`data-url="${data.resumeUrl}"`);
    expect(out).not.toContain('submit-application');
    expect(out).not.toContain('Open the job page');
  });

  it('a choice question with no options is answered in a text box, as on the website', () => {
    const out = renderApply(
      { ...data, questions: [{ id: 'q3', text: 'Preferred schedule?', type: 'select', options: [], required: true }] },
      ui,
    ).__safe;
    expect(out).not.toContain('<select');
    expect(out).toMatch(/<input class="pm-input" id="q-q3" type="text"/);
  });

  it('marks each error message, so the card can take it away once the person has dealt with it', () => {
    // The controller clears these in place (no re-render, which would move the cursor).
    const out = renderApply(data, {
      ...ui,
      errors: { q1: 'Please answer this question.', consent: 'Tick the box to agree before submitting.' },
      formError: 'A few things need your attention above.',
    }).__safe;
    expect(out).toMatch(/<div class="pm-error" id="pm-err-q1" data-error-for="q1">Please answer this question\.<\/div>/);
    expect(out).toMatch(/<div class="pm-error" data-error-for="consent">/);
    expect(out).toMatch(/<div data-form-error><div class="pm-alert pm-alert--danger"/);
  });

  it('a job that must be finished on the website offers no Submit at all', () => {
    const out = renderApply({ ...data, channel: 'website', websiteReason: 'Finish this on the site.' }, ui).__safe;
    expect(out).not.toContain('submit-application');
    expect(out).toContain('Open the job page');
  });

  it('tells an auto-declined candidate the truth, not "sent"', () => {
    const out = renderSubmitted({ view: 'apply', submitted: true, applicationId: 'a1', job, autoRejected: true, trackUrl: `${BASE}/my-applications` }).__safe;
    expect(out).toContain('will not move forward');
    expect(out).not.toContain('Application sent');
  });

  it('wraps a long email in "what the employer will receive" instead of running it into the next column', () => {
    // A long address with a plus tag has no break point, and a grid cell
    // keeps the width of its longest word unless told otherwise: it ran into
    // the Headline column.
    const rule = /\.pm-share > div\s*\{([^}]*)\}/.exec(WIDGET_CSS)?.[1] ?? '';
    expect(rule).toMatch(/min-width:\s*0/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('pay view', () => {
  it('charts the middle half with a labelled median and states n', () => {
    const data: PayViewData = {
      view: 'pay',
      title: 'PMHNP pay in Texas',
      focus: { label: 'Texas', n: 42, median: 158000, p25: 140000, p75: 175000 },
      national: { label: 'All US postings', n: 900, median: 155000, p25: 135000, p75: 178000 },
      remote: null,
      topStates: [],
      practiceAuthority: null,
      methodology: 'Advertised pay.',
      guideUrl: `${BASE}/salary-guide/texas`,
      note: null,
    };
    const out = renderPay(data).__safe;
    expect(out).toContain('aria-label="Texas: median $158k, middle half $140k to $175k"');
    // The sample is employers, each counted once, never postings.
    expect(out).toContain('42 employers');
    expect(out).not.toMatch(/\d+ postings/);
    expect(out).toContain(`<p class="pm-kicker">${brand.niche.short} pay</p>`);
    expect(out).not.toMatch(DASH);
  });

  it('draws a median-only row (fewer than 10 employers) without a band, and never prints null', () => {
    const data: PayViewData = {
      view: 'pay',
      title: 'PMHNP pay in Kansas',
      focus: { label: 'Kansas', n: 7, median: 131000, p25: null, p75: null },
      national: { label: 'All US postings', n: 900, median: 155000, p25: 135000, p75: 178000 },
      remote: null,
      topStates: [],
      practiceAuthority: null,
      methodology: 'Advertised pay.',
      guideUrl: `${BASE}/salary-guide/kansas`,
      note: null,
    };
    const out = renderPay(data).__safe;
    expect(out).toContain('aria-label="Kansas: median $131k"');
    expect(out).toContain('Median only · 7 employers');
    expect(out).not.toMatch(/null|NaN|\$0k/);
  });
});

describe('employer views', () => {
  const applicants: ApplicantsViewData = {
    view: 'applicants',
    jobFilter: null,
    statusFilter: null,
    statuses: ['applied', 'screening', 'interview', 'offered', 'hired', 'rejected'],
    reviewUrl: `${BASE}/employer/applicants`,
    applicants: [
      {
        applicationId: 'app-1',
        name: `Jordan ${HOSTILE}`,
        headline: 'PMHNP',
        yearsExperience: 3,
        licenseStates: ['TX'],
        certifications: ['PMHNP-BC'],
        status: 'applied',
        appliedAt: '2026-10-24T00:00:00Z',
        hasResume: true,
        hasCoverLetter: false,
        screeningAnswers: [{ question: 'Licensed in Texas?', answer: 'Yes' }],
        job: { id: 'j1', title: 'PMHNP' },
      },
    ],
  };

  it('lists applicants without scores and moves stages only through a confirm step', () => {
    const out = renderApplicants(applicants, { busy: null, confirmKey: null, now: NOW, watchingPayment: false }).__safe;
    expect(out.toLowerCase()).not.toMatch(/score|rank|match %|recommended/);
    expect(out).toContain(`<p class="pm-kicker">${brand.name} for Employers</p>`);
    expect(out).toContain('data-action="ask-status"');
    expect(out).not.toContain('data-action="confirm-status"');
    expect(out).not.toContain('<img');

    const confirming = renderApplicants(applicants, { busy: null, confirmKey: 'status:app-1:interview', now: NOW, watchingPayment: false }).__safe;
    expect(confirming).toContain('data-action="confirm-status"');
    expect(confirming).toContain('They get an email about the change.');
  });

  describe('posting card', () => {
    const posting: PostingViewData = {
      view: 'posting',
      stage: 'preview',
      preview: {
        title: 'PMHNP',
        employer: 'Fictional Clinic',
        location: 'Denver, CO',
        workMode: 'In-Person',
        jobType: 'Full-Time',
        pay: null,
        experience: null,
        descriptionExcerpt: 'About the role',
        applyMethod: 'platform',
        applyUrl: null,
        contactEmail: 'hiring@clinic.example.test',
        screeningQuestions: [],
        benefits: [],
      },
      errors: ['Add a contact email.'],
      suggestions: [],
      quote: { priceDollars: 199, priceKind: 'first', fundedByCredit: false, creditsAvailable: 0, durationDays: 60 },
      previewId: null,
      checkoutEnabled: true,
      jobId: null,
      inactiveReason: null,
      checkoutUrl: null,
      jobUrl: null,
      dashboardUrl: `${BASE}/employer/dashboard`,
    };
    const ui = { busy: null, confirmKey: null, now: NOW, watchingPayment: false };

    it('the posting preview blocks publishing while anything required is missing', () => {
      const blocked = renderPosting(posting, ui).__safe;
      expect(blocked).toMatch(/data-action="publish"[^>]*disabled/);
      const ready = renderPosting({ ...posting, errors: [], previewId: `${MCP_PREFIX}_pv_fictional` }, ui).__safe;
      expect(ready).not.toMatch(/data-action="publish"[^>]*disabled/);
      expect(ready).toContain('You pay on Stripe before anything goes live.');
    });

    it('cannot publish without a server-held preview, and shows where applications go', () => {
      const noId = renderPosting({ ...posting, errors: [], previewId: null }, ui).__safe;
      expect(noId).toMatch(/data-action="publish"[^>]*disabled/);
      expect(noId).toContain('go to <strong>hiring@clinic.example.test</strong>');
    });

    it('a checkout without a known price still offers payment, with no blank amount', () => {
      const out = renderPosting(
        { ...posting, stage: 'checkout', errors: [], quote: null, jobId: 'job-1', checkoutUrl: `${BASE}/checkout/continue?session_id=cs_test_fictional0000` },
        ui,
      ).__safe;
      expect(out).toContain('>Pay on Stripe</button>');
      expect(out).not.toContain('Pay  on');
    });

    it('says why a posting is not live', () => {
      const closed = renderPosting({ ...posting, stage: 'inactive', errors: [], inactiveReason: 'closed' }, ui).__safe;
      expect(closed).toContain('refunded or disputed');
      const removed = renderPosting({ ...posting, stage: 'inactive', errors: [], inactiveReason: 'removed' }, ui).__safe;
      expect(removed).toContain(`${brand.name} took this posting down`);
      // Where to write when that is unexpected: the board's own support address.
      expect(removed).toContain(`write to ${brand.email.support}`);
      expect(removed).not.toContain('refunded or disputed');
      const expired = renderPosting({ ...posting, stage: 'inactive', errors: [], inactiveReason: 'expired' }, ui).__safe;
      expect(expired).toContain('end of its run');
    });
  });
});

describe('format', () => {
  it('formats in site style', () => {
    expect(moneyK(158400)).toBe('$158k');
    expect(postedLabel('2026-10-25T01:00:00Z', NOW)).toBe('Posted today');
    expect(postedLabel('2026-10-01T00:00:00Z', NOW)).toBe('Posted 3 weeks ago');
    expect(initials('Fictional Behavioral Health')).toBe('FB');
    expect(statusLabel('rejected')).toBe('Not selected');
  });
});

describe('the widget documents', () => {
  it('versioned URIs round-trip and stale versions are refused', () => {
    const uri = widgetResourceUri('jobs');
    expect(viewForResourceUri(uri)).toBe('jobs');
    expect(viewForResourceUri(`ui://${MCP_PREFIX}/jobs.000000000000.html`)).toBeNull();
  });

  it('inline the bundle without anything that could end the script early', () => {
    const doc = widgetHtml('jobs');
    const script = doc.slice(doc.indexOf('<script>') + 8, doc.lastIndexOf('</script>'));
    expect(script.length).toBeGreaterThan(10_000);
    expect(script.toLowerCase()).not.toContain('</script');
  });

  it('the committed bundle is what the sources build to', async () => {
    const build = (await import(path.resolve(__dirname, '../../../scripts/mcp/build-widgets.mjs'))) as {
      buildWidgetBundle: () => Promise<string>;
    };
    const fresh = await build.buildWidgetBundle();
    // Fails when a widget source changed without `node scripts/mcp/build-widgets.mjs`.
    expect(WIDGET_BUNDLE_JS).toBe(fresh);
    const onDisk = fs.readFileSync(path.resolve(__dirname, '../../../lib/mcp/widgets/generated/bundle.ts'), 'utf8');
    expect(onDisk).toContain('GENERATED by scripts/mcp/build-widgets.mjs');
  });
});
