/**
 * /admin/outreach: employer leads and the cold-outreach templates.
 *
 * A thin server wrapper so the template list is decided per request: the
 * freeOffer template pitches free posting, so it is listed only while the
 * launch promo runs (lib/outreach-service#availableOutreachTemplates), and
 * POST /api/outreach refuses to render it afterwards. force-dynamic keeps
 * any cached render from listing it after config.promoEndsAt.
 *
 * Auth: gated by app/admin/layout.tsx's requireAdmin().
 */
import { availableOutreachTemplates } from '@/lib/outreach-service';
import OutreachClient from './OutreachClient';

export const dynamic = 'force-dynamic';

export default function OutreachPage() {
  return <OutreachClient templates={availableOutreachTemplates(new Date())} />;
}
