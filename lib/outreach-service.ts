/**
 * lib/outreach-service.ts — cold-outreach templates + EmployerLead helpers
 * for the admin outreach page (app/admin/outreach) and POST /api/outreach.
 *
 * Copy rules (2026-09-12 pricing change):
 *   - NEVER state audience numbers (subscribers, visitors, applicants). The
 *     old "over 1,000 NPs subscribed" line was unverifiable and is gone.
 *   - The launch offer IS true now — every post is free through
 *     config.promoEndsLabel — so it is stated with the same tokens the
 *     pricing page uses (duration, Featured, unlocks/InMails), never with
 *     literal numbers or dates.
 *   - The three template keys and renderTemplate's signature are pinned by
 *     the admin page and the API route; do not rename them.
 */
import { prisma } from '@/lib/prisma';
import { EmployerLead } from '@/lib/types';
import { brand } from '@/config/brand';
import { config } from '@/lib/config';

/** One-line statement of the launch offer, shared by all three templates. */
const LAUNCH_OFFER_LINE = `Right now every job post on ${brand.name} is free during our launch period through ${config.promoEndsLabel}: a ${config.durationDays}-day Featured listing with top placement, ${config.limits.candidateUnlocksPerPosting} candidate unlocks and ${config.limits.inmailsPerPosting} InMails. No credit card required.`;

const TEMPLATES = {
  initial: {
    subject: `Reach qualified ${brand.niche.short}s with {{companyName}}`,
    body: `Hi {{contactName}},

I noticed {{companyName}} is hiring ${brand.niche.descriptor}s. I'm reaching out because we run ${brand.name}, the specialized job board for ${brand.niche.descriptor}s.

${LAUNCH_OFFER_LINE}

Would you be interested in posting your open positions? I'm happy to set up your first listing.

Best,
[Your name]
${brand.name}

P.S. You can check out our site at ${brand.domain}`
  },

  followUp: {
    subject: `Following up: ${brand.niche.short} job posting`,
    body: `Hi {{contactName}},

Just following up on my previous email about posting your ${brand.niche.short} positions on our job board.

${LAUNCH_OFFER_LINE}

Happy to answer any questions or set up a quick call.

Best,
[Your name]`
  },

  freeOffer: {
    subject: `Free ${brand.niche.short} job posting for {{companyName}}`,
    body: `Hi {{contactName}},

I'd like to invite {{companyName}} to post on ${brand.name}, the specialized job board for ${brand.niche.descriptor}s.

${LAUNCH_OFFER_LINE}

Just reply to this email with your job details, or post directly at ${brand.domain}/post-job

Best,
[Your name]`
  }
};

export function renderTemplate(
  templateName: keyof typeof TEMPLATES,
  variables: { companyName: string; contactName?: string }
): { subject: string; body: string } {
  const template = TEMPLATES[templateName];

  // Replace variables in subject and body
  let subject = template.subject;
  let body = template.body;

  // Replace {{companyName}}
  subject = subject.replace(/\{\{companyName\}\}/g, variables.companyName);
  body = body.replace(/\{\{companyName\}\}/g, variables.companyName);

  // Replace {{contactName}} with name or fallback to "there"
  const contactName = variables.contactName || 'there';
  subject = subject.replace(/\{\{contactName\}\}/g, contactName);
  body = body.replace(/\{\{contactName\}\}/g, contactName);

  return { subject, body };
}

export async function createEmployerLead(data: {
  companyName: string;
  contactName?: string;
  contactEmail?: string;
  website?: string;
  source?: string;
  notes?: string;
}): Promise<EmployerLead> {
  const lead = await prisma.employerLead.create({
    data: {
      companyName: data.companyName,
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      website: data.website,
      source: data.source,
      notes: data.notes,
      status: 'prospect',
    },
  });

  return lead;
}

export async function updateLeadStatus(
  leadId: string,
  status: string,
  notes?: string
): Promise<void> {
  const updateData: { status: string; notes?: string; contactedAt?: Date } = {
    status,
  };

  // Set contactedAt if status is 'contacted'
  if (status === 'contacted') {
    updateData.contactedAt = new Date();
  }

  // Append to notes if provided
  if (notes) {
    const existingLead = await prisma.employerLead.findUnique({
      where: { id: leadId },
      select: { notes: true },
    });

    const existingNotes = existingLead?.notes || '';
    const timestamp = new Date().toISOString();
    updateData.notes = existingNotes
      ? `${existingNotes}\n\n[${timestamp}] ${notes}`
      : `[${timestamp}] ${notes}`;
  }

  await prisma.employerLead.update({
    where: { id: leadId },
    data: updateData,
  });
}

export async function getLeadsDueForFollowUp(): Promise<EmployerLead[]> {
  const leads = await prisma.employerLead.findMany({
    where: {
      nextFollowUpAt: {
        lte: new Date(),
      },
    },
    orderBy: {
      nextFollowUpAt: 'asc',
    },
  });

  return leads;
}

export async function getLeadsByStatus(status: string): Promise<EmployerLead[]> {
  const leads = await prisma.employerLead.findMany({
    where: { status },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return leads;
}

export async function suggestTargetCompanies(): Promise<string[]> {
  // Get companies from jobs table that posted via external sources
  // Group by employer and count
  const companies = await prisma.job.groupBy({
    by: ['employer'],
    where: {
      sourceType: 'external',
      isPublished: true,
    },
    _count: {
      employer: true,
    },
    having: {
      employer: {
        _count: {
          gte: 3, // 3+ job posts (actively hiring)
        },
      },
    },
    orderBy: {
      _count: {
        employer: 'desc',
      },
    },
    take: 50, // Get more initially to filter
  });

  // Get list of companies already in employer_leads
  const existingLeads = await prisma.employerLead.findMany({
    select: { companyName: true },
  });

  const existingCompanyNames = new Set(
    existingLeads.map((lead: { companyName: string }) => lead.companyName.toLowerCase())
  );

  // Filter out companies already in leads
  const suggestions = companies
    .filter((company: { employer: string; _count: { employer: number } }) => !existingCompanyNames.has(company.employer.toLowerCase()))
    .map((company: { employer: string; _count: { employer: number } }) => company.employer)
    .slice(0, 20); // Return top 20

  return suggestions;
}

