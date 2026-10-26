/**
 * POST /api/jobs/post-free — post a job WITHOUT a charge.
 *
 * The path name is historical (the wizard already calls it); the semantics
 * are "create the listing now if the employer's next post costs nothing".
 * Two modes qualify, resolved in this order (lib/pricing.ts):
 *
 *   promo — config.isPromoActive(): every post is free through
 *           config.promoEndsLabel. Row: paymentStatus 'promo', pricingTier
 *           'pro'. Guarded by config.promoMaxActivePostsPerDomain (an abuse
 *           cap on concurrently-live promo posts per signup domain — never
 *           marketed) → 403 { promoCapReached: true }. A 5-post pack credit
 *           is not read and stays unspent.
 *   pack  — after the promo, the employer holds a usable 5-post pack credit
 *           (lib/post-packs.ts#getPackCreditStatus). One credit is spent
 *           inside the transaction (spendPackCredit: a conditional
 *           decrement). Row: paymentStatus 'pack', pricingTier 'pack',
 *           postPackId. A credit a parallel post spent first → 409
 *           { packCreditUnavailable: true }.
 * (The Employer plan mode went in phase 2 of the 2027 re-price.)
 *
 * Anything else is a paid post → 403 { requiresPayment: true, mode, tier,
 * price, priceCents } and the wizard redirects to /api/create-checkout,
 * which prices the intro/pro rung itself.
 *
 * Both gate checks + all writes run in ONE Serializable transaction (audit
 * #6 + #7) so two parallel submitters can't both slip past the cap or spend
 * one credit twice, and a failed slug update, EmployerJob insert or
 * screening question insert can't orphan a Job row (nor spend a credit for
 * no post: code review M4, the questions were written after the commit, so a
 * failure there spent a credit, answered 500, and a resubmit spent another).
 * A serialization conflict answers 409 { retry: true }, never 500. Every row
 * snapshots the SIGNUP email domain into EmployerJob.quotaDomain — the
 * immutable anchor for the promo cap and the per-domain intro price.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Job, Prisma } from '@prisma/client';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { config, type PostingMode, type PricingTier } from '@/lib/config';
import { expiresFromNow } from '@/lib/expires-at';
import { sendConfirmationEmail } from '@/lib/email-service';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { sanitizeJobPosting, sanitizeText, normalizeContentWhitespace } from '@/lib/sanitize';
import { logger } from '@/lib/logger';
import { slugify } from '@/lib/utils';
import { pingSearchEnginesForJobPage } from '@/lib/job-page-indexing';
import { normalizeSalary } from '@/lib/salary-normalizer';
import { formatDisplaySalary } from '@/lib/salary-display';
import { computeQualityScore } from '@/lib/utils/quality-score';
import { inngest } from '@/lib/inngest/client';
import { parseLocation } from '@/lib/location-parser';
import { summarizeForMeta } from '@/lib/description-cleaner';
import { normalizeExperienceFromInput } from '@/lib/experience-label';
import { brand } from '@/config/brand';
import {
  isFreeEmailDomain,
  domainOf,
  countActivePromoPostsForDomain,
  resolvePostingMode,
} from '@/lib/pricing';
import {
  PackCreditUnavailableError,
  getPackCreditStatus,
  spendPackCredit,
  type PackCreditStatus,
} from '@/lib/post-packs';
// Typed-field validation + deterministic classification shared with the
// paid path, so the two posting routes can never drift on shape rules.
import {
  WORK_MODES,
  normalizeWorkMode,
  deriveWorkModeFlags,
  validateBenefits,
  validateSetting,
  validatePopulation,
  classifyEmployerJob,
  sanitizeLogoUrl,
} from './_lib/job-attributes';

/** Modes this route can fulfil without a charge. Paid modes 403 to checkout. */
type NoChargeMode = Extract<PostingMode, 'promo' | 'pack'>;

/** Prisma's code for a Serializable transaction that lost a concurrent-write race. */
const SERIALIZATION_FAILURE_CODE = 'P2034';

function isSerializationFailure(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === SERIALIZATION_FAILURE_CODE;
}

class PromoCapReachedError extends Error {
  constructor(public readonly activeCount: number) {
    super('Promo post cap reached for domain');
    this.name = 'PromoCapReachedError';
  }
}

