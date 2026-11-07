import { prisma } from '@/lib/prisma';
import { syncToBeehiiv } from '@/lib/beehiiv';

/**
 * Opt an address (trimmed, lowercased) in to the newsletter: create its
 * email lead, or set newsletterOptIn on the one it has, then copy it to
 * Beehiiv (fire and forget). `source` is kept only on a new lead. Used by the
 * public signup (app/api/newsletter) and by a guide claim whose reader ticked
 * the box (app/api/guides/claim).
 */
export async function subscribeToNewsletter(email: string, source: string): Promise<void> {
    await prisma.emailLead.upsert({
        where: { email },
        update: { newsletterOptIn: true },
        create: { email, source, newsletterOptIn: true },
    });
    syncToBeehiiv(email, { utmSource: source });
}

/**
 * The opt-in of a request that has not shown it owns the address (an
 * anonymous guide claim): subscribes only an address the site has never
 * seen. An address already on file keeps its choice, so this can never
 * re-subscribe someone who unsubscribed. True when it subscribed.
 */
export async function subscribeNewAddressToNewsletter(email: string, source: string): Promise<boolean> {
    const known = await prisma.emailLead.findUnique({ where: { email }, select: { id: true } });
    if (known) return false;
    try {
        await prisma.emailLead.create({ data: { email, source, newsletterOptIn: true } });
    } catch (error) {
        // Created a moment ago by another request: it keeps that request's choice.
        if ((error as { code?: string } | null)?.code === 'P2002') return false;
        throw error;
    }
    syncToBeehiiv(email, { utmSource: source });
    return true;
}
