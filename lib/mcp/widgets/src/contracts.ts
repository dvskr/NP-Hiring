/**
 * Data contracts between the MCP tools (server) and the widget views
 * (browser). Type-only: the server imports these to build tool results and
 * the widget bundle imports them to render, so a tool cannot ship a shape
 * its view does not expect without failing type-check.
 *
 * Every tool result that renders a widget carries one of these as its
 * structuredContent, discriminated by `view`.
 */

export type WidgetView =
  | 'jobs'
  | 'job'
  | 'apply'
  | 'applications'
  | 'pay'
  | 'posting'
  | 'postings'
  | 'applicants'
  | 'facts'
  | 'list';

/** Same labels as the site's job cards (lib/filters.ts workModeLabel). */
export type WorkMode = 'Remote' | 'Hybrid' | 'In-Person';

export interface JobCard {
  id: string;
  title: string;
  employer: string;
  /** Display location: "Austin, TX", or "Remote" for remote roles. */
  location: string;
  workMode: WorkMode | null;
  jobType: string | null;
  /** Display pay, already formatted ("$140k to $165k a year"), or null. */
  pay: string | null;
  /** What the pay figure is for, when that is not plain: yearly pay on a part-time posting. */
  payNote?: string | null;
  /** ISO timestamp of the original posting date, when known. */
  postedAt: string | null;
  /** "New grads welcome", "2+ years", or null. */
  experience: string | null;
  /** True when the application can be submitted from the assistant. */
  easyApply: boolean;
  /**
   * True when the employer posted the job on this board itself, which the
   * website labels "Featured". For the assistant's text: no card shows it.
   */
  employerPosted?: boolean;
  /** True when the board has confirmed who the employer is (the blue check on the site). */
  verifiedEmployer: boolean;
  /** The job's page on the board's website. */
  url: string;
  /**
   * Set on a search result that stands for several postings of one role (the
   * same employer, title, pay, work mode and schedule, posted once for each
   * place). The card's id and url are one of those postings.
   */
  alsoPosted?: RepeatPostings;
}

export interface RepeatPostings {
  /** Postings the result stands for, its own included. */
  postings: number;
  /** Distinct places among them. */
  placeCount: number;
  /** The first of those places in alphabetical order, at most a dozen. */
  places: string[];
  /** The place of the posting the card's id is, when it names one. */
  ownPlace: string | null;
}

export interface JobsViewData {
  view: 'jobs';
  /** One line describing the search, for the header ("Remote jobs in Texas"). */
  summary: string;
  /** Arguments that reproduce this search, so the widget can fetch the next page. */
  searchArgs: Record<string, unknown>;
  /** Results the search has, after repeat postings of one role are folded into one. */
  total: number;
  /** Open postings behind those results. Absent on lists that fold nothing. */
  postings?: number;
  /** True when more postings match than were read: `postings` and `total` are then the least there are. */
  postingsCapped?: boolean;
  page: number;
  pageSize: number;
  hasMore: boolean;
  jobs: JobCard[];
  /** The same search on the website. */
  browseUrl: string;
  /** Whether the person is signed in, so Save can be offered or explained. */
  signedIn: boolean;
  savedJobIds: string[];
}

/**
 * A state's classification under the board's own state rules (the pack's
 * authority member): the tier's id, its label, and the tone its badge takes.
 * Absent on a board whose pack classifies no state.
 */
export interface PracticeAuthorityInfo {
  state: string;
  /** The tier's stable id in the pack ('independent'). */
  level: string;
  label: string;
  /** Least to most restricted, as the website's badges colour it. */
  tone: 'open' | 'conditional' | 'restricted';
}

export interface JobDetail extends JobCard {
  summary: string | null;
  /** Plain-text description, trimmed for the conversation. */
  description: string;
  descriptionTruncated: boolean;
  benefits: string[];
  setting: string | null;
  population: string | null;
  schedules: string[];
  /** States a remote role is limited to; empty means not restricted. */
  eligibleStates: string[];
  screeningQuestionCount: number;
  practiceAuthority: PracticeAuthorityInfo | null;
  /** The job's state by name, for the state median's label; null when it names none. */
  stateName: string | null;
  /** Advertised pay medians for context, in thousands; 0 when the sample is too small. */
  stateMedianK: number;
  nationalMedianK: number;
}

