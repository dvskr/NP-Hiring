import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { sanitizeText, sanitizeEmail, sanitizeUrl } from '@/lib/sanitize';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import {
  suggestTargetCompanies,
  getLeadsByStatus,
  createEmployerLead,
  updateLeadStatus,
  renderTemplate,
  OUTREACH_TEMPLATE_NAMES,
  OutreachTemplateUnavailableError,
  type OutreachTemplateName,
} from '@/lib/outreach-service';

/** A template key the service knows, whether or not it is on offer right now. */
function isOutreachTemplateName(value: unknown): value is OutreachTemplateName {
  return typeof value === 'string' && (OUTREACH_TEMPLATE_NAMES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const authError = await requireApiAdmin(request);
  if (authError) return authError;
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const suggestions = searchParams.get('suggestions');

    // Return suggested target companies
    if (suggestions === 'true') {
      const companies = await suggestTargetCompanies();
      return NextResponse.json({ success: true, data: companies });
    }

    // Return leads by status
    if (status) {
      const leads = await getLeadsByStatus(status);
      return NextResponse.json({ success: true, data: leads });
    }

    // Return all leads (default)
    const allLeads = await prisma.employerLead.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ success: true, data: allLeads });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error fetching outreach data:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch outreach data',
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireApiAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing action parameter',
        },
        { status: 400 }
      );
    }

    // Create new employer lead
    if (action === 'create') {
      const { companyName, contactName, contactEmail, website, source, notes } = body;

      const sanitizedCompanyName = sanitizeText(companyName || '', 100);
      const sanitizedContactName = contactName ? sanitizeText(contactName, 100) : undefined;
      const sanitizedContactEmail = contactEmail ? sanitizeEmail(contactEmail) : undefined;
      const sanitizedWebsite = website ? sanitizeUrl(website) : undefined;
      const sanitizedSource = source ? sanitizeText(source, 50) : undefined;
      const sanitizedNotes = notes ? sanitizeText(notes, 5000) : undefined;

      if (!companyName) {
        return NextResponse.json(
          {
            success: false,
            error: 'Missing required field: companyName',
          },
          { status: 400 }
        );
      }

      const lead = await createEmployerLead({
        companyName: sanitizedCompanyName,
        contactName: sanitizedContactName,
        contactEmail: sanitizedContactEmail,
        website: sanitizedWebsite,
        source: sanitizedSource,
        notes: sanitizedNotes,
      });

      return NextResponse.json({ success: true, data: lead });
    }

    // Update lead status
    if (action === 'update') {
      const { id, status, notes } = body;
      const sanitizedNotes = notes ? sanitizeText(notes, 5000) : undefined;

      if (!id || !status) {
        return NextResponse.json(
          {
            success: false,
            error: 'Missing required fields: id and status',
          },
          { status: 400 }
        );
      }

      await updateLeadStatus(id, status, sanitizedNotes);

      return NextResponse.json({
        success: true,
        message: 'Lead status updated successfully',
      });
    }

    // Render email template
    if (action === 'render-template') {
      const { templateName, variables } = body;

      if (!templateName || !variables || !variables.companyName) {
        return NextResponse.json(
          {
            success: false,
            error: 'Missing required fields: templateName and variables.companyName',
          },
          { status: 400 }
        );
      }

      // Validate template name against the service's own key list, so the
      // route can never accept a key the service does not have.
      if (!isOutreachTemplateName(templateName)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid template name. Valid options: ${OUTREACH_TEMPLATE_NAMES.join(', ')}`,
          },
          { status: 400 }
        );
      }

      // A known key can still be off offer: freeOffer pitches free posting,
      // so the service refuses it once the launch promo has ended (an admin
      // page loaded before config.promoEndsAt can still ask for it). That is
      // the request conflicting with the current phase, not a server failure:
      // answer 409 with the service's reason, which the admin page shows, and
      // leave the error log for real failures.
      let rendered: { subject: string; body: string };
      try {
        rendered = renderTemplate(templateName, variables);
      } catch (error) {
        if (error instanceof OutreachTemplateUnavailableError) {
          return NextResponse.json({ success: false, error: error.message }, { status: 409 });
        }
        throw error;
      }

      return NextResponse.json({ success: true, data: rendered });
    }

    // Invalid action
    return NextResponse.json(
      {
        success: false,
        error: `Invalid action. Valid options: create, update, render-template`,
      },
      { status: 400 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error processing outreach request:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process outreach request',
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

