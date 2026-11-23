/**
 * What the alert forms say after POST /api/job-alerts answers.
 *
 * One reading of the answer for the four forms (/job-alerts, the alert
 * dialog, the exit popup and the manage page), so none of them says "created"
 * for an alert that already existed, or "active" for one that sends nothing.
 *
 * Only the address's owner (signed in as it, lib/job-alerts/alert-access.ts)
 * is told whether an alert was created, turned back on or already there.
 * Anyone else gets `checkInbox` whatever happened, and this copy says nothing
 * more, so the page cannot tell a stranger whether the address has alerts
 * here or turned our email off.
 */

export interface AlertCreateAnswer {
  checkInbox?: boolean;
  created?: boolean;
  reactivated?: boolean;
}

export type AlertResultKind = 'check_inbox' | 'created' | 'reactivated' | 'already_active';

export interface AlertResultCopy {
  kind: AlertResultKind;
  title: string;
  body: string;
}

export function alertResultCopy(answer: AlertCreateAnswer, frequency?: string | null): AlertResultCopy {
  if (answer.checkInbox === true) {
    return {
      kind: 'check_inbox',
      title: 'Check your inbox',
      body: 'If that address can receive our email, its job alert emails arrive there, each with a link to manage them. To change alerts you set up before, sign in with that address.',
    };
  }
  if (answer.reactivated === true) {
    return {
      kind: 'reactivated',
      title: 'Alert turned back on',
      body: 'You already had this alert paused, so it is on again, and matching jobs will arrive in your inbox.',
    };
  }
  if (answer.created === true) {
    return {
      kind: 'created',
      title: 'Job alert created!',
      body: 'Your alert is active, and matching jobs will arrive in your inbox.',
    };
  }
  const cadence = frequency === 'daily' || frequency === 'weekly' ? ` It sends a ${frequency} digest.` : '';
  return {
    kind: 'already_active',
    title: 'You already have this alert',
    body: `An alert with these settings is already active for this address, so no second one was made.${cadence}`,
  };
}
