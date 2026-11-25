/**
 * The description structure backfill (scripts/backfill-description-structure.ts):
 * which rows it reads, that it never changes a word or an employer's HTML,
 * that it saves every old text before its first write, and that a write is
 * the description alone, kept only while the row still holds what was read.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  backfillDescriptionStructure,
  descriptionBatchWhere,
  parseDescriptionBackfillArgs,
  structuredDescriptionFor,
  unknownDescriptionBackfillArgs,
} from '../../scripts/backfill-description-structure';

const SENTENCE =
  'Applicants are expected to keep a current, full and unrestricted license in a State or Territory of the United States, and to show it on the first day of work.';
const WALL = [
  SENTENCE, SENTENCE,
  'Licensure and Certification.', SENTENCE, SENTENCE,
  'Basic Certification.', SENTENCE, SENTENCE,
].join(' ');

const NOW = new Date('2026-11-25T12:00:00Z');

describe('arguments', () => {
  it('is a dry run against production unless told otherwise', () => {
    expect(parseDescriptionBackfillArgs([])).toEqual({ apply: false, env: 'prod' });
    expect(parseDescriptionBackfillArgs(['--apply', '--env=dev'])).toEqual({ apply: true, env: 'dev' });
  });
  it('names an argument it does not know, so a mistyped one never runs', () => {
    expect(unknownDescriptionBackfillArgs(['--apply', '--env=dve'])).toEqual(['--env=dve']);
  });
});

describe('which rows', () => {
  it('reads only served rows, never an employer post, in id order', () => {
    const where = descriptionBatchWhere('abc', NOW) as Record<string, unknown>;
    expect(where.isPublished).toBe(true);
    expect(where.AND).toEqual([
      { OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
      { OR: [{ sourceType: null }, { NOT: { sourceType: 'employer' } }] },
    ]);
    expect(where.id).toEqual({ gt: 'abc' });
  });
});

describe('structuredDescriptionFor', () => {
  it('structures a wall and keeps every word', () => {
    const next = structuredDescriptionFor(WALL);
    expect(next).not.toBeNull();
    expect(next!.split('\n')).toContain('Licensure and Certification:');
  });
  it('leaves a short body, an empty one and any HTML alone', () => {
    expect(structuredDescriptionFor('Short and already fine.')).toBeNull();
    expect(structuredDescriptionFor(null)).toBeNull();
    expect(structuredDescriptionFor(`<p>${WALL}</p>`)).toBeNull();
  });
});

describe('backfillDescriptionStructure', () => {
  function fakeDb(rows: Array<{ id: string; slug: string | null; description: string }>) {
    const executeRaw = vi.fn(async () => 1);
    const findMany = vi.fn(async (args: { where: { id?: { gt: string } } }) => {
      const after = args.where.id?.gt;
      return rows.filter((row) => after === undefined || row.id > after);
    });
    return { db: { job: { findMany }, $executeRaw: executeRaw } as never, executeRaw, findMany };
  }

  it('a dry run writes nothing and saves nothing', async () => {
    const { db, executeRaw } = fakeDb([{ id: 'a', slug: 'a', description: WALL }]);
    const saveBackup = vi.fn();
    const result = await backfillDescriptionStructure(db, { apply: false, now: NOW, saveBackup }, 10);
    expect(result).toMatchObject({ scanned: 1, changed: 1, written: 0 });
    expect(executeRaw).not.toHaveBeenCalled();
    expect(saveBackup).not.toHaveBeenCalled();
  });

  it('saves every old text before the first write, then writes only the rows that change', async () => {
    const { db, executeRaw } = fakeDb([
      { id: 'a', slug: 'a', description: WALL },
      { id: 'b', slug: 'b', description: 'Short and already fine.' },
    ]);
    const order: string[] = [];
    executeRaw.mockImplementation(async () => {
      order.push('write');
      return 1;
    });
    const saveBackup = vi.fn(() => order.push('backup'));
    const result = await backfillDescriptionStructure(db, { apply: true, now: NOW, saveBackup }, 1);
    expect(result).toMatchObject({ scanned: 2, changed: 1, written: 1 });
    expect(saveBackup).toHaveBeenCalledWith([{ id: 'a', description: WALL }]);
    expect(order).toEqual(['backup', 'write']);
  });
});
