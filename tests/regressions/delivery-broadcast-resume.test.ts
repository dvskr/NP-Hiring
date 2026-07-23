/**
 * F23 regression — large admin broadcasts must not be fire-and-forget in a
 * freezing serverless function. Execution now runs on Inngest as durable,
 * resumable chunks; the admin route emits an event instead of a naked
 * un-awaited executeBroadcast() call; a 30-minute sweep resumes broadcasts
 * stuck in 'sending'.
 *
 * Static source guards.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('admin send route hands large audiences to Inngest', () => {
  const src = read('app/api/admin/email/send/route.ts');

  it('emits BROADCAST_REQUESTED_EVENT (awaited) for >50-recipient audiences', () => {
    expect(src).toMatch(/await inngest\.send\(\{\s*name: BROADCAST_REQUESTED_EVENT/);
  });

  it('exports maxDuration for the ≤50 synchronous path', () => {
    expect(src).toMatch(/export const maxDuration = \d+/);
  });

  it('only uses the in-process fallback when Inngest is unavailable', () => {
    expect(src).toContain('process.env.INNGEST_EVENT_KEY');
    const fallbackIdx = src.indexOf('executeBroadcast(broadcast.id).catch');
    const guardIdx = src.indexOf('if (!queuedViaInngest)');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(guardIdx);
  });

  it('has no console.* logging left', () => {
    expect(src).not.toMatch(/console\.(log|error|warn)/);
  });
});

describe('broadcast sender is chunked and resumable', () => {
  const src = read('lib/broadcast-sender.ts');

  it('exposes the chunk/finalize primitives used by the Inngest function', () => {
    expect(src).toContain('export async function processBroadcastChunk');
    expect(src).toContain('export async function finalizeBroadcast');
    expect(src).toContain('export const BROADCAST_CHUNK_SIZE');
  });

  it("each chunk pulls only still-pending recipients, so a resume can't double-send completed ones", () => {
    expect(src).toMatch(/where: \{ broadcastId, status: 'pending' \},\s*orderBy: \{ id: 'asc' \},\s*take: limit/);
  });

  it('persists progress with increments (safe across separate invocations)', () => {
    expect(src).toContain('sentCount: { increment: sent }');
    expect(src).toContain('failedCount: { increment: failed }');
  });
});

describe('Inngest broadcast function + stuck-broadcast sweep', () => {
  const src = read('lib/inngest/functions/broadcast-send.ts');

  it('serializes runs per broadcast (concurrency key)', () => {
    expect(src).toMatch(/concurrency: \{ limit: 1, key: 'event\.data\.broadcastId' \}/);
  });

  it('processes chunks as durable steps', () => {
    expect(src).toMatch(/step\.run\(`send-chunk-\$\{chunkIndex\}`/);
  });

  it("the sweep re-emits the event for broadcasts stuck 'sending' with pending recipients", () => {
    expect(src).toContain("status: 'sending'");
    expect(src).toMatch(/recipients: \{ some: \{ status: 'pending' \} \}/);
    expect(src).toMatch(/name: BROADCAST_REQUESTED_EVENT/);
  });

  it('the sweep finalizes broadcasts whose recipients are all done', () => {
    expect(src).toMatch(/recipients: \{ none: \{ status: 'pending' \} \}/);
  });

  it('both functions are registered in the Inngest serve handler', () => {
    const serveSrc = read('app/api/inngest/route.ts');
    expect(serveSrc).toContain('broadcastFunctions');
  });
});
