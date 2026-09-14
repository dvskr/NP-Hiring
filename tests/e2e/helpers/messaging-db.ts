/**
 * Journey-scoped database helpers for tests/e2e/journeys/messaging-alerts.spec.ts.
 *
 * The messaging + retention journey needs state no public API exposes
 * (EmailLead.unsubscribeToken, a featured employer posting the E2E employer
 * owns, a JobApplication row from the E2E seeker) and must remove everything
 * it creates. Kept separate from helpers/db.ts (a generic audit/identity
 * helper owned by another journey) so the two can evolve independently.
 *
 * Same Prisma + pg-adapter stack as lib/prisma.ts with a private two-slot
 * pool. DATABASE_URL comes from .env.test, the only file Playwright loads,
 * and must name a separate test database; the production guard refuses a
 * production DATABASE_URL before any connection opens.
 *
 * Guard rails:
 *   - `dbAvailable()` is false when DATABASE_URL is unset or the run targets
 *     the production domain (brand.domain) — callers `test.skip` on it.
 *   - Everything created here is tagged (`sourceProvider: 'e2e-probe'`,
 *     `example.invalid` addresses) and removed by the matching cleanup.
 */

import type { PrismaClient } from '@prisma/client';
import { brand } from '../../../config/brand';
import { assertNotProduction } from '../../support/production-db-guard';

type Pool = import('pg').Pool;

const AGAINST_PROD =
  !!process.env.PLAYWRIGHT_BASE_URL && process.env.PLAYWRIGHT_BASE_URL.includes(brand.domain);

let client: PrismaClient | null = null;
let pool: Pool | null = null;

export function dbAvailable(): boolean {
  return !!process.env.DATABASE_URL && !AGAINST_PROD;
}

export async function getDb(): Promise<PrismaClient> {
  if (client) return client;
  if (!dbAvailable()) {
    throw new Error('getDb(): DATABASE_URL missing or run targets production');
  }
  assertNotProduction({ context: 'e2e messaging db helper', mutating: true });
  const [{ PrismaClient: Client }, { PrismaPg }, { Pool: PgPool }] = await Promise.all([
    import('@prisma/client'),
    import('@prisma/adapter-pg'),
    import('pg'),
  ]);
  pool = new PgPool({ connectionString: process.env.DATABASE_URL, max: 2, allowExitOnIdle: true });
  client = new Client({ adapter: new PrismaPg(pool) });
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.$disconnect().catch(() => undefined);
    client = null;
  }
  if (pool) {
    await pool.end().catch(() => undefined);
    pool = null;
  }
}

/* ─── Profiles ─────────────────────────────────────────────────────────── */

export interface ProfileRef {
  id: string;
  supabaseId: string;
  email: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
}

export async function getProfileByEmail(email: string): Promise<ProfileRef | null> {
  const db = await getDb();
  return db.userProfile.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, supabaseId: true, email: true, role: true, firstName: true, lastName: true },
  });
}

/* ─── Messaging fixture: featured employer posting + application ───────── */

export interface MessagingFixture {
  jobId: string;
  jobSlug: string;
  jobTitle: string;
  employerJobId: string;
  applicationId: string;
  seeker: ProfileRef;
  employer: ProfileRef;
}

const MSG_PROBE_EXTERNAL_ID = 'e2e-messaging-featured-probe';

/**
 * Employer -> candidate InMail is gated on (a) the posting being featured
 * (ApplicantsTab only renders the Message button for `job.isFeatured`, and
 * POST /api/employer/messages rejects new outreach otherwise) and (b) the
 * candidate having applied. The setup-agent seed job is a free, non-featured
 * post, so this creates a dedicated featured posting owned by the E2E
 * employer plus a JobApplication from the E2E seeker. Idempotent: re-running
 * re-uses the probe row if a previous run failed to clean up.
 */