/** The credits left after a pack post, as the response carries them. */
function packCreditsJson(status: PackCreditStatus) {
  return { remaining: status.remaining, used: status.used, total: status.total, expiresAt: status.expiresAt?.toISOString() ?? null };
}

const SCREENING_QUESTION_TYPES: readonly string[] = ['boolean', 'text', 'select', 'number'];
const MAX_SCREENING_QUESTIONS = 5;

/** A screening question row, written with the post inside its transaction once the post has an id. */
type ScreeningQuestionRow = Omit<Prisma.JobScreeningQuestionCreateManyInput, 'jobId'>;

/**
 * The screening questions a platform-apply post carries, as rows: the first
 * five submitted, those with text, each sanitized, sortOrder their place in
 * what was submitted.
 */
function screeningQuestionRows(submitted: unknown): ScreeningQuestionRow[] {
  if (!Array.isArray(submitted)) return [];
  return submitted.slice(0, MAX_SCREENING_QUESTIONS).flatMap((q, i): ScreeningQuestionRow[] => {
    if (!q?.text || typeof q.text !== 'string') return [];
    return [{
      questionText: sanitizeText(q.text, 200),
      questionType: SCREENING_QUESTION_TYPES.includes(q.type) ? q.type : 'boolean',
      options: Array.isArray(q.options) ? q.options.map((o: unknown) => sanitizeText(String(o), 100)).slice(0, 10) : [],
      isRequired: !!q.required,
      isKnockout: !!q.knockout,
      knockoutAnswer: q.knockoutAnswer ? sanitizeText(String(q.knockoutAnswer), 100) : null,
      sortOrder: i,
    }];
  });
}

