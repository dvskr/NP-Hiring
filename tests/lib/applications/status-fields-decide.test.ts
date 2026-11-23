/**
 * decideSubmission (lib/applications/status-fields.ts): what a submission
 * does, given the row it lands on and what its own answers decided.
 */
import { describe, it, expect } from 'vitest';
import { decideSubmission, type ExistingApplicationState } from '@/lib/applications/status-fields';
import { AUTO_REJECT_NOTE_PREFIX, GENERIC_AUTO_REJECT_REASON, notesAfterWithdrawal } from '@/lib/applications/auto-reject';

const NOW = new Date('2026-11-23T12:00:00Z');
const QUESTIONS = [{ questionText: 'Active license?' }];
const PASS = { autoReject: false, autoRejectReason: '' };
const FAIL = { autoReject: true, autoRejectReason: 'Does not meet requirement: Active license?' };

const row = (overrides: Partial<ExistingApplicationState>): ExistingApplicationState => ({
  status: 'applied',
  withdrawnAt: null,
  notes: null,
  consentGiven: true,
  sourceUrl: 'platform',
  ...overrides,
});

describe('decideSubmission', () => {
  it('a first application is new and takes the schema default', () => {
    expect(decideSubmission(null, PASS, QUESTIONS, NOW)).toEqual({
      autoReject: false,
      autoRejectReason: '',
      priorAutoReject: false,
      isNewSubmission: true,
      statusFields: {},
    });
  });

  it('a first application with a knockout answer is rejected with its record, and is not news', () => {
    const decided = decideSubmission(null, FAIL, QUESTIONS, NOW);
    expect(decided).toMatchObject({ autoReject: true, isNewSubmission: false });
    expect(decided.statusFields).toEqual({ status: 'rejected', notes: `${AUTO_REJECT_NOTE_PREFIX}${FAIL.autoRejectReason}`, statusUpdatedAt: NOW });
  });

  it('a repeat submit on a live application is not news and leaves the stage alone', () => {
    expect(decideSubmission(row({ status: 'interview' }), PASS, QUESTIONS, NOW)).toMatchObject({ isNewSubmission: false, statusFields: {} });
  });

  it('a knockout answer on an application the employer has is not a rejection', () => {
    const decided = decideSubmission(row({ status: 'offered', notes: 'Call back Friday' }), FAIL, QUESTIONS, NOW);
    expect(decided).toMatchObject({ autoReject: false, autoRejectReason: '', priorAutoReject: false, statusFields: {} });
  });

  it('a withdrawn application submitted again is active and news again', () => {
    expect(decideSubmission(row({ status: 'withdrawn', withdrawnAt: NOW }), PASS, QUESTIONS, NOW)).toMatchObject({
      isNewSubmission: true,
      statusFields: { status: 'applied', statusUpdatedAt: NOW },
    });
  });

  it('withdrawing a knockout and applying again is the same knockout, whatever the new answers', () => {
    const withdrawn = row({ status: 'withdrawn', withdrawnAt: NOW, notes: notesAfterWithdrawal({ status: 'rejected', notes: `${AUTO_REJECT_NOTE_PREFIX}x` }) });
    expect(decideSubmission(withdrawn, PASS, QUESTIONS, NOW)).toEqual({
      autoReject: true,
      autoRejectReason: GENERIC_AUTO_REJECT_REASON,
      priorAutoReject: true,
      isNewSubmission: false,
      statusFields: { status: 'rejected', statusUpdatedAt: NOW },
    });
  });

  it('a rejected knockout keeps its own reason from the job\'s questions, never the employer\'s words', () => {
    const rejected = row({ status: 'rejected', notes: `${AUTO_REJECT_NOTE_PREFIX}Does not meet requirement: Active license?\nprivate note` });
    expect(decideSubmission(rejected, PASS, QUESTIONS, NOW)).toMatchObject({
      autoReject: true,
      autoRejectReason: 'Does not meet requirement: Active license?',
      priorAutoReject: true,
      statusFields: {},
    });
  });

  it('a knockout the employer overturned does not decide a resubmission', () => {
    const overturned = row({ status: 'screening', notes: `${AUTO_REJECT_NOTE_PREFIX}Does not meet requirement: Active license?` });
    expect(decideSubmission(overturned, PASS, QUESTIONS, NOW)).toMatchObject({ autoReject: false, priorAutoReject: false, statusFields: {} });
  });

  it('a tracked row is a first submission, and a knockout record goes above its notes', () => {
    const tracked = row({ consentGiven: false, sourceUrl: null, notes: 'Referred' });
    expect(decideSubmission(tracked, PASS, QUESTIONS, NOW)).toMatchObject({ isNewSubmission: true });
    expect(decideSubmission(tracked, FAIL, QUESTIONS, NOW).statusFields).toMatchObject({
      status: 'rejected',
      notes: `${AUTO_REJECT_NOTE_PREFIX}${FAIL.autoRejectReason}\nReferred`,
    });
  });
});

describe('notesAfterWithdrawal', () => {
  it('keeps only the bare record on a rejected knockout, and nothing otherwise', () => {
    expect(notesAfterWithdrawal({ status: 'rejected', notes: `${AUTO_REJECT_NOTE_PREFIX}reason\nemployer words` })).toBe(AUTO_REJECT_NOTE_PREFIX);
    expect(notesAfterWithdrawal({ status: 'interview', notes: `${AUTO_REJECT_NOTE_PREFIX}reason` })).toBeNull();
    expect(notesAfterWithdrawal({ status: 'applied', notes: 'employer words' })).toBeNull();
  });
});
