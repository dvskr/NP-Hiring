import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { generateSecret } from '@/lib/mcp/oauth/crypto';
import { MCP_PREFIX } from '@/lib/mcp/prefix';

/**
 * Server-held reviews that gate the connectors' two outward writes.
 *
 * prepare_application and preview_job_posting each store what the person
 * was shown and return its id; submit_application and publish_job_posting
 * take that id instead of trusting the model to restate the request. So a
 * write can only send what a review showed, for the account that saw it,
 * within the hour, and once: a publish retried after a lost response gets
 * the first attempt's outcome back instead of a second posting.
 *
 * The id is in the tool result, which the model reads, so holding it is not
 * the person's consent. That comes from the host's confirmation prompt for
 * destructive tools and from the card's own buttons. What the id removes is
 * a write of something that was never previewed, or of something different.
 */

export type PendingActionKind = 'submit_application' | 'publish_posting';

/** Long enough to edit a cover letter, or to check a posting with a colleague. */
export const PENDING_ACTION_TTL_SECONDS = 60 * 60;
const ID_PREFIX: Readonly<Record<PendingActionKind, string>> = {
  submit_application: `${MCP_PREFIX}_rv_`,
  publish_posting: `${MCP_PREFIX}_pv_`,
};
const MAX_ID_LENGTH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function createPendingAction(input: {
  userId: string;
  kind: PendingActionKind;
  subjectId?: string | null;
  payload?: Prisma.InputJsonValue;
}): Promise<string> {
  const id = generateSecret(ID_PREFIX[input.kind], 24);
  await prisma.mcpPendingAction.create({
    data: {
      id,
      userId: input.userId,
      kind: input.kind,
      subjectId: input.subjectId ?? null,
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      expiresAt: new Date(Date.now() + PENDING_ACTION_TTL_SECONDS * 1000),
    },
  });
  return id;
}

export type ClaimOutcome =
  | { status: 'claimed'; subjectId: string | null; payload: unknown }
  | { status: 'done'; subjectId: string | null; payload: unknown; result: unknown }
  | { status: 'in_progress' }
  | { status: 'expired' }
  | { status: 'unknown' };

/**
 * Takes a review for one write. 'done' hands back the result of a write
 * that already finished with it; 'in_progress' means another call holds it.
 */
export async function claimPendingAction(
  id: unknown,
  owner: { userId: string; kind: PendingActionKind },
): Promise<ClaimOutcome> {
  if (typeof id !== 'string' || !id.startsWith(ID_PREFIX[owner.kind]) || id.length > MAX_ID_LENGTH) {
    return { status: 'unknown' };
  }
  const row = await prisma.mcpPendingAction.findUnique({ where: { id } });
  // Another account's id reads as unknown, never as "not yours".
  if (!row || row.userId !== owner.userId || row.kind !== owner.kind) return { status: 'unknown' };
  if (row.result !== null) return { status: 'done', subjectId: row.subjectId, payload: row.payload, result: row.result };
  if (row.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
  if (row.consumedAt) return { status: 'in_progress' };
  // The single-use lock: of two concurrent writes, only one flips consumedAt.
  const claimed = await prisma.mcpPendingAction.updateMany({
    where: { id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return claimed.count === 1
    ? { status: 'claimed', subjectId: row.subjectId, payload: row.payload }
    : { status: 'in_progress' };
}

/** Records a finished write, so the same id returns it from now on. */
export async function completePendingAction(id: string, result: Prisma.InputJsonValue): Promise<void> {
  await prisma.mcpPendingAction.update({ where: { id }, data: { result } });
}

/** Hands a claimed review back after a write that changed nothing, so it can be retried. */
export async function releasePendingAction(id: string): Promise<void> {
  await prisma.mcpPendingAction.updateMany({ where: { id }, data: { consumedAt: null } });
}

/** Deletes reviews a day after they expired; the OAuth cleanup cron calls this. */
export async function purgeExpiredPendingActions(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.mcpPendingAction.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - DAY_MS) } },
  });
  return count;
}
