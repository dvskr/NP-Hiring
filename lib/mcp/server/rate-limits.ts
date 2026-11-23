import { checkRateLimit } from '@/lib/rate-limit';
import type { ToolContext } from './types';

/**
 * Budgets for MCP requests and tool calls.
 *
 * Every MCP request arrives from Anthropic's or OpenAI's servers, so the
 * client IP is shared by every user of that host. Signed-in calls are
 * therefore budgeted per account. Signed-out calls are always charged to the
 * IP, with a budget large enough to be shared. ChatGPT's anonymised subject,
 * when sent, adds a second and tighter bucket on top: it comes from the
 * request body, so it may narrow a budget but must never open a new one.
 */

interface Budget {
  limit: number;
  windowSeconds: number;
}

/** Every POST to an MCP endpoint, before the body is parsed or a token is checked. */
const REQUEST_PER_IP: Budget = { limit: 1200, windowSeconds: 60 };
const SIGNED_IN: Budget = { limit: 60, windowSeconds: 60 };
const ANONYMOUS_PER_IP: Budget = { limit: 600, windowSeconds: 60 };
const ANONYMOUS_PER_SUBJECT: Budget = { limit: 30, windowSeconds: 60 };

/**
 * Writes that reach other people get their own, tighter, hourly budgets, and
 * so do the two reviews, since each one stores a row (a posting preview
 * holds the whole posting) until the cleanup cron removes it.
 */
const TOOL_BUDGETS: Readonly<Record<string, Budget>> = {
  prepare_application: { limit: 60, windowSeconds: 3600 },
  preview_job_posting: { limit: 30, windowSeconds: 3600 },
  submit_application: { limit: 20, windowSeconds: 3600 },
  withdraw_application: { limit: 30, windowSeconds: 3600 },
  create_job_alert: { limit: 10, windowSeconds: 3600 },
  delete_job_alert: { limit: 30, windowSeconds: 3600 },
  publish_job_posting: { limit: 10, windowSeconds: 3600 },
  update_applicant_status: { limit: 120, windowSeconds: 3600 },
  set_posting_live: { limit: 20, windowSeconds: 3600 },
  update_job_posting: { limit: 20, windowSeconds: 3600 },
  add_applicant_note: { limit: 60, windowSeconds: 3600 },
};

export interface BudgetVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

function anonymousSubject(meta: Record<string, unknown> | undefined): string | null {
  const subject = meta?.['openai/subject'];
  return typeof subject === 'string' && subject.length > 0 && subject.length <= 200 ? subject : null;
}

/** Charges every bucket; the call is allowed only if all of them had room. */
async function charge(buckets: { key: string; budget: Budget }[]): Promise<BudgetVerdict> {
  const results = await Promise.all(buckets.map((b) => checkRateLimit(`ratelimit:${b.key}`, b.budget)));
  const refused = results.filter((r) => !r.success);
  if (refused.length === 0) return { allowed: true, retryAfterSeconds: 0 };
  const reset = Math.max(...refused.map((r) => r.reset));
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
}

/** The coarse per-IP guard on the endpoint itself, so initialize and tools/list are metered too. */
export function checkRequestBudget(endpoint: string, ip: string): Promise<BudgetVerdict> {
  return charge([{ key: `mcp:${endpoint}:req:ip:${ip}`, budget: REQUEST_PER_IP }]);
}

export function checkToolBudget(tool: string, ctx: ToolContext): Promise<BudgetVerdict> {
  if (ctx.access) {
    return charge([
      { key: `mcp:${ctx.endpoint}:${tool}:u:${ctx.access.userId}`, budget: TOOL_BUDGETS[tool] ?? SIGNED_IN },
    ]);
  }
  const buckets = [{ key: `mcp:${ctx.endpoint}:anon:ip:${ctx.ip}`, budget: ANONYMOUS_PER_IP }];
  const subject = anonymousSubject(ctx.requestMeta);
  if (subject) buckets.push({ key: `mcp:${ctx.endpoint}:anon:s:${subject}`, budget: ANONYMOUS_PER_SUBJECT });
  return charge(buckets);
}