export async function seedMessagingFixture(seekerEmail: string, employerEmail: string): Promise<MessagingFixture> {
  const db = await getDb();
  const [seeker, employer] = await Promise.all([getProfileByEmail(seekerEmail), getProfileByEmail(employerEmail)]);
  if (!seeker || !employer) {
    throw new Error(`seedMessagingFixture: missing profile for ${!seeker ? seekerEmail : employerEmail}`);
  }

  // Start from a clean slate between the two E2E users so unread counts and
  // row ordering are deterministic.
  await deleteConversationsBetween(seeker.id, employer.id);

  let job = await db.job.findFirst({
    where: { externalId: MSG_PROBE_EXTERNAL_ID, sourceProvider: 'e2e-probe' },
    select: { id: true, slug: true, title: true },
  });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const title = 'Psychiatric Mental Health Nurse Practitioner - E2E Messaging Probe';

  if (!job) {
    const created = await db.job.create({
      data: {
        title,
        employer: 'E2E Behavioral Health Group',
        location: 'Remote',
        isRemote: true,
        mode: 'Remote',
        jobType: 'Full-Time',
        description:
          'E2E messaging probe posting. Created by tests/e2e/journeys/messaging-alerts.spec.ts and deleted by the same spec. ' +
          'Telehealth psychiatric mental health nurse practitioner role used only to exercise the InMail flow.',
        sourceType: 'employer',
        sourceProvider: 'e2e-probe',
        externalId: MSG_PROBE_EXTERNAL_ID,
        isFeatured: true,
        isPublished: true,
        applyOnPlatform: true,
        professionClass: 'np_eligible',
        professionConfidence: 1,
        expiresAt,
      },
      select: { id: true, slug: true, title: true },
    });
    job = await db.job.update({
      where: { id: created.id },
      data: { slug: `pmhnp-e2e-messaging-probe-${created.id}` },
      select: { id: true, slug: true, title: true },
    });
  } else {
    await db.job.update({
      where: { id: job.id },
      data: { isFeatured: true, isPublished: true, expiresAt },
    });
  }

  const employerJob = await db.employerJob.upsert({
    where: { jobId: job.id },
    update: { userId: employer.supabaseId, paymentStatus: 'paid', pricingTier: 'pro' },
    create: {
      jobId: job.id,
      employerName: 'E2E Behavioral Health Group',
      contactEmail: employer.email,
      editToken: `e2e-msg-edit-${job.id}`,
      paymentStatus: 'paid',
      pricingTier: 'pro',
      userId: employer.supabaseId,
    },
    select: { id: true },
  });

  const application = await db.jobApplication.upsert({
    where: { userId_jobId: { userId: seeker.supabaseId, jobId: job.id } },
    update: { status: 'applied', withdrawnAt: null },
    create: {
      userId: seeker.supabaseId,
      jobId: job.id,
      status: 'applied',
      consentGiven: true,
      consentGivenAt: new Date(),
      coverLetter: 'E2E probe application — safe to delete.',
    },
    select: { id: true },
  });

  return {
    jobId: job.id,
    jobSlug: job.slug ?? '',
    jobTitle: job.title,
    employerJobId: employerJob.id,
    applicationId: application.id,
    seeker,
    employer,
  };
}

export async function cleanupMessagingFixture(seekerEmail: string, employerEmail: string): Promise<void> {
  const db = await getDb();
  const [seeker, employer] = await Promise.all([getProfileByEmail(seekerEmail), getProfileByEmail(employerEmail)]);
  if (seeker && employer) {
    await deleteConversationsBetween(seeker.id, employer.id);
  }
  // Job deletion cascades EmployerJob + JobApplication; messages/conversations
  // referencing the job are SetNull, which is why conversations go first.
  await db.job.deleteMany({ where: { externalId: MSG_PROBE_EXTERNAL_ID, sourceProvider: 'e2e-probe' } });
}

export async function deleteConversationsBetween(profileA: string, profileB: string): Promise<void> {
  const db = await getDb();
  await db.employerMessage.deleteMany({
    where: {
      OR: [
        { senderId: profileA, recipientId: profileB },
        { senderId: profileB, recipientId: profileA },
      ],
    },
  });
  await db.conversation.deleteMany({
    where: {
      OR: [
        { participantA: profileA, participantB: profileB },
        { participantA: profileB, participantB: profileA },
      ],
    },
  });
}

export async function countMessagesBetween(profileA: string, profileB: string): Promise<number> {
  const db = await getDb();
  return db.employerMessage.count({
    where: {
      OR: [
        { senderId: profileA, recipientId: profileB },
        { senderId: profileB, recipientId: profileA },
      ],
    },
  });
}

/* ─── Job alerts + email leads ─────────────────────────────────────────── */

export interface EmailLeadState {
  unsubscribeToken: string;
  isSubscribed: boolean;
  isSuppressed: boolean;
  suppressionReason: string | null;
  newsletterOptIn: boolean;
  preferences: unknown;
}

