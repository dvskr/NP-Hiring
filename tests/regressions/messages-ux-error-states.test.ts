/**
 * Regression guards for F15 — Messages API failures must not masquerade as an
 * empty inbox or fail silently.
 *
 *   - non-OK GET /api/conversations previously set conversations to [] with no
 *     error flag, so the UI showed the designed "No messages yet" empty state
 *   - opening a thread on failure returned silently (spinner stopped, blank)
 *   - a failed send was only console.error'd — no user feedback, and the only
 *     non-network failure path was a blocking alert()
 *
 * These tests read the real source file and assert the error states stay wired.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(
  path.join(process.cwd(), 'app/messages/page.tsx'),
  'utf8',
);

describe('F15 — conversation list load failure is distinct from empty', () => {
  it('non-OK and thrown fetches both set loadError', () => {
    const occurrences = SRC.match(/setLoadError\(true\)/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('renders an error panel with a Retry action, checked before the empty state', () => {
    const errorBranch = SRC.indexOf('loadError ? (');
    const emptyBranch = SRC.indexOf('conversations.length === 0 ? (');
    expect(errorBranch).toBeGreaterThan(-1);
    expect(emptyBranch).toBeGreaterThan(-1);
    expect(errorBranch).toBeLessThan(emptyBranch);
    // Retry re-runs the fetch (DashboardContent "Try Again" pattern).
    expect(SRC).toMatch(/onClick=\{fetchConversations\}/);
    expect(SRC).toContain('Try Again');
  });
});

describe('F15 — opening a thread on failure shows feedback', () => {
  it('non-OK and thrown thread fetches both set threadError', () => {
    const occurrences = SRC.match(/setThreadError\(true\)/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('surfaces an error toast via the mounted ToastProvider', () => {
    expect(SRC).toContain("from '@/components/ui/ToastProvider'");
    expect(SRC).toMatch(/notifyToast\('Could not open conversation[^']*',\s*'error'\)/);
  });

  it('thread error branch renders before convDetail so stale detail cannot mask it', () => {
    const threadErrorBranch = SRC.indexOf('threadError ? (');
    const convDetailBranch = SRC.indexOf('convDetail ? (');
    expect(threadErrorBranch).toBeGreaterThan(-1);
    expect(convDetailBranch).toBeGreaterThan(-1);
    expect(threadErrorBranch).toBeLessThan(convDetailBranch);
  });
});

describe('F15 — failed send keeps composer text and offers inline retry', () => {
  it('send failures set sendError instead of alert()', () => {
    expect(SRC).toContain("setSendError(data?.error || 'Failed to send')");
    expect(SRC).toContain("setSendError('Failed to send')");
    expect(SRC).not.toContain("alert(data.error || 'Failed to send')");
  });

  it('renders an inline banner with a Retry button wired to handleSendReply', () => {
    expect(SRC).toMatch(/sendError && \(/);
    expect(SRC).toContain('your message was not delivered');
    // The banner's retry re-invokes the send with the preserved composer text.
    expect(SRC).toMatch(/sendError && \([\s\S]{0,1200}?onClick=\{handleSendReply\}/);
  });

  it('composer text is only cleared on the success path', () => {
    // setReplyText('') must not appear inside the send catch/error handling —
    // it exists once when opening a conversation and once after a 200 response.
    const catchBlock = SRC.match(
      /catch \(err\) \{\s*console\.error\('Error sending reply:'[\s\S]*?\}/,
    );
    expect(catchBlock).not.toBeNull();
    expect(catchBlock![0]).not.toContain("setReplyText('')");
    expect(catchBlock![0]).toContain("setSendError('Failed to send')");
  });
});