export interface JobViewData {
  view: 'job';
  job: JobDetail;
  signedIn: boolean;
  saved: boolean;
}

export type ScreeningQuestionType = 'boolean' | 'text' | 'select' | 'number';

export interface ScreeningQuestion {
  id: string;
  text: string;
  type: ScreeningQuestionType;
  options: string[];
  required: boolean;
}

export interface ApplicantProfileSummary {
  name: string;
  email: string;
  headline: string | null;
  yearsExperience: number | null;
  licenseStates: string | null;
  certifications: string | null;
  hasResume: boolean;
}

export interface ApplyViewData {
  view: 'apply';
  job: JobCard;
  /**
   * 'assistant': can be submitted from this card.
   * 'website': must be finished on the board's website, either because the
   * employer takes applications on its own site or because a screening
   * question asks for information this connector does not collect.
   */
  channel: 'assistant' | 'website';
  websiteReason: string | null;
  /** The review submit_application needs. Null when the application must be finished on the website. */
  reviewId: string | null;
  /** What the employer will see about the candidate. */
  profile: ApplicantProfileSummary;
  questions: ScreeningQuestion[];
  /** Draft cover letter the assistant prepared, if any. Editable in the widget. */
  coverLetterDraft: string;
  coverLetterMax: number;
  /** Things to fix or know before submitting. */
  warnings: string[];
  /** Set when the candidate has already applied to this job. */
  existingStatus: string | null;
  /** Links the widget may open. */
  profileUrl: string;
  resumeUrl: string;
  /**
   * True when the signed-in account is one whose applications are tests:
   * submitting checks everything and delivers nothing.
   */
  testAccount?: boolean;
}

export interface SubmittedApplicationData {
  view: 'apply';
  submitted: true;
  /** Null when a test account's application was checked and not stored. */
  applicationId: string | null;
  job: JobCard;
  autoRejected: boolean;
  trackUrl: string;
  /** True when nothing was sent: the account is a test account. */
  test?: boolean;
}

export type ApplicationStatus =
  | 'applied'
  | 'screening'
  | 'interview'
  | 'offered'
  | 'hired'
  | 'rejected'
  | 'withdrawn';

export interface ApplicationRow {
  id: string;
  status: ApplicationStatus | string;
  appliedAt: string;
  statusUpdatedAt: string | null;
  /** True for applications submitted on the platform; false for tracked click-outs. */
  submittedOnPlatform: boolean;
  job: {
    id: string;
    title: string;
    employer: string;
    location: string;
    url: string | null;
    live: boolean;
  };
}

export interface ApplicationsViewData {
  view: 'applications';
  applications: ApplicationRow[];
  manageUrl: string;
}

export interface PaySummary {
  label: string;
  /** Sample size behind the figures. */
  n: number;
  /** Dollars per year. p25/p75 are null when only the median clears the sample gate. */
  median: number;
  p25: number | null;
  p75: number | null;
}

export interface PayViewData {
  view: 'pay';
  title: string;
  /** The segment asked about (a state or remote), when it cleared the sample gates. */
  focus: PaySummary | null;
  national: PaySummary | null;
  remote: PaySummary | null;
  /** Up to five states for comparison, highest median first. */
  topStates: PaySummary[];
  practiceAuthority: PracticeAuthorityInfo | null;
  /** Plain statement of what the figures are, shown under the chart. */
  methodology: string;
  guideUrl: string;
  /** Set when the requested segment was too small to publish. */
  note: string | null;
}

/** closed: taken down after its payment was refunded or disputed. */
export type PostingStatus = 'draft' | 'pending_payment' | 'live' | 'paused' | 'expired' | 'closed';

export interface PostingPreview {
  title: string;
  employer: string;
  location: string;
  workMode: WorkMode | null;
  jobType: string;
  pay: string | null;
  experience: string | null;
  descriptionExcerpt: string;
  applyMethod: 'platform' | 'url';
  applyUrl: string | null;
  /** Where application notifications and the posting's private dashboard link go. */
  contactEmail: string;
  screeningQuestions: string[];
  benefits: string[];
}

