import { z } from 'zod';
import { RESUME_REQUIRED_ERROR } from '@/lib/applications/resume-required';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { runAfterResponse } from '@/lib/after-response';
import { MAX_COVER_LETTER_LENGTH, checkDirectApplication, submitDirectApplication } from '@/lib/applications/submit-direct-application';
import { toOwnResumePath } from '@/lib/resume-storage';
import type {
  ApplicantProfileSummary,
  ApplyViewData,
  ScreeningQuestion,
  ScreeningQuestionType,
  SubmittedApplicationData,
} from '@/lib/mcp/widgets/src/contracts';
import { hasAutoRejectRecord } from '@/lib/applications/auto-reject';
import { defineTool, requireAccess, UserFacingError, type ToolContext, type ToolOutcome } from '@/lib/mcp/server/types';
import { isTestAccount } from '@/lib/mcp/server/test-accounts';
import {
  claimPendingAction,
  completePendingAction,
  createPendingAction,
  releasePendingAction,
} from '@/lib/mcp/server/pending-actions';
import { BOARD_DOMAIN, BOARD_NAME, ROLE_TOKEN } from './board-words';
import { JOB_CARD_SELECT, findPublicJob, isSensitiveScreeningQuestion, sentence, toJobCard, type JobCardRow } from './shared';

/**
 * Applying from the assistant. Two tools, on purpose:
 *
 *  prepare_application  read-only. Shows the person exactly what the employer
 *                       will receive and the employer's screening questions,
 *                       and returns a review_id.
 *  submit_application   the send. It takes that review_id, so it can only
 *                       send to the job the person reviewed, from their own
 *                       account, once. It also requires
 *                       consent_to_share_profile, is marked destructive so
 *                       Claude asks before it runs, and the widget calls it
 *                       only from its own Submit button after the consent box
 *                       is ticked.
 *
 * The submission itself is lib/applications/submit-direct-application.ts, the same code
 * the website's Easy Apply form uses: consent, document ownership, screening
 * rules and both notification emails are identical on every channel. This
 * channel also asks the service to require a resume (requireResume).
 */

const QUESTION_TYPES: readonly ScreeningQuestionType[] = ['boolean', 'text', 'select', 'number'];

function websiteOnlyReason(questions: { questionText: string }[]): string | null {
  return questions.some((q) => isSensitiveScreeningQuestion(q.questionText))
    ? `This employer asks a screening question about personal information (such as health, background or an identity number) that this assistant does not collect. Finish the application on ${BOARD_NAME}, where you answer it directly.`
    : null;
}

const EMPLOYER_SITE_REASON = 'This employer takes applications on its own site. Open the job page to apply there.';

/**
 * The resume rule, in the words both tools that state it use: the review
 * (prepare_application) and the profile check (get_my_profile). One tool
 * saying "required to apply" while the other sent a person with no resume
 * to "the job page to apply there" read as two rules.
 */
export const RESUME_RULE = 'Every application sent from this conversation includes a resume from the profile.';

/** The other half of it: a job that applies on the employer's own site is not sent the profile at all. */
export const PROFILE_NOT_SENT = `The ${BOARD_NAME} profile and resume are not sent for a job that applies on the employer's own site.`;

/** What a test account's review and reply say (lib/mcp/server/test-accounts.ts). */
const TEST_ACCOUNT_NOTE =
  'This is a test account: an application from it is checked exactly as any other, and then nothing is stored and the employer receives nothing.';

/** Sending again would not reopen it, and would let answers be tried until one passes. */
const NOT_SELECTED_REASON =
  'You already applied to this job and were not selected, so there is nothing to send again from here. Your other applications are not affected.';

/** What stands in for a name on the review card when the profile has none. */
export const NAME_NOT_SET = 'Name not set';

/**
 * What the review card shows of the profile. A resume counts only when it sits
 * in the person's own upload folder, the rule the apply service applies
 * (lib/resume-storage.ts toOwnResumePath).
 */
