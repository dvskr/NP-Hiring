import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { insensitiveIn } from '@/lib/insensitive-in';

/**
 * Deleting a job alert by its row id for a signed-in account, when the alert
 * is sent to that account's address, and saying whose alert it is. This is
 * the AI app connector, which never sees an alert's token. (The manage and
 * unsubscribe pages delete by token, through DELETE /api/job-alerts.)
 *
 * Deleting is removing the row and nothing else: the address's other alerts
 * and its email preferences are untouched.
 */

/**
 * The alerts sent to one address.
 *
 * createJobAlert stores addresses lower case, but a row written another way
 * may not be, so the match ignores case. It goes through insensitiveIn and
 * not a case-insensitive `equals`: Prisma compiles that to ILIKE with the
 * address as the pattern, in which an underscore matches any character, so
 * "a_b@x.com" would also own the alerts of "axb@x.com".
 */
export function jobAlertsForEmailWhere(email: string): Prisma.JobAlertWhereInput {
  return { email: insensitiveIn([email]) };
}

/** The same test on a row already read, so a caller need not trust the query alone. */
export function isJobAlertForEmail(alert: { email: string }, email: string): boolean {
  return alert.email.toLowerCase() === email.toLowerCase();
}

/**
 * False when the alert does not exist or is sent to another address. The two
 * are not told apart, so an id cannot be used to learn that an alert exists.
 */
export async function deleteJobAlertForEmail(alertId: string, email: string): Promise<boolean> {
  const where: Prisma.JobAlertWhereInput = { id: alertId, ...jobAlertsForEmailWhere(email) };
  const alert = await prisma.jobAlert.findFirst({ where, select: { id: true, email: true } });
  if (!alert || !isJobAlertForEmail(alert, email)) return false;
  // deleteMany with the owner still in the filter: a second call racing this
  // one finds nothing to delete and says so, instead of throwing.
  const { count } = await prisma.jobAlert.deleteMany({ where });
  return count > 0;
}
