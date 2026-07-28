/**
 * Static regression guards for B19 — the evaluateEmailChange freebie-quota
 * guard (lib/auth/email-change-policy.ts, tests/lib/email-change-policy.test.ts).
 *
 * Verified 2026-07-28: NO email-change surface exists anywhere in the app —
 * no /api/auth/change-email route, no supabase.auth.updateUser({ email })
 * call (the only updateUser call is the password reset), and no Prisma write
 * that touches UserProfile.email outside signup creation. So there is nothing
 * to "enforce" the guard in today; the quota-bypass scenario it defends
 * against is unreachable.
 *
 * What CAN regress: someone adds an email-change surface later and forgets
 * the guard (docs/pricing-system.md audit #27 makes calling it mandatory).
 * This ratchet fails the moment a Supabase email-update call appears in a
 * file that does not also invoke evaluateEmailChange.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function collectSources(): string[] {
  const acc: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
    }
  };
  for (const d of ['app', 'components', 'lib']) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) walk(abs);
  }
  return acc;
}

describe('B19 — email-change freebie-quota guard', () => {
  it('the guard itself still exists and is exported', () => {
    const src = read('lib/auth/email-change-policy.ts');
    expect(src).toMatch(/export\s+async\s+function\s+evaluateEmailChange/);
  });

  it('every auth email-update call site invokes evaluateEmailChange', () => {
    // Flags supabase.auth.updateUser / admin.updateUserById calls whose
    // argument (scanned in a 300-char window after the call opens) carries
    // an `email:` key. The password-reset call (`updateUser({ password })`)
    // does not match.
    const callRe = /\.updateUser(?:ById)?\s*\(/g;
    const offenders: string[] = [];
    for (const f of collectSources()) {
      const src = fs.readFileSync(f, 'utf8');
      let m: RegExpExecArray | null;
      callRe.lastIndex = 0;
      while ((m = callRe.exec(src)) !== null) {
        const window = src.slice(m.index, m.index + 300);
        if (/\bemail\s*:/.test(window) && !src.includes('evaluateEmailChange')) {
          offenders.push(path.relative(ROOT, f));
          break;
        }
      }
    }
    expect(
      offenders,
      'These files change a user\'s auth email without calling ' +
        'evaluateEmailChange (required by the per-domain freebie quota — ' +
        'see lib/auth/email-change-policy.ts):\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