export function profileSummary(userId: string, profile: {
  firstName: string | null;
  lastName: string | null;
  email: string;
  headline: string | null;
  yearsExperience: number | null;
  licenseStates: string | null;
  certifications: string | null;
  resumeUrl: string | null;
}): ApplicantProfileSummary {
  return {
    name: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || NAME_NOT_SET,
    email: profile.email,
    headline: profile.headline,
    yearsExperience: profile.yearsExperience,
    licenseStates: profile.licenseStates,
    certifications: profile.certifications,
    hasResume: !!toOwnResumePath(profile.resumeUrl, userId),
  };
}

export const PROFILE_SELECT = {
  firstName: true,
  lastName: true,
  email: true,
  headline: true,
  yearsExperience: true,
  licenseStates: true,
  certifications: true,
  resumeUrl: true,
} as const;

/** A select question with nothing to choose is answered as text, as on the website's form. */
function questionType(type: string, options: string[]): ScreeningQuestionType {
  if (!QUESTION_TYPES.includes(type as ScreeningQuestionType)) return 'text';
  return type === 'select' && options.length === 0 ? 'text' : (type as ScreeningQuestionType);
}

export const prepareApplication = defineTool({
  name: 'prepare_application',
  title: 'Prepare a job application',
  description:
    `Prepare an application to a ${ROLE_TOKEN} job without sending anything. Shows what the employer will receive from the person's ${BOARD_NAME} profile, the employer's screening questions, and anything to fix first, and returns the review_id that submit_application needs. ` +
    'A resume on the profile is required to apply from this conversation: without one no review_id is issued, and nothing can be sent until a resume is uploaded. A job that applies on the employer\'s own site is not sent the profile at all, and the review says to use the job page. ' +
    'It takes an optional cover letter, which the person can edit in the review. ' +
    'The review lists the employer\'s screening questions, for the person to answer in their own words. ' +
    'Nothing is sent until the person confirms, with the card\'s Submit button or by asking for it to be sent.',
  input: {
    job_id: z.string().trim().min(1).max(500).describe(`The job id from search_jobs or get_job, or the job's ${BOARD_DOMAIN} URL.`),
    cover_letter: z
      .string()
      .max(MAX_COVER_LETTER_LENGTH)
      .optional()
      .describe('A cover letter drafted with the person, in plain text.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  auth: 'required',
  widget: 'apply',
  invoking: 'Preparing the application',
  invoked: 'Application ready to review',
  async run(args, ctx) {
    const access = requireAccess(ctx);
    const job = await findPublicJob(args.job_id, JOB_CARD_SELECT);
    if (!job) throw new UserFacingError(`That job is no longer open on ${BOARD_NAME}. Search again to find current openings.`);
    const card = toJobCard(job, ctx.baseUrl);

    const [profile, existing, questions] = await Promise.all([
      prisma.userProfile.findUnique({ where: { supabaseId: access.userId }, select: PROFILE_SELECT }),
      prisma.jobApplication.findUnique({
        where: { userId_jobId: { userId: access.userId, jobId: job.id } },
        // notes only for the knockout's record (never shown): a withdrawn
        // knockout is still not selected.
        select: { status: true, withdrawnAt: true, consentGiven: true, sourceUrl: true, notes: true },
      }),
      job.applyOnPlatform
        ? prisma.jobScreeningQuestion.findMany({
            where: { jobId: job.id },
            orderBy: { sortOrder: 'asc' },
            // Never the knockout fields: the candidate must not learn which
            // answer disqualifies, here or on the website.
            select: { id: true, questionText: true, questionType: true, options: true, isRequired: true },
          })
        : Promise.resolve([]),
    ]);
    if (!profile) throw new UserFacingError(`Your ${BOARD_NAME} profile could not be found. Sign in on the website once to finish setting it up.`);

    const summary = profileSummary(access.userId, profile);
    const submittedBefore = !!existing && existing.withdrawnAt === null && existing.status !== 'withdrawn' && (existing.consentGiven || existing.sourceUrl === 'platform');
    // The rule the shared service applies (lib/applications/status-fields.ts
    // decideSubmission): a knockout's record decides a new submission while
    // the row is still rejected, or withdrawn after it. One the employer
    // overturned (moved on to screening or later) does not.
    const knockoutStands =
      !!existing && hasAutoRejectRecord(existing.notes) && (existing.status === 'rejected' || existing.withdrawnAt !== null || existing.status === 'withdrawn');
    const reason = !job.applyOnPlatform
      ? EMPLOYER_SITE_REASON
      : (submittedBefore && existing!.status === 'rejected') || knockoutStands
        ? NOT_SELECTED_REASON
        // The shared service refuses this channel's application with no
        // resume, so the review says so up front instead of offering a Submit
        // that fails.
        : websiteOnlyReason(questions) ?? (summary.hasResume ? null : RESUME_REQUIRED_ERROR);
    const channel: ApplyViewData['channel'] = reason ? 'website' : 'assistant';
    const testAccount = channel === 'assistant' && isTestAccount(access);

    const warnings: string[] = [];
    if (channel === 'assistant') {
      if (!profile.firstName && !profile.lastName) warnings.push('Your profile has no name, so the employer will see "A candidate". Add your name in your profile first.');
      if (!profile.headline) warnings.push('Adding a headline to your profile helps the employer place you quickly.');
    }

    const structuredQuestions: ScreeningQuestion[] = questions.map((q) => ({
      id: q.id,
      text: q.questionText,
      type: questionType(q.questionType, q.options),
      options: q.options,
      required: q.isRequired,
    }));
    const reviewId = channel === 'assistant'
      ? await createPendingAction({ userId: access.userId, kind: 'submit_application', subjectId: job.id })
      : null;

    const structured: ApplyViewData = {
      view: 'apply',
      job: card,
      channel,
      websiteReason: reason,
      reviewId,
      profile: summary,
      questions: channel === 'assistant' ? structuredQuestions : [],
      coverLetterDraft: args.cover_letter ?? '',
      coverLetterMax: MAX_COVER_LETTER_LENGTH,
      warnings,
      existingStatus: submittedBefore ? existing!.status : null,
      profileUrl: `${ctx.baseUrl}/settings`,
      resumeUrl: `${ctx.baseUrl}/settings`,
      ...(testAccount ? { testAccount: true } : {}),
    };

    const lines =
      channel === 'website'
        ? websiteLines(card, reason!, structured.resumeUrl)
        : [
            `Ready to apply to ${card.title} at ${card.employer}. Nothing has been sent.`,
            testAccount ? TEST_ACCOUNT_NOTE : '',
            // A review is only issued with a resume on file, so there is one to name.
            `The employer will receive: ${summary.name} (${summary.email})${summary.headline ? `, "${summary.headline}"` : ''}${summary.yearsExperience !== null ? `, ${summary.yearsExperience} years of experience` : ''}${summary.licenseStates ? `, licensed in ${summary.licenseStates}` : ''}, and the resume on file${args.cover_letter ? ', plus the cover letter shown' : ''}.`,
            structured.existingStatus ? `Already applied: current status "${structured.existingStatus}". Submitting again updates the cover letter and answers.` : '',
            ...warnings.map((w) => `Note: ${w}`),
            structuredQuestions.length > 0
              ? `Screening questions (ask the person, use their answers as given):\n${structuredQuestions
                  .map((q) => `  question_id ${q.id}: ${q.text}${q.required ? ' (required)' : ''}${q.type === 'select' && q.options.length > 0 ? ` Options: ${q.options.join(' / ')}` : q.type === 'boolean' ? ' Answer: Yes or No' : ''}`)
                  .join('\n')}`
              : 'No screening questions.',
            `Send only after the person confirms: they press Submit in the card, or they ask you to and you call submit_application with review_id ${reviewId} and consent_to_share_profile set to true.`,
          ];

    return { text: lines.filter(Boolean).join('\n'), structured };
  },
});

/**
 * What the person is told when the application cannot be sent from the
 * conversation. Three cases read differently on purpose: a job on the
 * employer's own site never uses the profile, so a missing resume is not
 * what stands in the way; a job that takes applications here and a profile
 * with no resume is the one case where the resume is; anything else is the
 * reason as given.
 */
function websiteLines(card: { title: string; employer: string; url: string }, reason: string, resumeUrl: string): string[] {
  const head = `${card.title} at ${card.employer}`;
  if (reason === EMPLOYER_SITE_REASON) {
    return [
      `${head} cannot be submitted from here. ${reason}`,
      `${PROFILE_NOT_SENT} Nothing on the profile needs fixing first.`,
      `Job page: ${card.url}`,
    ];
  }
  if (reason === RESUME_REQUIRED_ERROR) {
    return [
      `${head} takes applications on ${BOARD_NAME}, but nothing can be sent from here yet: the profile has no resume. ${RESUME_RULE}`,
      'No review was issued, so there is nothing for submit_application to send.',
      `Upload a resume: ${resumeUrl}`,
      'Then call prepare_application again. On the job page a resume can also be attached with the application itself.',
      `Job page: ${card.url}`,
    ];
  }
  return [`${head} cannot be submitted from here. ${reason}`, `Job page: ${card.url}`];
}

/**
 * An application's outcome, kept on its review so a repeat call returns it:
 * one that was sent, or a test account's, which was checked and not stored.
 */
type SubmitResult =
  | { applicationId: string; autoRejected: boolean; test?: undefined }
  | { applicationId: null; autoRejected: false; test: true };

function submittedOutcome(job: JobCardRow, ctx: ToolContext, result: SubmitResult, repeat: boolean): ToolOutcome {
  const card = toJobCard(job, ctx.baseUrl);
  const structured: SubmittedApplicationData = {
    view: 'apply',
    submitted: true,
    applicationId: result.applicationId,
    job: card,
    autoRejected: result.autoRejected,
    trackUrl: `${ctx.baseUrl}/my-applications`,
    ...(result.test ? { test: true } : {}),
  };
  if (result.test) {
    return {
      text:
        `Test only: nothing was sent to ${card.employer} and no application was stored. ${TEST_ACCOUNT_NOTE} ` +
        `The application for ${card.title} passed every check a real one goes through: the job is open and takes applications here, a resume is on file, and the required questions were answered. ` +
        'Whether the answers meet the employer\'s screening requirements is not reported for a test. It will not appear in list_my_applications.',
      structured,
    };
  }
  const again = repeat ? 'This application was already sent from that review, so nothing was sent twice. ' : '';
  const text = result.autoRejected
    ? `${again}Application received by ${card.employer} for ${card.title}. The answers to the employer's screening questions did not meet its stated requirements, so this application will not move forward. The person's profile is unchanged and they can apply to other roles right away.`
    // No promise of either email: a resubmission over a live application, or
    // an employer who switched notifications off, sends none (hunt SEEKER-25).
    : `${again}Application sent to ${card.employer} for ${card.title}: it is on the employer's applicant list now. They can track it with list_my_applications or at ${structured.trackUrl}.`;
  return { text, structured };
}

/** Sends a reviewed application. Throws, having sent nothing, when it cannot. */
async function sendReviewed(
  userId: string,
  job: JobCardRow | null,
  args: { cover_letter?: string; screening_answers?: { question_id: string; answer: string }[]; consent_to_share_profile: true },
  testAccount: boolean,
): Promise<SubmitResult> {
  if (!job) throw new UserFacingError(`That job is no longer open on ${BOARD_NAME}, so nothing was sent.`);
  if (!job.applyOnPlatform) {
    throw new UserFacingError('This employer takes applications on its own site, so nothing was sent from here. Open the job page to apply.');
  }
  // Same guard as prepare_application, checked again at the send: the
  // employer may have edited the questions in between.
  const questions = await prisma.jobScreeningQuestion.findMany({
    where: { jobId: job.id },
    select: { questionText: true },
  });
  const reason = websiteOnlyReason(questions);
  if (reason) throw new UserFacingError(`Nothing was sent. ${reason}`);

  const application = {
    userId,
    jobId: job.id,
    coverLetter: args.cover_letter,
    consent: args.consent_to_share_profile === true,
    // This channel sends no application without a resume.
    requireResume: true,
    screeningAnswers: (args.screening_answers ?? []).map((a) => ({ questionId: a.question_id, answer: a.answer })),
  };
  // A test account's application goes through the same checks and stops
  // before the write: no row, no email to the employer, no scoring.
  if (testAccount) {
    const checked = await checkDirectApplication(application);
    if (!checked.ok) throw new UserFacingError(`Nothing was sent. ${sentence(checked.error)}`);
    return { applicationId: null, autoRejected: false, test: true };
  }
  const result = await submitDirectApplication(application);
  if (!result.ok) throw new UserFacingError(`Nothing was sent. ${sentence(result.error)}`);
  return { applicationId: result.applicationId, autoRejected: result.autoRejected };
}

export const submitApplication = defineTool({
  name: 'submit_application',
  title: 'Submit a job application',
  description:
    `Send the person's application to the employer: their ${BOARD_NAME} profile, the resume on file, the cover letter and their screening answers. The employer is emailed about a new application that meets its screening requirements, unless they have switched those emails off. ` +
    'It takes the review_id that prepare_application returned, so it sends only an application the person reviewed, from their own account, and only once. ' +
    'Screening answers are sent exactly as given. Each call sends one application, to the one job its review names, and needs the person\'s consent to share their profile with that employer.',
  input: {
    review_id: z.string().trim().min(1).max(100).describe('The review_id from prepare_application for this job.'),
    cover_letter: z.string().max(MAX_COVER_LETTER_LENGTH).optional(),
    screening_answers: z
      .array(
        z.object({
          question_id: z.string().trim().min(1).max(100),
          answer: z.string().trim().max(1000),
        }),
      )
      .max(25)
      .optional(),
    consent_to_share_profile: z
      .literal(true)
      .describe('True only when the person has agreed to share their profile, resume and answers with this employer.'),
  },
  // Idempotent per review: sending the same review_id again returns the first result.
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true },
  auth: 'required',
  widget: 'apply',
  invoking: 'Sending your application',
  invoked: 'Application sent',
  async run(args, ctx) {
    const access = requireAccess(ctx);
    const claim = await claimPendingAction(args.review_id, { userId: access.userId, kind: 'submit_application' });
    if (claim.status === 'unknown') {
      throw new UserFacingError('Nothing was sent. That review is not on this account. Call prepare_application for the job first, then submit with the review_id it returns.');
    }
    if (claim.status === 'expired') throw new UserFacingError('Nothing was sent. That review has expired. Prepare the application again, then submit it.');
    if (claim.status === 'in_progress') {
      throw new UserFacingError('This application is already being sent. Check list_my_applications in a moment rather than sending it again.');
    }
    const jobId = claim.subjectId ?? '';
    if (claim.status === 'done') {
      const first = claim.result as SubmitResult;
      const job = await prisma.job.findUnique({ where: { id: jobId }, select: JOB_CARD_SELECT });
      if (!job) {
        throw new UserFacingError(
          first.test
            ? 'That test application was already checked from this review, and nothing was sent.'
            : 'This application was already sent. Track it with list_my_applications.',
        );
      }
      return submittedOutcome(job, ctx, first, true);
    }

    // The review names one job, and an application must only go to the
    // posting the person reviewed, so any other answer counts as no longer
    // open.
    const found = await findPublicJob(jobId, JOB_CARD_SELECT);
    const job = found?.id === jobId ? found : null;
    let result: SubmitResult;
    try {
      result = await sendReviewed(access.userId, job, args, isTestAccount(access));
    } catch (error) {
      // Nothing reached the employer, so the person can fix it and send the same review.
      await releasePendingAction(args.review_id).catch((err: unknown) =>
        logger.warn('Could not release an assistant application review', { userId: access.userId }, err),
      );
      throw error;
    }
    await completePendingAction(args.review_id, { ...result }).catch(
      (err: unknown) => logger.warn('Could not record an assistant application result', { applicationId: result.applicationId }, err),
    );
    // Nothing reached the employer and no row exists to audit: the log line
    // is the record that the test ran.
    if (result.test) {
      logger.info('Assistant test application checked and not delivered', { userId: access.userId, jobId, connector: ctx.endpoint });
      return submittedOutcome(job!, ctx, result, false);
    }
    const { applicationId } = result;

    // Which channel and which app, for support questions and audits. Never
    // fails the send: the application is already with the employer. Kept
    // alive past the reply (RELIAB-05).
    runAfterResponse('assistant application audit', () => prisma.auditLog
      .create({
        data: {
          action: 'application.submit.assistant',
          actorType: 'user',
          actorId: access.userId,
          targetType: 'application',
          targetId: applicationId,
          metadata: { jobId, client: access.clientName, connector: ctx.endpoint },
        },
      })
      .catch((err: unknown) => logger.warn('Audit log write failed for an assistant application', { applicationId }, err)));

    return submittedOutcome(job!, ctx, result, false);
  },
});
