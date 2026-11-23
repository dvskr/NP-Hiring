/**
 * Accounts whose applications from an assistant are tests.
 *
 * A directory reviewer, or the owner trying the connector, signs in with a
 * real account and asks the assistant to apply to a job. Every job that
 * takes applications here belongs to an employer, who would then be emailed
 * about an applicant who does not exist. For an account listed in
 * MCP_TEST_ACCOUNTS, submit_application runs every check a real application
 * passes and stops there: nothing is stored and nobody is emailed, and the
 * review and the reply both say so.
 *
 * The list is the operator's: email addresses or account ids in the
 * environment, separated by commas or spaces. Nothing a caller sends can put
 * an account on it or take one off. An account id never changes, so it is
 * the entry to use where an address might; an address is matched against
 * the account's own, whole, whatever its capitals. The website's own Easy
 * Apply form is not affected, so the operator can still give such an account
 * a real application to track.
 */
export function isTestAccount(account: { email?: string | null; userId?: string | null }): boolean {
  const listed = new Set((process.env.MCP_TEST_ACCOUNTS ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean));
  if (listed.size === 0) return false;
  return [account.email, account.userId].some((value) => {
    const entry = value?.trim().toLowerCase();
    return !!entry && listed.has(entry);
  });
}
