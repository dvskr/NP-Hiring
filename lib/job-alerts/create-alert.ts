import { prisma } from '@/lib/prisma';
import { syncToBeehiiv } from '@/lib/beehiiv';
import { logger } from '@/lib/logger';
import { insensitiveIn } from '@/lib/insensitive-in';

/**
 * Creating (or reactivating) a job alert, after the caller has validated
 * the criteria.
 *
 * Shared by POST /api/job-alerts (the signup forms, where the email is typed)
 * and the AI app connector (where it is the signed-in account's own
 * address), so the dedupe, reactivation and welcome-email rules are one.
 */

export interface JobAlertCriteria {
  email: string;
  name?: string | null;
  keyword?: string | null;
  location?: string | null;
  mode?: string | null;
  jobType?: string | null;
  minSalary?: number | null;
  maxSalary?: number | null;
  /** /jobs "Open to new grads". Only true is a filter. */
  newGradFriendly?: boolean | null;
  /** /jobs "I have N+ years": a whole number of years, 0 included. */
  minYearsExperience?: number | null;
  frequency: string;
  /** Explicit newsletter consent. Creating an alert never implies it. */
  newsletterOptIn: boolean;
  /**
   * True only when the caller has shown it controls `email`: a signed-in
   * session on that address (lib/job-alerts/alert-access.ts), or the
   * signed-in account of the AI app connector. Without it the caller may add
   * an alert, but may not change one that already exists or switch email
   * back on for an address that turned it off.
   */
  callerOwnsEmail?: boolean;
}

export interface CreatedJobAlert {
  alert: { id: string; token: string; frequency: string };
  /** True when no alert with these criteria existed before. */
  created: boolean;
  /** True when an identical paused alert was switched back on. */
  reactivated: boolean;
  /**
   * True when the address had unsubscribed and the caller is not its owner:
   * the alert is stored but sends nothing until the owner switches email
   * back on.
   */
  awaitingConsent: boolean;
}

/**
 * Suppression an owner's signup may lift. Only a user-initiated unsubscribe
 * qualifies (mirrors the resubscribe path in app/api/email/unsubscribe);
 * 'bounce' and 'complaint' stay suppressed.
 */
function isUnsubscribeSuppression(
  lead: { isSuppressed: boolean; suppressionReason: string | null } | null,
): boolean {
  return !!lead && lead.isSuppressed && lead.suppressionReason === 'unsubscribe';
}

/**
 * Advisory-lock key that serializes alert creation per address, so the
 * dedupe below cannot race. A namespaced string keeps it from colliding with
 * any other advisory lock taken on the same database.
 */
function jobAlertLockKey(normalizedEmail: string): string {
  return `job_alert:create:${normalizedEmail}`;
}

/** isEmailSuppressed, failing closed: an address whose state cannot be read is treated as suppressed. */
async function isSuppressedOrUnknown(normalizedEmail: string): Promise<boolean> {
  try {
    // Loaded here, not at the top: the mail module constructs its client on
    // import, and the AI connector imports this file. A missing mail key must
    // cost the welcome email, not every connector tool.
    const { isEmailSuppressed } = await import('@/lib/email-service');
    return await isEmailSuppressed(normalizedEmail);
  } catch (error) {
    logger.error('Job alert signup: could not read suppression, welcome email skipped', error);
    return true;
  }
}

