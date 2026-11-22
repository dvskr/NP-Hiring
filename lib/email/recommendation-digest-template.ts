/**
 * The weekly recommendation digest (email type 'recommendation_digest').
 *
 * It used to be hand-rolled HTML inside the Inngest function: no brand header,
 * no legal entity or postal address in the footer (every other marketing mail
 * carries both, and CAN-SPAM requires the address), no viewport meta, no lang,
 * no preheader, and a fixed 600px table that phones scaled down instead of
 * reflowing. It is built on the shared V2 shell now, so it gets all of that
 * from one place, and on the shared job card the job alerts use.
 *
 * Pure: no database, no send. lib/inngest/functions/recommendation-digest.ts
 * renders with it.
 */

import {
  emailShellV2,
  headerBlockV2,
  spacerV2,
  closeContentV2,
  bodyTextV2,
  unsubscribeFooterV2,
  SANS,
} from '@/lib/email-templates-v2';
import { renderJobCardHtml, escapeHtml } from '@/lib/utils/render-job-card';

/** The fields the digest shows, as the Inngest function shapes them. */
export interface RecommendationDigestJob {
  id: string;
  title: string;
  slug: string | null;
  employer: string;
  location: string | null;
  state: string | null;
  isRemote: boolean;
  /** Job.displaySalary, printed as the job page prints it. */
  displaySalary: string | null;
  tier: 'easy_apply' | 'direct_apply' | 'external';
}

export interface RecommendationDigestInput {
  firstName: string | null;
  jobs: readonly RecommendationDigestJob[];
  /** EmailLead.unsubscribeToken; without one the footer links the manage page, never a dead link. */
  unsubscribeToken: string | null;
  /** Site origin, no trailing slash. */
  baseUrl: string;
}

/** "5 new roles match your profile". Plain text, for the subject and heading. */
export function recommendationDigestHeadline(count: number): string {
  return `${count} new ${count === 1 ? 'role' : 'roles'} match${count === 1 ? 'es' : ''} your profile`;
}

function jobUrl(job: RecommendationDigestJob, baseUrl: string): string {
  return `${baseUrl}/jobs/${encodeURIComponent(job.slug || job.id)}`;
}

/** State and Remote, or state and city: the same line the old digest showed. */
function locationLine(job: RecommendationDigestJob): string {
  const parts: string[] = [];
  if (job.state) parts.push(job.state);
  if (job.isRemote) parts.push('Remote');
  else if (job.location) parts.push(job.location);
  return parts.join(' · ');
}

export function buildRecommendationDigestHtml(input: RecommendationDigestInput): string {
  const { firstName, jobs, unsubscribeToken } = input;
  // getBaseUrl() keeps a trailing slash if the setting has one; the links
  // below would then read "//jobs".
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi there,';
  // The card escapes every text field it prints, so the values go in raw.
  const cards = jobs
    .map((job, i) =>
      renderJobCardHtml(
        {
          title: job.title,
          employer: job.employer,
          location: locationLine(job),
          applyOnPlatform: job.tier === 'easy_apply',
          sourceType: job.tier === 'direct_apply' ? 'employer' : null,
          salaryText: job.displaySalary ?? '',
          jobUrl: jobUrl(job, baseUrl),
        },
        i,
        i === jobs.length - 1,
      ),
    )
    .join('');

  const whyLine = `<p style="margin:0 0 8px;font-family:${SANS};font-size:12px;color:#A0AEC0;line-height:1.5;">
                You are getting this because you turned on job recommendations by email.
                <a href="${baseUrl}/settings?tab=account" style="color:#A0AEC0;text-decoration:underline;">Change this in your settings</a>.
              </p>`;

  return emailShellV2(
    `
      ${headerBlockV2(escapeHtml(recommendationDigestHeadline(jobs.length)), '')}
      ${spacerV2(12)}
      <tr><td class="content-pad" style="padding:0 40px;">${bodyTextV2(`${greeting} we picked these from your latest recommendations, with Easy Apply jobs first.`)}</td></tr>
      ${spacerV2(24)}
      ${cards}
      ${spacerV2(40)}
      ${closeContentV2()}`,
    `${whyLine}${unsubscribeFooterV2(unsubscribeToken ?? '')}`,
    'Picked from your latest recommendations, Easy Apply first.',
  );
}
