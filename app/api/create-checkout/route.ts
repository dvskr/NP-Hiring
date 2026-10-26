/**
 * POST /api/create-checkout — Stripe Checkout for a PAID job post.
 *
 * Pricing (from January 1, 2027 — config.ladderStartsLabel):
 *   intro — config.introPrice, the FIRST paid post per company domain
 *   pro   — config.postingPrice, every later post
 * The rung is resolved server-side by lib/pricing.ts#getNextPaidTier from
 * the SIGNUP email domain (EmployerJob.quotaDomain), never from the request
 * body, and is written to EmployerJob.pricingTier + Stripe metadata.pricing
 * so the webhook / verify / sweep activation and the ledger agree on what
 * was sold. The resume path re-prices from the persisted pricingTier.
 *
 * During the launch promo (config.isPromoActive) every post is free and
 * /api/jobs/post-free publishes it, so this route answers 409 PROMO_ACTIVE
 * for the new-post AND the resume path: a stale /post-job/checkout draft or
 * a dashboard "Complete payment" must never charge for a post that should
 * be free. The unit tests exercise the paid funnel by stubbing
 * config.isPromoActive; nothing a request carries can bypass the check.
 *
 * While the employer holds a usable 5-post pack credit, a new post answers
 * 409 PACK_CREDIT_AVAILABLE: the credit pays for it through
 * /api/jobs/post-free. A paid Stripe pack also uses up the domain's intro
 * price (getNextPaidTier).
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { createId } from '@paralleldrive/cuid2';
import { config, PricingTier } from '@/lib/config';
import { expiresFromNow } from '@/lib/expires-at';
import { domainOf, getNextPaidTier, asPaidTier, type PaidTier } from '@/lib/pricing';
import { getPackCreditStatus } from '@/lib/post-packs';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { gaCheckoutMetadata, idempotencyKeyWithGaIds } from '@/lib/analytics-server';
import {
  sanitizeJobPosting,
  sanitizeText,
  normalizeContentWhitespace,
} from '@/lib/sanitize';
import { readJsonObject } from '@/lib/request-body';
import { createClient } from '@/lib/supabase/server';
import { getBaseUrl, getEnv, isFeatureEnabled } from '@/lib/env';
import { normalizeSalary } from '@/lib/salary-normalizer';
import { formatDisplaySalary } from '@/lib/salary-display';
import { computeQualityScore } from '@/lib/utils/quality-score';
import { parseLocation } from '@/lib/location-parser';
import { summarizeForMeta } from '@/lib/description-cleaner';
import { normalizeExperienceFromInput } from '@/lib/experience-label';
import {
  validateBenefits,
  validateSetting,
  validatePopulation,
  sanitizeLogoUrl,
} from '@/app/api/jobs/post-free/_lib/job-attributes';

/*
 * The body is untrusted JSON, read as an object of unknown values
 * (lib/request-body.ts) and narrowed where each value is used, never
 * annotated with the shape it should have (register 2.29): a number or an
 * object where text belongs reads as missing. Fields: resumeJobId (B78,
 * resume an abandoned checkout; every other field is then ignored and the
 * persisted Job and EmployerJob are re-used), title, companyName,
 * companyWebsite, contactEmail, location, mode, jobType, salaryMin,
 * salaryMax, salaryPeriod, description, applyUrl, applyOnPlatform, benefits,
 * setting, population (the free post's validators), companyLogoUrl
 * (sanitizeUrl), the experience picker (minYearsExperience, newGradFriendly,
 * experienceQualifier; lib/experience-label.ts) and screeningQuestions. A
 * pricingTier in the body is ignored: the rung is priced server side.
 */