export async function POST(request: NextRequest) {
  // Rate limiting - strict for job posting
  const rateLimitResult = await rateLimit(request, 'postJob', RATE_LIMITS.postJob);
  if (rateLimitResult) return rateLimitResult;

  try {
    // Parse and sanitize request body
    const body = await request.json();

    // Validate required fields before sanitization
    const {
      title,
      employer,
      location,
      mode,
      jobType,
      description,
      applyLink,
      applyOnPlatform,
      contactEmail,
      minSalary,
      maxSalary,
      salaryPeriod,
      companyWebsite,
      pricing,
      benefits,
      setting,
      population,
      companyLogoUrl,
      minYearsExperience,
      maxYearsExperience,
      newGradFriendly,
      experienceQualifier,
    } = body;

    const missingFields = [];
    if (!title) missingFields.push('title');
    if (!employer) missingFields.push('company name');
    if (!location) missingFields.push('location');
    if (!mode) missingFields.push('work mode');
    if (!jobType) missingFields.push('job type');
    if (!description) missingFields.push('description');
    if (!applyOnPlatform && !applyLink) missingFields.push('apply URL');
    if (!contactEmail) missingFields.push('contact email');

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missingFields.join(', ')}` },
        { status: 400 }
      );
    }

    // Typed-field validation before auth, quota or any database work.
    const workMode = normalizeWorkMode(mode);
    if (!workMode) {
      return NextResponse.json(
        { error: `Work mode must be one of: ${WORK_MODES.join(', ')}` },
        { status: 400 }
      );
    }
    const benefitsResult = validateBenefits(benefits);
    if (!benefitsResult.ok) {
      return NextResponse.json({ error: benefitsResult.error }, { status: 400 });
    }
    const settingResult = validateSetting(setting);
    if (!settingResult.ok) {
      return NextResponse.json({ error: settingResult.error }, { status: 400 });
    }
    const populationResult = validatePopulation(population);
    if (!populationResult.ok) {
      return NextResponse.json({ error: populationResult.error }, { status: 400 });
    }

    // Sanitize all inputs
    const sanitized = sanitizeJobPosting({
      title,
      employer,
      location,
      // Strip non-breaking-space artefacts (Quill emits these when content
      // is pasted from Word) before sanitizing — otherwise the body shows
      // mid-word line breaks at render time and `descriptionSummary` gets
      // populated with literal `&nbsp;` markup.
      description: normalizeContentWhitespace(description ?? ''),
      applyLink,
      contactEmail,
      mode: workMode,
      jobType,
      companyWebsite,
      minSalary,
      maxSalary,
      salaryPeriod,
    });

    // ── Auth FIRST — the signup email is the canonical identity for every
    // per-domain rule (promo cap, intro price).
    // Audit #26: previously the FREE_EMAIL_DOMAINS check + quota count both keyed off
    // the form-submitted contactEmail, which let an attacker submit each free post with
    // a different `bob@example<N>.com` and bypass the per-domain cap. Now we anchor
    // both checks to the signup email — what they typed in the form is just public
    // contact info and can't shift the quota or sneak past the spam block.
    let userId: string;
    let signupEmail: string;
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user || !user.email) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }

      const profile = await prisma.userProfile.findUnique({
        where: { supabaseId: user.id }
      });

      if (!profile) {
        return NextResponse.json({ error: 'User profile not found' }, { status: 403 });
      }

      if (profile.role !== 'employer') {
        return NextResponse.json(
          { error: 'Only employer accounts can post jobs. Please sign up as an employer.' },
          { status: 403 }
        );
      }

      userId = user.id;
      signupEmail = user.email;
    } catch (error) {
      logger.warn('Failed to fetch user session in post-free', { error });
      return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
    }

    // Block free email providers — keyed off SIGNUP email, not form input.
    // Shared list lives in lib/pricing.ts so this gate and the read-only
    // quote endpoint can never drift.
    const signupDomain = domainOf(signupEmail);
    if (!signupDomain || isFreeEmailDomain(signupDomain)) {
      return NextResponse.json(
        {
          error: 'Company email required',
          message: 'Job posts require a company email account (not Gmail, Yahoo, etc.). Please sign up with your company email.'
        },
        { status: 400 }
      );
    }

    // Per-domain rules are anchored to an IMMUTABLE per-row snapshot
    // (EmployerJob.quotaDomain), not to mutable contactEmail or nullable userId.
    //
    // Why the immutable snapshot:
    //   - Editing contactEmail later cannot shift the count (audit #23)
    //   - Account deletion / userId being nulled cannot drop the count
    //   - Form contactEmail can be anything (recruiter posting on behalf of a
    //     client, multi-brand orgs); the rules are keyed off who signed up
    //   - Hard-deleting the row is the only way to drop the count, and that's
    //     admin-only (audit #25 — separate concern)
    const quotaDomain = signupDomain;

    // ── Which rung does this post land on? ──────────────────────────────
    // A pack credit matters only once the promo is over (the promo wins and
    // the credit stays unspent), so it is read only then. This read decides
    // the mode; the credit itself is spent inside the transaction below.
    const now = new Date();
    const packCredit = config.isPromoActive(now) ? null : await getPackCreditStatus(userId, now);
    const quote = await resolvePostingMode({ quotaDomain, hasPackCredit: packCredit?.usable ?? false, now });

    if (!quote.willBeFree) {
      logger.info('Post requires payment — redirecting to checkout', {
        domain: quotaDomain,
        userId,
        mode: quote.mode,
        tier: quote.tier,
      });
      return NextResponse.json(
        {
          error: `This post is $${quote.price} (${config.getTierLabel(quote.tier)} post, ${config.durationDays} days). Continue to payment to publish it.`,
          requiresPayment: true,
          mode: quote.mode,
          tier: quote.tier,
          price: quote.price,
          priceCents: quote.priceCents,
        },
        { status: 403 }
      );
    }

    const postingMode: NoChargeMode = quote.mode === 'pack' ? 'pack' : 'promo';
    const paymentStatus = postingMode;
    const pricingTier: PricingTier = quote.tier;

    // Validate sanitized URL (only for external apply)
    if (!applyOnPlatform && !sanitized.applyLink) {
      return NextResponse.json(
        { error: 'Invalid apply link URL' },
        { status: 400 }
      );
    }

    // Generate unique tokens
    const editToken = crypto.randomBytes(32).toString('hex');
    const dashboardToken = crypto.randomBytes(32).toString('hex');

    // Every post — promo, pack, intro, pro — runs config.durationDays.
    // UTC math via expiresFromNow — setDate() drifted across DST boundaries.
    const expiresAt = expiresFromNow(config.durationDays, now);

    // Parse salary values
    let parsedMinSalary = (() => {
      const val = Number(sanitized.minSalary);
      return (Number.isFinite(val) && !Number.isNaN(val)) ? val : null;
    })();
    let parsedMaxSalary = (() => {
      const val = Number(sanitized.maxSalary);
      return (Number.isFinite(val) && !Number.isNaN(val)) ? val : null;
    })();
    // Phase 1 guard (2026-06-01): catalog audit found 1 employer-posted
    // row with min=$277,614 / max=$86 because the raw values were stored
    // without inversion check. Swap when reversed so downstream queries
    // (BETWEEN min AND max) work as expected. Pure swap is the right move
    // here — if either value is clearly wrong, the user fixes it via the
    // dashboard edit flow rather than us silently nulling their input.
    if (parsedMinSalary != null && parsedMaxSalary != null && parsedMinSalary > parsedMaxSalary) {
      [parsedMinSalary, parsedMaxSalary] = [parsedMaxSalary, parsedMinSalary];
    }
    const parsedSalaryPeriod = sanitized.salaryPeriod || null;
    // Server-side sanitize the free-text qualifier first, then hand the
    // pre-sanitized value to the structural normalizer. Caller is
    // authoritative — client-provided experienceLabel is ignored.
    const sanitizedQualifier = typeof experienceQualifier === 'string'
      ? sanitizeText(experienceQualifier, 80) || null
      : null;
    const experienceFields = normalizeExperienceFromInput({
      minYearsExperience,
      newGradFriendly,
      experienceQualifier: sanitizedQualifier,
    });

    // Normalize salary data for filtering and display
    const normalizedSalary = normalizeSalary({
      minSalary: parsedMinSalary,
      maxSalary: parsedMaxSalary,
      salaryPeriod: parsedSalaryPeriod,
      title: sanitized.title,
    });

    // Generate display salary string
    const displaySalary = formatDisplaySalary(
      normalizedSalary.normalizedMinSalary,
      normalizedSalary.normalizedMaxSalary,
      parsedSalaryPeriod
    );

    // Compute quality score — employer-posted jobs get the employer bonus (+30)
    const qualityScore = computeQualityScore({
      applyLink: sanitized.applyLink,
      displaySalary,
      normalizedMinSalary: normalizedSalary.normalizedMinSalary,
      normalizedMaxSalary: normalizedSalary.normalizedMaxSalary,
      descriptionSummary: summarizeForMeta(sanitized.description),
      description: sanitized.description,
      city: null,
      state: null,
      isEmployerPosted: true,
    });

    // Parse location into structured fields
    const parsedLoc = parseLocation(sanitized.location);
    // The submitted work mode decides remote/hybrid; the location string
    // ("Remote", "Austin, TX") is only a fallback signal.
    const workModeFlags = deriveWorkModeFlags(workMode, parsedLoc);
    // Same deterministic profession classifier ingestion stores, so employer
    // posts are not left NULL (the legacy unclassified exemption).
    const profession = classifyEmployerJob(sanitized.title, sanitized.description);

    // Screening questions (platform-apply posts only), written with the post
    // inside the transaction below (code review M4).
    const screeningQuestions = applyOnPlatform ? screeningQuestionRows(body.screeningQuestions) : [];

    // Audit #6 + #7: gate-check + writes wrapped in a single Serializable
    // transaction. Postgres aborts the second transaction if two requests
    // race past the count check. Atomicity also fixes the orphan-row risk
    // when the slug update, the employerJob insert or the screening question
    // insert fails after the job insert, and a pack credit is spent only with
    // the post it paid for.
    let job: Job;
    let packAfter: PackCreditStatus | null;
    try {
      const written = await prisma.$transaction(async (tx) => {
        let postPackId: string | null = null;
        if (postingMode === 'promo') {
          // Promo abuse cap — live promo posts per signup domain, counted
          // from the immutable quotaDomain snapshot. Re-checked inside the
          // Serializable transaction so two parallel submitters at the same
          // domain can't both slip past.
          const activePromo = await countActivePromoPostsForDomain(quotaDomain, tx, now);
          if (activePromo >= config.promoMaxActivePostsPerDomain) {
            throw new PromoCapReachedError(activePromo);
          }
        } else {
          // Pack credit, spent in the same transaction as the post: no post
          // without a credit, and no credit spent for a post that rolled back.
          ({ packId: postPackId } = await spendPackCredit(tx, userId, now));
        }

        const created = await tx.job.create({
          data: {
            title: sanitized.title,
            employer: sanitized.employer,
            location: sanitized.location,
            jobType: sanitized.jobType || null,
            mode: sanitized.mode || null,
            description: sanitized.description,
            descriptionSummary: summarizeForMeta(sanitized.description),
            applyLink: applyOnPlatform ? null : sanitized.applyLink,
            applyOnPlatform: applyOnPlatform || false,
            minSalary: parsedMinSalary,
            maxSalary: parsedMaxSalary,
            salaryPeriod: parsedSalaryPeriod,
            normalizedMinSalary: normalizedSalary.normalizedMinSalary,
            normalizedMaxSalary: normalizedSalary.normalizedMaxSalary,
            salaryIsEstimated: normalizedSalary.salaryIsEstimated,
            salaryConfidence: normalizedSalary.salaryConfidence,
            displaySalary,
            city: parsedLoc.city,
            state: parsedLoc.state,
            stateCode: parsedLoc.stateCode,
            isRemote: workModeFlags.isRemote,
            isHybrid: workModeFlags.isHybrid,
            professionClass: profession.professionClass,
            professionConfidence: profession.professionConfidence,
            // isFeatured stays false on every employer post. Top placement
            // and the Featured badge come from the EmployerJob relation
            // (see lib/utils/job-sort.ts and JobCard), not from this flag.
            isFeatured: false,
            isPublished: true,
            isVerifiedEmployer: true,
            sourceType: 'employer',
            expiresAt,
            // A new posting's content is new now (sitemap lastmod, the
            // page's "Last updated"; indexing audit fixSoon 5).
            contentChangedAt: now,
            qualityScore,
            benefits: benefitsResult.value,
            setting: settingResult.value,
            population: populationResult.value,
            minYearsExperience: experienceFields.minYearsExperience,
            maxYearsExperience: experienceFields.maxYearsExperience,
            newGradFriendly: experienceFields.newGradFriendly,
            experienceQualifier: experienceFields.experienceQualifier,
            experienceLabel: experienceFields.experienceLabel,
          },
        });

        // Use the shared slugify helper so this path and the ingestion path
        // can never drift on slug shape. slug is set here at insert and
        // intentionally NOT updated on subsequent employer edits — the
        // canonical URL stays stable even if the employer renames the job.
        const computedSlug = slugify(sanitized.title, created.id);

        const updated = await tx.job.update({
          where: { id: created.id },
          data: { slug: computedSlug },
        });

        await tx.employerJob.create({
          data: {
            employerName: sanitized.employer,
            contactEmail: sanitized.contactEmail,
            companyWebsite: sanitized.companyWebsite || null,
            companyLogoUrl: sanitizeLogoUrl(companyLogoUrl),
            jobId: created.id,
            editToken,
            dashboardToken,
            paymentStatus,
            pricingTier,
            userId: userId,
            // Immutable quota anchor — never written by any update path
            quotaDomain: quotaDomain,
            ...(postPackId && { postPackId }),
          },
        });

        if (screeningQuestions.length > 0) {
          await tx.jobScreeningQuestion.createMany({
            data: screeningQuestions.map((question) => ({ ...question, jobId: created.id })),
          });
        }

        // The credits left once this post spent one, read through the same
        // snapshot so a parallel post cannot make the count stale.
        const remaining = postPackId ? await getPackCreditStatus(userId, now, tx) : null;
        return { job: updated, packAfter: remaining };
      }, { isolationLevel: 'Serializable' });
      job = written.job;
      packAfter = written.packAfter;
    } catch (txErr) {
      if (txErr instanceof PromoCapReachedError) {
        logger.warn('Promo post cap reached for domain', {
          domain: quotaDomain,
          userId,
          activeCount: txErr.activeCount,
          cap: config.promoMaxActivePostsPerDomain,
        });
        return NextResponse.json(
          {
            error: `Your organization (${quotaDomain}) already has the maximum number of live posts for our launch period. Close or archive an existing post to publish a new one, or contact ${brand.email.support}.`,
            promoCapReached: true,
          },
          { status: 403 }
        );
      }
      if (txErr instanceof PackCreditUnavailableError) {
        // The credit the quote saw was spent (or expired) before this
        // transaction: nothing was written. The next quote prices the post.
        logger.info('5-post pack credit gone before the post was written', { domain: quotaDomain, userId });
        return NextResponse.json(
          {
            error: `Your ${config.packPosts}-post pack has no posts left. Refresh the page to see the price of this post.`,
            packCreditUnavailable: true,
          },
          { status: 409 }
        );
      }
      if (isSerializationFailure(txErr)) {
        // Another post from the same account (or domain) committed first;
        // nothing was written, and a retry decides afresh.
        logger.info('Post-free transaction lost a concurrent write; asking for a retry', { domain: quotaDomain, userId, mode: postingMode });
        return NextResponse.json(
          {
            error: 'Another post from your account was saved at the same moment. Please try again.',
            retry: true,
          },
          { status: 409 }
        );
      }
      throw txErr;
    }

    const slug = job.slug!;
    if (screeningQuestions.length > 0) {
      logger.info('Screening questions created', { jobId: job.id, count: screeningQuestions.length });
    }

    // Send confirmation email with dashboard token + the listing duration so
    // the email's "N-day listing" line matches the actual expiresAt written
    // to the DB (audit #30), plus the mode so the template can say "free
    // during our launch promo", or name the pack a pack post was made with
    // and the credits it left.
    try {
      await sendConfirmationEmail(
        sanitized.contactEmail,
        sanitized.title,
        job.id,
        dashboardToken,
        undefined, // unsubscribeToken — looked up by email
        config.durationDays,
        undefined, // invoice — no charge on a promo or pack post
        postingMode,
        packAfter ? { remaining: packAfter.remaining, expiresAt: packAfter.expiresAt } : undefined,
      );
    } catch (emailError) {
      logger.error('Failed to send confirmation email', emailError);
      // Don't fail the request if email fails
    }

    // Clear the poster's own saved draft. A draft belongs to the account that
    // saved it (JobDraft.userId, app/api/job-draft/route.ts), never to the
    // contact email the form carries: that is whatever the poster typed, so
    // filtering on it let one employer delete another's draft (register 2.29).
    try {
      await prisma.jobDraft.deleteMany({
        where: { userId },
      });
    } catch (draftError) {
      // The post is live, so a failed cleanup is logged, not answered.
      logger.warn('Failed to clear the poster\'s saved draft', { userId, error: String(draftError) });
    }

    logger.info('Job posted without charge', {
      jobId: job.id,
      employer: sanitized.employer,
      mode: postingMode,
    });

    // C1 fix (2026-06-01): emit embedding refresh so this new posting
    // surfaces in AI search + candidate-recommendation streams. The
    // Inngest 30s throttle dedupes any race with a near-simultaneous
    // admin edit. Inngest no-ops silently if INNGEST_EVENT_KEY is unset.
    inngest.send({
      name: 'embedding.refresh.job',
      data: { jobId: job.id },
    }).catch((err) => {
      logger.warn('inngest.send embedding.refresh.job failed (post-free)', undefined, err);
    });

    // Ping search engines for indexing (production only, fire-and-forget)
    const isProduction = process.env.VERCEL_ENV === 'production' || (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_BASE_URL?.includes('localhost'));
    if (isProduction) {
      const jobUrl = `${brand.baseUrl}/jobs/${slug}`;
      // Google only when the page carries a JobPosting (lib/job-page-indexing.ts).
      pingSearchEnginesForJobPage(jobUrl, job).catch((err) =>
        logger.error('[Post-Free] Background indexing ping failed', err)
      );
    } else {
      logger.info('[Post-Free] Skipping indexing ping (non-production environment)');
    }

    // Return success response. `mode` lets the preview redirect to
    // /success?mode=promo | ?mode=pack (the legacy ?free=true still works);
    // a pack post also carries the credits it left.
    return NextResponse.json({
      success: true,
      jobId: job.id,
      editToken,
      dashboardToken,
      mode: postingMode,
      ...(packAfter && { pack: packCreditsJson(packAfter) }),
    });
  } catch (error) {
    logger.error('Posting error (no-charge path)', error);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}
