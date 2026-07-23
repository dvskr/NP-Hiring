/**
 * Static regression guards for the messaging backlog fixes
 * (B1, B2/B100, B17, B62, B99, B103). Each reads the real source so a
 * future edit can't silently revert the fix.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

describe('B17 — legacy candidate inbox endpoint is gone', () => {
  it('app/api/messages is deleted (superseded by /api/conversations)', () => {
    expect(exists('app/api/messages/route.ts')).toBe(false);
    expect(exists('app/api/messages')).toBe(false);
  });

  it('no runtime code references /api/messages', () => {
    const dirs = ['app', 'components', 'lib'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          const src = fs.readFileSync(full, 'utf8');
          // Match the exact endpoint, not /api/messages/... subpaths of
          // other routers or unrelated vendor-docs URLs.
          if (/['"`]\/api\/messages['"`]/.test(src)) offenders.push(full);
        }
      }
    };
    for (const d of dirs) walk(path.join(ROOT, d));
    expect(offenders).toEqual([]);
  });
});

describe('B2/B100 — message edit endpoint matches the send path', () => {
  const rel = 'app/api/conversations/[id]/messages/[messageId]/edit/route.ts';
  it('sanitizes the edited body with sanitizeText', () => {
    const src = read(rel);
    expect(src).toContain("import { sanitizeText } from '@/lib/sanitize'");
    expect(src).toMatch(/sanitizeText\(body\.trim\(\),\s*2000\)/);
    // The raw body must never be stored.
    expect(src).not.toMatch(/body:\s*body\.trim\(\)/);
  });
  it('enforces the same 2000-char cap as the send path', () => {
    const src = read(rel);
    expect(src).toMatch(/body\.length > 2000/);
  });

  it('employer compose path sanitizes the stored body too', () => {
    const src = read('app/api/employer/messages/route.ts');
    expect(src).toMatch(/sanitizeText\(messageBody\.trim\(\),\s*2000\)/);
    // The stored row must not receive the raw body (the destructuring
    // alias `body: messageBody` on the request JSON is fine).
    expect(src).not.toMatch(/body:\s*messageBody,\s*\n\s*\.\.\.\(jobId/);
  });
});

describe('B99 — attachment path must belong to the sender', () => {
  const rel = 'app/api/conversations/[id]/route.ts';
  it('normalizes the client-supplied path and checks the uploader-uid prefix', () => {
    const src = read(rel);
    expect(src).toContain("toBareDocPath(attachmentUrl, 'message_attachment')");
    expect(src).toContain('barePath.startsWith(`${user.id}/`)');
    expect(src).toMatch(/barePath\.includes\('\.\.'\)/);
  });
  it('stores only the validated path, never the raw request value', () => {
    const src = read(rel);
    expect(src).toContain('validatedAttachmentPath && { attachmentUrl: validatedAttachmentPath }');
    expect(src).not.toMatch(/\.\.\.\(attachmentUrl && \{ attachmentUrl \}\)/);
  });
});

describe('B1 — InMail/featured-job gate cannot be skipped via a new job-scoped thread', () => {
  const rel = 'app/api/employer/messages/route.ts';
  it('the free-reply shortcut is scoped to the exact (pair, job) thread key', () => {
    const src = read(rel);
    const gateCheck = src.slice(0, src.indexOf('if (!existingConversation)'));
    // The existence check that bypasses the gate must filter on jobId —
    // an unscoped pair-wide check made every later thread free.
    expect(gateCheck).toMatch(/existingConversation = await prisma\.conversation\.findFirst\(\{\s*where:\s*\{\s*jobId:\s*jobId \|\| null/);
  });
  it('gate still enforces featured job + InMail credits for new threads', () => {
    const src = read(rel);
    expect(src).toContain('canSendInMail(senderProfile.id, user.id, tier)');
    expect(src).toContain('Messaging is available for featured job postings only');
  });
});

describe('B103 — conversation dedupe is race-safe', () => {
  const rel = 'app/api/employer/messages/route.ts';
  it('find-or-create + first message + lastMessageAt run in one transaction', () => {
    const src = read(rel);
    expect(src).toMatch(/prisma\.\$transaction\(async \(tx\) =>/);
    expect(src).toMatch(/tx\.conversation\.create/);
    expect(src).toMatch(/tx\.employerMessage\.create/);
    expect(src).toMatch(/tx\.conversation\.update/);
  });
  it('new conversations store participants in sorted order', () => {
    const src = read(rel);
    expect(src).toContain('[senderProfile.id, recipient.id].sort()');
  });
  it('retries the transaction when the unique key loses the create race', () => {
    const src = read(rel);
    expect(src).toContain("'P2002'");
    expect(src).toMatch(/return sendMessage\(\)/);
  });
});

describe('B62 — /messages has a real document title', () => {
  it('app/messages/layout.tsx exports metadata with a title', () => {
    expect(exists('app/messages/layout.tsx')).toBe(true);
    const src = read('app/messages/layout.tsx');
    expect(src).toContain('export const metadata');
    expect(src).toMatch(/title:\s*'Messages'/);
    expect(src).toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});