/** The value when it is text, else ''. */
function textField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The value when it is text, else undefined. */
function optionalTextField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A salary figure as sent, a number or numeric text, else undefined. */
function salaryField(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

export async function POST(request: NextRequest) {
  // Rate limiting (IP based) - strictly limit checkout creation to prevent spam
  const rateLimitResult = await rateLimit(request, 'checkout', RATE_LIMITS.postJob);
  if (rateLimitResult) return rateLimitResult;

  try {
    // F3: ENABLE_PAID_POSTING is the real master switch — checked BEFORE the
    // Stripe key so an intentionally-deferred launch (flag off) is
    // distinguishable from a misconfiguration (flag on, key missing). Both
    // codes are stable and machine-readable for the funnel UI.
    if (!isFeatureEnabled('paidPosting')) {
      logger.warn('Paid checkout attempted while ENABLE_PAID_POSTING is off');
      return NextResponse.json(
        { error: 'Paid job posting is not available yet', code: 'PAID_POSTING_DISABLED' },
        { status: 503 }
      );
    }

    const stripe = getStripe();
    if (!stripe) {
      logger.error('Paid checkout attempted but STRIPE_SECRET_KEY is not configured', null);
      return NextResponse.json(
        { error: 'Paid checkout is currently unavailable', code: 'STRIPE_NOT_CONFIGURED' },
        { status: 503 }
      );
    }

    // The key takes the money; the webhook records the sale. Without
    // STRIPE_WEBHOOK_SECRET POST /api/webhooks/stripe answers 503 to every
    // event, so a post paid for here would publish only through the success
    // page or the daily sweep, and its refunds and disputes would never reach
    // it. Same rule as lib/post-pack-sale.ts#packSaleClosedReason and
    // /api/create-checkout/availability
    // (tests/regressions/paid-posting-checkout-gate.test.ts).
    if (!getEnv().STRIPE_WEBHOOK_SECRET) {
      logger.error('Paid checkout attempted but STRIPE_WEBHOOK_SECRET is not configured', null);
      return NextResponse.json(
        { error: 'Paid checkout is currently unavailable', code: 'STRIPE_NOT_CONFIGURED' },
        { status: 503 }
      );
    }

    // Launch promo: nothing is sold per post, whatever the request asks for.
    // Checked before the body is read, so it covers the resume path too.
    if (config.isPromoActive()) {
      logger.warn('Paid checkout attempted during the launch promo; refused');
      return NextResponse.json(
        {
          error: `Every post is free through ${config.promoEndsLabel}. Go back to the preview to publish.`,
          code: 'PROMO_ACTIVE',
        },
        { status: 409 }
      );
    }

    const rawBody = await readJsonObject(request);
    if (!rawBody) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    // Auth — paid posts still must be tied to an authenticated employer.
    // The SIGNUP email domain (not the form's contactEmail) anchors the
    // per-domain intro price, mirroring /api/jobs/post-free (audit #26).
    let userId: string | null = null;
    let confirmedEmail: string | null = null;
    let signupDomain: string | null = null;
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
      const profile = await prisma.userProfile.findUnique({
        where: { supabaseId: user.id },
      });
      if (!profile) {
        return NextResponse.json({ error: 'User profile not found' }, { status: 403 });
      }
      if (profile.role !== 'employer') {
        return NextResponse.json(
          { error: 'Only employer accounts can post jobs.' },
          { status: 403 }
        );
      }
      userId = user.id;
      // The email proves ownership of an unclaimed row only once Supabase has
      // confirmed it, as in lib/employer-ownership.ts (register 2.26). The
      // confirmation certifies the sign-in email, never the profile's stored
      // copy, which can differ after a sign-in email change.
      confirmedEmail = user.email_confirmed_at && user.email?.trim() ? user.email : null;
      signupDomain = domainOf(user.email) ?? domainOf(profile.email);
    } catch (authErr) {
      logger.warn('Failed to fetch user session in create-checkout', { error: authErr });
      return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
    }

    // GA attribution for the purchase event the webhook sends later. It has
    // to be captured here: the webhook has no visitor request to read the GA
    // cookies from. Empty unless the visitor granted analytics consent, in
    // which case the session is created exactly as before.
    const gaMetadata = gaCheckoutMetadata(request);

    // ── B78: resume an abandoned checkout ─────────────────────────────
    // The employer dashboard's "Complete payment" action posts
    // { resumeJobId } for a row stuck 'pending' (or swept to 'expired').
    if (typeof rawBody.resumeJobId === 'string' && rawBody.resumeJobId.trim()) {
      return resumeAbandonedCheckout(stripe, rawBody.resumeJobId.trim(), userId, confirmedEmail, gaMetadata);
    }

    // A usable 5-post pack credit already pays for a new post (published
    // through /api/jobs/post-free), so nothing is sold here while one is
    // left. The resume path above completes an older checkout and stays open.
    if ((await getPackCreditStatus(userId, new Date())).usable) {
      return NextResponse.json(
        { error: `You have a post left in your ${config.packPosts}-post pack. Go back to the preview to publish this job with it.`, code: 'PACK_CREDIT_AVAILABLE' },
        { status: 409 }
      );
    }

    // Sanitize core fields
    const sanitized = sanitizeJobPosting({
      title: textField(rawBody.title),
      employer: textField(rawBody.companyName),
      location: textField(rawBody.location),
      description: normalizeContentWhitespace(textField(rawBody.description)),
      applyLink: optionalTextField(rawBody.applyUrl) || null,
      contactEmail: textField(rawBody.contactEmail),
      mode: optionalTextField(rawBody.mode),
      jobType: optionalTextField(rawBody.jobType),
      companyWebsite: optionalTextField(rawBody.companyWebsite),
      minSalary: salaryField(rawBody.salaryMin),
      maxSalary: salaryField(rawBody.salaryMax),
      salaryPeriod: optionalTextField(rawBody.salaryPeriod),
    });

    const applyOnPlatform = !!rawBody.applyOnPlatform;

    // Validate required fields
    const missing: string[] = [];
    if (!sanitized.title.trim()) missing.push('title');
    if (!sanitized.employer.trim()) missing.push('company name');
    if (!sanitized.location.trim()) missing.push('location');
    if (!sanitized.mode) missing.push('work mode');
    if (!sanitized.jobType) missing.push('job type');
    if (!sanitized.description.trim()) missing.push('description');
    if (!sanitized.contactEmail) missing.push('contact email');
    if (!applyOnPlatform && !sanitized.applyLink) missing.push('apply URL');

    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(', ')}` },
        { status: 400 }
      );
    }

    // The free post's validators and 400s (register 2.29): benefits must be
    // a short list of text, setting and population listed wizard values.
    const benefitsResult = validateBenefits(rawBody.benefits);
    if (!benefitsResult.ok) {
      return NextResponse.json({ error: benefitsResult.error }, { status: 400 });
    }
    const settingResult = validateSetting(rawBody.setting);
    if (!settingResult.ok) {
      return NextResponse.json({ error: settingResult.error }, { status: 400 });
    }
    const populationResult = validatePopulation(rawBody.population);
    if (!populationResult.ok) {
      return NextResponse.json({ error: populationResult.error }, { status: 400 });
    }

    // Ladder rung: 'intro' until this company domain has one paid post,
    // 'pro' afterwards. Anchored on the signup domain; the contactEmail
    // domain is only a fallback for a session with no email at all.
    const quotaDomain = signupDomain ?? domainOf(sanitized.contactEmail);
    if (!quotaDomain) {
      return NextResponse.json({ error: 'Invalid contact email' }, { status: 400 });
    }
    const pricing: PaidTier = await getNextPaidTier(quotaDomain);
    const price = config.priceCentsForTier(pricing);
    const tierLabel = config.getTierLabel(pricing);

    // Salary parsing + normalization
    const parsedMinSalary = (() => {
      const val = Number(sanitized.minSalary);
      return Number.isFinite(val) && !Number.isNaN(val) ? val : null;
    })();
    const parsedMaxSalary = (() => {
      const val = Number(sanitized.maxSalary);
      return Number.isFinite(val) && !Number.isNaN(val) ? val : null;
    })();
    const parsedSalaryPeriod = sanitized.salaryPeriod || (parsedMinSalary || parsedMaxSalary ? 'year' : null);

    const normalizedSalary = normalizeSalary({
      minSalary: parsedMinSalary,
      maxSalary: parsedMaxSalary,
      salaryPeriod: parsedSalaryPeriod,
      title: sanitized.title,
    });

    const displaySalary = formatDisplaySalary(
      normalizedSalary.normalizedMinSalary,
      normalizedSalary.normalizedMaxSalary,
      parsedSalaryPeriod
    );

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

    const parsedLoc = parseLocation(sanitized.location);

    // Calculate expiry — every post runs config.durationDays. UTC math via
    // expiresFromNow; setDate() drifted across DST boundaries.
    const expiresAt = expiresFromNow(config.durationDays);

    // Generate unique tokens
    const editToken = crypto.randomBytes(32).toString('hex');
    const dashboardToken = createId();

    // Wrap Job + slug update + EmployerJob in one transaction so a partial
    // failure can't leave an orphan job row that the employer can never recover.
    const { job, employerJob } = await prisma.$transaction(async (tx) => {
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
          applyOnPlatform,
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
          isRemote: parsedLoc.isRemote,
          isHybrid: parsedLoc.isHybrid,
          // isFeatured stays false on every employer post. Top placement
          // and the Featured badge come from the EmployerJob relation —
          // see lib/utils/job-sort.ts.
          isFeatured: false,
          isPublished: false, // Will be flipped by webhook on successful payment
          sourceType: 'employer',
          expiresAt,
          // Stamped again when the row first publishes (activate-paid-job.ts);
          // never left NULL (indexing audit fixSoon 5).
          contentChangedAt: new Date(),
          qualityScore,
          benefits: benefitsResult.value,
          setting: settingResult.value,
          population: populationResult.value,
          ...(() => {
            const sanitizedQualifier =
              typeof rawBody.experienceQualifier === 'string'
                ? sanitizeText(rawBody.experienceQualifier, 80) || null
                : null;
            return normalizeExperienceFromInput({
              minYearsExperience: rawBody.minYearsExperience,
              newGradFriendly: rawBody.newGradFriendly,
              experienceQualifier: sanitizedQualifier,
            });
          })(),
        },
      });

      const computedSlug = `${sanitized.title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim()}-${created.id}`;

      const updatedJob = await tx.job.update({
        where: { id: created.id },
        data: { slug: computedSlug },
      });

      const ej = await tx.employerJob.create({
        data: {
          employerName: sanitized.employer,
          contactEmail: sanitized.contactEmail,
          companyWebsite: sanitized.companyWebsite || null,
          companyLogoUrl: sanitizeLogoUrl(rawBody.companyLogoUrl),
          jobId: created.id,
          editToken,
          dashboardToken,
          paymentStatus: 'pending',
          pricingTier: pricing,
          userId,
          // Immutable per-domain anchor. Once the webhook flips this row to
          // 'paid', lib/pricing.ts#getNextPaidTier sees a paid post at this
          // domain and every later post prices at 'pro'.
          quotaDomain,
        },
      });

      return { job: updatedJob, employerJob: ej };
    });

    // Persist screening questions (only for platform-apply jobs)
    if (applyOnPlatform && Array.isArray(rawBody.screeningQuestions)) {
      const questions = rawBody.screeningQuestions.slice(0, 5);
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!q?.text || typeof q.text !== 'string') continue;

        const validTypes = ['boolean', 'text', 'select', 'number'];
        const qType = validTypes.includes(q.type) ? q.type : 'boolean';

        await prisma.jobScreeningQuestion.create({
          data: {
            jobId: job.id,
            questionText: sanitizeText(q.text, 200),
            questionType: qType,
            options: Array.isArray(q.options)
              ? q.options.map((o: string) => sanitizeText(String(o), 100)).slice(0, 10)
              : [],
            isRequired: !!q.required,
            isKnockout: !!q.knockout,
            knockoutAnswer: q.knockoutAnswer ? sanitizeText(String(q.knockoutAnswer), 100) : null,
            sortOrder: i,
          },
        });
      }
    }

    logger.info('Job created for paid checkout', { jobId: job.id, userId });

    // Payment methods are NOT pinned here: the account's Dashboard payment
    // method settings apply (Link, wallets, bank debit…). Delayed methods are
    // safe because every fulfilment path gates on payment_status === 'paid'
    // and the webhook handles checkout.session.async_payment_succeeded/failed.
    const baseUrl = getBaseUrl();
    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${tierLabel} job post — ${sanitized.title}`,
              description: `${sanitized.employer} - ${sanitized.location} · ${config.durationDays}-day Featured listing`,
            },
            unit_amount: price,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: sanitized.contactEmail,
      // B2B polish — collect billing address + optional tax ID, generate
      // downloadable PDF invoice (one-time Checkout payments don't create
      // Invoice objects by default; this opts in).
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      // Force Stripe to send a receipt email regardless of the dashboard
      // "Successful payments" toggle. The toggle is gated behind live-account
      // activation, but `receipt_email` on the underlying PaymentIntent
      // bypasses it — works in sandbox immediately and stays correct in live.
      payment_intent_data: {
        receipt_email: sanitized.contactEmail,
      },
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `${tierLabel} job post: ${sanitized.title} — ${sanitized.employer} (${sanitized.location})`,
          metadata: {
            jobId: job.id,
            employerJobId: employerJob.id,
            pricing,
          },
          rendering_options: { amount_tax_display: 'exclude_tax' },
        },
      },
      success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/post-job`,
      // No bearer credentials in Stripe metadata — every reader loads the
      // dashboardToken from EmployerJob by jobId. The GA ids are analytics
      // identifiers, not credentials.
      metadata: {
        jobId: job.id,
        pricing,
        ...gaMetadata,
      },
    }, {
      // The EmployerJob row is new per request, so this only collapses a
      // retried create for THIS row into one session. A retry of this create
      // replays the same parameters, GA ids included, so unlike the resume
      // and renewal keys this one never needs the ids folded in.
      idempotencyKey: `new-post-${employerJob.id}`,
    });

    await recordCheckoutSession(employerJob.id, session.id);

    if (!session.url) {
      logger.error('Stripe returned a checkout session without a URL', null, { sessionId: session.id });
      return NextResponse.json(
        { error: 'Checkout session created but URL is missing' },
        { status: 502 }
      );
    }

    // Bind this Stripe session to the originating browser via a httpOnly
    // cookie. /api/verify-checkout-session re-reads the cookie and only
    // returns the employer dashboardToken when the cookie matches the
    // session_id from the success-page query string. Without this binding
    // anyone who learned a session_id (browser history, referer logs)
    // could call verify and harvest the dashboard token.
    const response = NextResponse.json({
      sessionId: session.id,
      url: session.url,
      tier: pricing,
      price: config.priceDollarsForTier(pricing),
    });
    response.cookies.set('checkout_session_bind', session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60, // 1 hour — covers the longest realistic checkout flow
    });
    return response;
  } catch (error) {
    logger.error('Error creating checkout session', error);
    // In dev, surface the underlying cause so we don't have to grep server logs.
    const isDev = process.env.NODE_ENV !== 'production';
    return NextResponse.json(
      {
        error: 'Failed to create checkout session',
        ...(isDev && { cause: error instanceof Error ? error.message : String(error) }),
      },
      { status: 500 }
    );
  }
}

/** Remember the latest session for a posting (resume expires it). Best-effort. */
async function recordCheckoutSession(employerJobId: string, sessionId: string): Promise<void> {
  try {
    await prisma.employerJob.update({ where: { id: employerJobId }, data: { stripeCheckoutSessionId: sessionId } });
  } catch (err) {
    logger.error('Failed to record Stripe checkout session on EmployerJob', err, { employerJobId, sessionId });
  }
}

type PreviousSessionState = 'paid' | 'processing' | 'awaiting_verification' | 'retired';

/**
 * Before minting a replacement session, make sure the previous one can no
 * longer be paid: a posting must never have two payable sessions. The money
 * decides, not the session status: a delayed payment (ACH and similar)
 * completes the session while it is still 'unpaid', and a failed one leaves
 * it 'complete' and 'unpaid' for good.
 *   - payment_status 'paid' / 'no_payment_required' → the employer has paid
 *     and the activation is in flight; refuse instead of selling it twice;
 *   - complete, unpaid, PaymentIntent 'processing' → a delayed payment is
 *     still settling; refuse so the employer does not pay a second time;
 *   - complete, unpaid, PaymentIntent 'requires_action' → the employer has
 *     yet to verify ACH microdeposits (Stripe keeps this open for up to 10
 *     days); the payment can still succeed, so refuse the same way;
 *   - complete and unpaid otherwise (the delayed payment failed: the intent
 *     is back to 'requires_payment_method', or 'canceled') → nothing can be
 *     paid on it any more; a new session is safe;
 *   - open → expire it (errors such as "already expired" are ignored; the
 *     goal state is "not payable").
 */
async function retirePreviousSession(stripe: Stripe, previousSessionId: string | null): Promise<PreviousSessionState> {
  if (!previousSessionId) return 'retired';
  try {
    const previous = await stripe.checkout.sessions.retrieve(previousSessionId, { expand: ['payment_intent'] });
    if (previous.payment_status === 'paid' || previous.payment_status === 'no_payment_required') return 'paid';
    if (previous.status === 'complete') {
      const intent = previous.payment_intent;
      const intentStatus = intent && typeof intent === 'object' ? intent.status : null;
      if (intentStatus === 'processing') return 'processing';
      if (intentStatus === 'requires_action') return 'awaiting_verification';
      return 'retired';
    }
    if (previous.status === 'open') {
      await stripe.checkout.sessions.expire(previousSessionId);
    }
  } catch (err) {
    logger.info('Previous checkout session could not be retrieved/expired — continuing', {
      previousSessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return 'retired';
}

/**
 * B78 — mint a fresh Stripe Checkout session for an existing unpaid job.
 *
 * Checkout abandonment leaves the Job + EmployerJob rows persisted with
 * paymentStatus='pending' (or 'expired' after the reconciliation sweep).
 * Stripe sessions hard-expire after 24h, so the original session URL is
 * useless — this creates a new session carrying the SAME metadata shape as
 * the original (jobId / pricing), so the existing webhook,
 * verify-checkout-session, and reconciliation activation paths all work
 * unchanged.
 */
async function resumeAbandonedCheckout(
  stripe: Stripe,
  jobId: string,
  userId: string | null,
  userEmail: string | null,
  gaMetadata: Record<string, string>,
): Promise<NextResponse> {
  const employerJob = await prisma.employerJob.findFirst({
    where: { jobId },
    include: {
      job: {
        select: { id: true, title: true, employer: true, location: true, archivedAt: true },
      },
    },
  });

  if (!employerJob || !employerJob.job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Ownership mirrors the employer dashboard query
  // (lib/employer-ownership.ts#employerJobOwnershipBranches): linked userId
  // first, contactEmail as the legacy fallback for unclaimed rows only.
  // SECURITY (CHK-1): the email fallback used to match rows another account
  // had claimed, so an employer signed in with a claimed posting's contact
  // email could mint a checkout for it, restart its listing window and
  // revive it from 'expired' (tests/api/create-checkout-tier.test.ts).
  const ownsByUser = !!userId && employerJob.userId === userId;
  const ownsByEmail =
    employerJob.userId === null &&
    !!userEmail &&
    employerJob.contactEmail.toLowerCase() === userEmail.toLowerCase();
  if (!ownsByUser && !ownsByEmail) {
    return NextResponse.json({ error: 'You do not have access to this job' }, { status: 403 });
  }

  if (employerJob.paymentStatus !== 'pending' && employerJob.paymentStatus !== 'expired') {
    return NextResponse.json(
      { error: 'This job does not have an outstanding payment', code: 'NOT_RESUMABLE' },
      { status: 409 }
    );
  }
  if (employerJob.job.archivedAt) {
    return NextResponse.json(
      { error: 'Restore this job from the archive before completing payment' },
      { status: 409 }
    );
  }

  // One payable session per posting: retire the previous one first.
  const previousSession = await retirePreviousSession(stripe, employerJob.stripeCheckoutSessionId);
  if (previousSession === 'paid') {
    return NextResponse.json(
      { error: 'Payment for this job was already received and is being processed. Refresh your dashboard in a minute.', code: 'PAYMENT_PROCESSING' },
      { status: 409 }
    );
  }
  if (previousSession === 'processing') {
    return NextResponse.json(
      { error: 'Your payment for this job is still processing. The job goes live automatically once it clears, so there is nothing more to pay now.', code: 'PAYMENT_PROCESSING' },
      { status: 409 }
    );
  }
  if (previousSession === 'awaiting_verification') {
    return NextResponse.json(
      { error: 'Your bank payment for this job is waiting for you to verify your bank account. Once you complete the verification Stripe asked for and the payment clears, the job goes live automatically, so there is nothing more to pay now.', code: 'PAYMENT_PROCESSING' },
      { status: 409 }
    );
  }

  // Revive rows the reconciliation sweep marked 'expired' — the shared
  // activation path only claims pending→paid, so the row must be 'pending'
  // again before the new session can complete. Guarded update so a
  // concurrently-arriving activation can never be overwritten.
  if (employerJob.paymentStatus === 'expired') {
    await prisma.employerJob.updateMany({
      where: { id: employerJob.id, paymentStatus: 'expired' },
      data: { paymentStatus: 'pending' },
    });
  }

  // Restart the listing window — the paid duration should run from the
  // payment the employer is about to make, not from the abandoned attempt
  // days earlier.
  const expiresAt = expiresFromNow(config.durationDays);
  await prisma.job.update({ where: { id: jobId }, data: { expiresAt } });

  // Re-price from the rung persisted at creation: the row was quoted
  // 'intro' or 'pro' then and the employer is completing THAT checkout.
  // 'plan' and 'pack' can never be pending (those posts publish without
  // Checkout), so asPaidTier's 'pro' fallback only ever catches
  // legacy/unknown values.
  const pricing: PaidTier = asPaidTier(employerJob.pricingTier as PricingTier);
  const tierLabel = config.getTierLabel(pricing);
  const baseUrl = getBaseUrl();
  const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${tierLabel} job post — ${employerJob.job.title}`,
            description: `${employerJob.job.employer} - ${employerJob.job.location} · ${config.durationDays}-day Featured listing`,
          },
          unit_amount: config.priceCentsForTier(pricing),
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    customer_email: employerJob.contactEmail,
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    payment_intent_data: {
      receipt_email: employerJob.contactEmail,
    },
    invoice_creation: {
      enabled: true,
      invoice_data: {
        description: `${tierLabel} job post: ${employerJob.job.title} — ${employerJob.job.employer} (${employerJob.job.location})`,
        metadata: {
          jobId: employerJob.job.id,
          employerJobId: employerJob.id,
          pricing,
        },
        rendering_options: { amount_tax_display: 'exclude_tax' },
      },
    },
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/employer/dashboard`,
    metadata: {
      jobId: employerJob.job.id,
      pricing,
      ...gaMetadata,
    },
  }, {
    // Keyed on the session being replaced: a double-click that read the same
    // previous session gets the same new session back, while a later resume
    // (whose previous session is this one) mints a fresh one. The GA ids are
    // folded in because, when recordCheckoutSession failed, a later resume
    // replays this key with whatever GA ids the browser holds by then, and
    // Stripe refuses a reused key whose metadata changed, leaving the
    // employer unable to pay; see idempotencyKeyWithGaIds. The trade in that
    // rare case is a second open session, and a second payment on it is
    // caught by the webhook as duplicate_payment (activate-paid-job.ts).
    // Without GA ids the key is unchanged.
    idempotencyKey: idempotencyKeyWithGaIds(
      `resume-${employerJob.id}-${pricing}-${employerJob.stripeCheckoutSessionId ?? 'none'}`,
      gaMetadata,
    ),
  });

  await recordCheckoutSession(employerJob.id, session.id);

  if (!session.url) {
    logger.error('Stripe returned a resume-checkout session without a URL', null, { sessionId: session.id });
    return NextResponse.json(
      { error: 'Checkout session created but URL is missing' },
      { status: 502 }
    );
  }

  logger.info('Resume-payment checkout session created for abandoned job', {
    jobId,
    employerJobId: employerJob.id,
    sessionId: session.id,
  });

  // Same browser-binding cookie as the fresh-post path —
  // /api/verify-checkout-session only releases the dashboardToken when the
  // cookie matches the session_id.
  const response = NextResponse.json({
    sessionId: session.id,
    url: session.url,
    tier: pricing,
    price: config.priceDollarsForTier(pricing),
  });
  response.cookies.set('checkout_session_bind', session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  });
  return response;
}