const LEAD_SELECT = {
  unsubscribeToken: true,
  isSubscribed: true,
  isSuppressed: true,
  suppressionReason: true,
  newsletterOptIn: true,
  preferences: true,
} as const;

export async function getEmailLead(email: string): Promise<EmailLeadState | null> {
  const db = await getDb();
  return db.emailLead.findUnique({ where: { email: email.toLowerCase() }, select: LEAD_SELECT });
}

/** Create (or reset to a clean, subscribed, unsuppressed state) the lead. */
export async function ensureCleanEmailLead(email: string): Promise<EmailLeadState> {
  const db = await getDb();
  const normalized = email.toLowerCase();
  const lead = await db.emailLead.upsert({
    where: { email: normalized },
    update: {
      isSubscribed: true,
      isSuppressed: false,
      suppressedAt: null,
      suppressionReason: null,
      newsletterOptIn: false,
      preferences: {},
    },
    create: { email: normalized, source: 'e2e-probe', newsletterOptIn: false },
    select: LEAD_SELECT,
  });
  await db.userProfile.updateMany({
    where: { email: { equals: normalized, mode: 'insensitive' } },
    data: { emailSuppressed: false, emailSuppressedAt: null },
  });
  return lead;
}

/**
 * Put the lead into the state an explicit unsubscribe leaves behind
 * (app/api/email/unsubscribe GET): unsubscribed + suppressed with reason
 * 'unsubscribe', mirrored onto the registered profile.
 */
export async function suppressEmailLead(email: string): Promise<EmailLeadState> {
  const db = await getDb();
  const normalized = email.toLowerCase();
  const now = new Date();
  const lead = await db.emailLead.upsert({
    where: { email: normalized },
    update: { isSubscribed: false, isSuppressed: true, suppressedAt: now, suppressionReason: 'unsubscribe', newsletterOptIn: false },
    create: { email: normalized, source: 'e2e-probe', newsletterOptIn: false, isSubscribed: false, isSuppressed: true, suppressedAt: now, suppressionReason: 'unsubscribe' },
    select: LEAD_SELECT,
  });
  await db.userProfile.updateMany({
    where: { email: { equals: normalized, mode: 'insensitive' } },
    data: { emailSuppressed: true, emailSuppressedAt: now },
  });
  return lead;
}

export async function isProfileEmailSuppressed(email: string): Promise<boolean | null> {
  const db = await getDb();
  const profile = await db.userProfile.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { emailSuppressed: true },
  });
  return profile ? profile.emailSuppressed : null;
}

export interface JobAlertRow {
  id: string;
  token: string;
  keyword: string | null;
  location: string | null;
  mode: string | null;
  jobType: string | null;
  minSalary: number | null;
  newGradFriendly: boolean | null;
  minYearsExperience: number | null;
  frequency: string;
  isActive: boolean;
}

const ALERT_SELECT = {
  id: true,
  token: true,
  keyword: true,
  location: true,
  mode: true,
  jobType: true,
  minSalary: true,
  newGradFriendly: true,
  minYearsExperience: true,
  frequency: true,
  isActive: true,
} as const;

export async function listJobAlerts(email: string): Promise<JobAlertRow[]> {
  const db = await getDb();
  return db.jobAlert.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    select: ALERT_SELECT,
  });
}

export async function deleteJobAlerts(email: string): Promise<number> {
  const db = await getDb();
  const result = await db.jobAlert.deleteMany({ where: { email: { equals: email, mode: 'insensitive' } } });
  return result.count;
}

/** Insert an alert directly (for token-based pages that need a known cadence/state). */
export async function createJobAlert(
  email: string,
  data: { keyword?: string; frequency?: 'daily' | 'weekly'; isActive?: boolean; location?: string },
): Promise<JobAlertRow> {
  const db = await getDb();
  const normalized = email.toLowerCase();
  await db.emailLead.upsert({
    where: { email: normalized },
    update: {},
    create: { email: normalized, source: 'e2e-probe', newsletterOptIn: false },
  });
  return db.jobAlert.create({
    data: {
      email: normalized,
      keyword: data.keyword ?? null,
      location: data.location ?? null,
      frequency: data.frequency ?? 'daily',
      isActive: data.isActive ?? true,
      confirmedAt: new Date(),
    },
    select: ALERT_SELECT,
  });
}