export async function createJobAlert(criteria: JobAlertCriteria): Promise<CreatedJobAlert> {
  const { name, frequency } = criteria;
  const normalizedEmail = criteria.email.toLowerCase();
  const callerOwnsEmail = criteria.callerOwnsEmail === true;

  // One normal form for the dedupe lookup AND the stored row: an empty
  // string or a 0 means "no filter" and is stored as null. Normalizing only
  // the lookup meant a 0 minimum, or a keyword the sanitizer emptied, was
  // stored as it came and never matched again, so every resubmission
  // created another alert and another welcome email (fixed the same way on
  // the sister boards, 96561da2).
  // Zero years is a real choice ("none yet"), so not `|| null` for it.
  // `false` for new grads is "no preference" too: the digest treats false
  // and null alike.
  const years = criteria.minYearsExperience;
  const match = {
    keyword: criteria.keyword || null,
    location: criteria.location || null,
    mode: criteria.mode || null,
    jobType: criteria.jobType || null,
    minSalary: criteria.minSalary || null,
    maxSalary: criteria.maxSalary || null,
    newGradFriendly: criteria.newGradFriendly === true ? true : null,
    minYearsExperience: typeof years === 'number' && Number.isInteger(years) && years >= 0 ? years : null,
  };

  // Newsletter consent is opt-in ONLY. A job alert signup is consent to job
  // alerts, not to the newsletter: the /job-alerts form has no newsletter
  // checkbox, so an absent flag must never be read as "yes". Only an
  // explicit true (the exit-intent popup's checkbox) opts in, and a stored
  // false is never flipped by a submit that did not say true.
  const newsletterOptIn = criteria.newsletterOptIn === true;
  const lead = await prisma.emailLead.upsert({
    where: { email: normalizedEmail },
    update: newsletterOptIn ? { newsletterOptIn: true } : {},
    create: {
      email: normalizedEmail,
      source: 'job_alert',
      newsletterOptIn,
    },
    select: { isSuppressed: true, suppressionReason: true },
  });

  // The owner asking for an alert is a fresh request for email, so it
  // replaces an earlier unsubscribe: every digest send gates on
  // isEmailSuppressed() (lead OR profile), so without the lift the alert
  // would be created but never send. A form anyone can type an address into
  // is not the owner asking, so there the opt-out stands and the alert
  // waits, silent, until the owner switches email back on. Bounce and
  // complaint suppression protects deliverability and is never lifted here.
  const unsubscribed = isUnsubscribeSuppression(lead);
  if (unsubscribed && callerOwnsEmail) {
    await prisma.$transaction([
      prisma.emailLead.update({
        where: { email: normalizedEmail },
        data: {
          isSubscribed: true,
          isSuppressed: false,
          suppressedAt: null,
          suppressionReason: null,
        },
      }),
      // A deleted account stays suppressed (its deletion set the flag), as
      // in app/api/email/_lib/subscription.ts. insensitiveIn, not an
      // insensitive equals: that compiles to ILIKE, where "_" in an address
      // matches any character.
      prisma.userProfile.updateMany({
        where: { email: insensitiveIn([normalizedEmail]), deletedAt: null },
        data: { emailSuppressed: false, emailSuppressedAt: null },
      }),
    ]);
  }
  const awaitingConsent = unsubscribed && !callerOwnsEmail;

  // Sync to the Beehiiv newsletter only with explicit consent (fire-and-forget)
  if (newsletterOptIn) {
    syncToBeehiiv(normalizedEmail, { utmSource: 'job_alert' });
  }

  // Dedup: match BOTH confirmed (is_active = true) and unconfirmed alerts.
  //
  // The find-then-create runs inside one transaction that first takes a
  // Postgres advisory lock keyed on the email. Without it, two concurrent
  // submits (a double click) both miss in findFirst and both create,
  // storing duplicate alerts. The nullable criteria columns cannot be
  // covered by a plain unique index (NULLs are distinct), so the lock is
  // what makes the dedupe atomic: the second request waits, then finds the
  // first request's row and lands as an update.
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${jobAlertLockKey(normalizedEmail)}))`;

    const existing = await tx.jobAlert.findFirst({
      where: { email: normalizedEmail, ...match },
    });

    // An alert that already exists belongs to whoever controls the address.
    // Changing it (reactivating a pause, resetting its frequency) on a
    // request nobody has shown they own let anyone who knew an email switch
    // that person's alerts back on. It is left exactly as it was; the owner
    // already has its emails, with their links.
    if (existing && !callerOwnsEmail) {
      return { jobAlert: existing, existing, changed: false };
    }

    // Single opt-in: alerts are created already confirmed. The
    // /api/job-alerts/confirm endpoint stays in place for grandfathering any
    // in-flight pending alerts from the old double opt-in flow.
    const now = new Date();

    if (existing) {
      const updated = await tx.jobAlert.update({
        where: { id: existing.id },
        data: {
          frequency,
          name: name || existing.name,
          isActive: true,
          confirmedAt: existing.confirmedAt ?? now,
        },
      });
      return { jobAlert: updated, existing, changed: true };
    }

    const created = await tx.jobAlert.create({
      data: {
        email: normalizedEmail,
        name: name || null,
        ...match,
        frequency,
        isActive: true,
        confirmedAt: now,
        // SECURITY: this token is the only key to the address's alerts (GET
        // /api/job-alerts?token= lists them all, each with its token; PATCH
        // and DELETE take those). It was left to the Prisma cuid() default,
        // which is partly a timestamp and a counter; the other alert creators
        // write a random UUID. Nothing parses the format: every reader looks
        // it up as an opaque string. tests/api/job-alerts-token-hygiene.test.ts
        token: crypto.randomUUID(),
      },
    });
    return { jobAlert: created, existing: null, changed: true };
  });

  const { jobAlert, existing } = outcome;

  // Send the welcome / "alerts are active" email immediately, only for a
  // newly confirmed alert, never to a suppressed address (asked after the
  // unsubscribe lift above, so only a bounce, a complaint or a suppressed
  // profile skips it), and never on a stranger's say-so to an address that
  // turned our email off. The address alone: the email looks up the
  // address's EmailLead unsubscribe token itself, the only token its opt-out
  // links resolve. The alert is stored by now, so a failed check or a failed
  // send skips the email instead of failing the request.
  // tests/api/job-alerts-welcome-suppressed.test.ts
  const isNewlyConfirmed = outcome.changed && (!existing || !existing.confirmedAt);
  if (isNewlyConfirmed && !awaitingConsent && !(await isSuppressedOrUnknown(normalizedEmail))) {
    try {
      const { sendWelcomeEmail } = await import('@/lib/email-service');
      await sendWelcomeEmail(normalizedEmail);
    } catch (emailError) {
      logger.error('Job alert created but welcome email failed', emailError, { alertId: jobAlert.id });
    }
  }

  return {
    alert: { id: jobAlert.id, token: jobAlert.token, frequency: jobAlert.frequency },
    created: !existing,
    reactivated: outcome.changed && !!existing && !existing.isActive,
    awaitingConsent,
  };
}