export interface PriceQuote {
  priceDollars: number;
  priceKind: 'first' | 'standard' | 'renewal';
  fundedByCredit: boolean;
  creditsAvailable: number;
  durationDays: number;
}

export interface PostingViewData {
  view: 'posting';
  /** inactive: an existing posting that is paused or has expired. */
  stage: 'preview' | 'checkout' | 'published' | 'inactive';
  preview: PostingPreview;
  /** Problems that block publishing. */
  errors: string[];
  /** Suggestions that do not block publishing. */
  suggestions: string[];
  quote: PriceQuote | null;
  /**
   * The server-held copy of this preview, which publish_job_posting takes.
   * Null unless the preview is clean and the account can publish.
   */
  previewId: string | null;
  /** Whether this connector may open Stripe checkout. */
  checkoutEnabled: boolean;
  /** Set once a checkout exists or the post is live. */
  jobId: string | null;
  /** For the inactive stage: why the posting is not live. */
  /** removed: taken down by the board, which only its staff can undo. */
  inactiveReason: 'paused' | 'expired' | 'closed' | 'removed' | null;
  checkoutUrl: string | null;
  jobUrl: string | null;
  dashboardUrl: string;
}

export interface PostingRow {
  jobId: string;
  title: string;
  location: string;
  status: PostingStatus;
  createdAt: string;
  expiresAt: string | null;
  views: number;
  applyClicks: number;
  applicants: number;
  newApplicants: number;
  url: string | null;
}

export interface PostingsViewData {
  view: 'postings';
  postings: PostingRow[];
  dashboardUrl: string;
  creditsAvailable: number;
}

export interface ApplicantRow {
  applicationId: string;
  name: string;
  headline: string | null;
  yearsExperience: number | null;
  licenseStates: string[];
  certifications: string[];
  status: ApplicationStatus | string;
  appliedAt: string;
  hasResume: boolean;
  hasCoverLetter: boolean;
  /** The candidate's own answers to the employer's screening questions. */
  screeningAnswers: { question: string; answer: string }[];
  job: { id: string; title: string };
}

export interface ApplicantsViewData {
  view: 'applicants';
  jobFilter: { id: string; title: string } | null;
  statusFilter: string | null;
  applicants: ApplicantRow[];
  statuses: readonly string[];
  /** Where the employer reviews resumes and full profiles. */
  reviewUrl: string;
}

/** A link a card may open. Only the board's own addresses and Stripe checkout open. */
export interface CardLink {
  label: string;
  url: string;
}

export interface FactRow {
  label: string;
  value: string;
  /** The row the card should draw the eye to (a total, a verdict). */
  emphasis?: boolean;
}

export interface FactSection {
  heading: string | null;
  rows: FactRow[];
}

/**
 * A card of labelled figures: a calculator result, a profile check, jobs
 * side by side. One generic view, so every tool that answers with facts
 * gets a card without a renderer of its own.
 */
export interface FactsViewData {
  view: 'facts';
  /** Small label above the title ("1099 vs W-2", "Your profile"). */
  kicker: string;
  title: string;
  subtitle: string | null;
  sections: FactSection[];
  /** Assumptions and method, shown small under the figures. */
  notes: string[];
  links: CardLink[];
}

export interface ListItem {
  title: string;
  subtitle: string | null;
  /** A short trailing detail: a date, a price, a frequency. */
  meta: string | null;
  badge: string | null;
  url: string | null;
}

/** A card of titled rows that open pages: articles, guides, alerts. */
export interface ListViewData {
  view: 'list';
  kicker: string;
  title: string;
  subtitle: string | null;
  items: ListItem[];
  /** Shown when there are no items. */
  emptyText: string;
  links: CardLink[];
}

export type WidgetData =
  | JobsViewData
  | JobViewData
  | ApplyViewData
  | SubmittedApplicationData
  | ApplicationsViewData
  | PayViewData
  | PostingViewData
  | PostingsViewData
  | ApplicantsViewData
  | FactsViewData
  | ListViewData;
