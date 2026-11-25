/**
 * Backfill: break the walls of text in the stored descriptions of ingested
 * postings into headings, paragraphs and bullets, as ingest now does for new
 * ones (lib/description-structure.ts; owner, 2026-11-25: "please fix it and
 * back fill the structuring").
 *
 * WHICH ROWS, AND WHAT A WRITE TOUCHES:
 *   - Only rows the site serves are read (published, not past their expiry),
 *     and only ingested ones: a posting made on the site holds its
 *     employer's own HTML and is never read, and a body that holds HTML is
 *     skipped whatever its source says.
 *   - A row is written only when structuring changes its text. The write sets
 *     the description and nothing else, and only while the row still holds the
 *     text this run read. It moves neither updated_at nor content_changed_at:
 *     the text says what it said before, only in lines, so the sitemap date
 *     does not claim new content.
 *   - Structuring adds line breaks, headings and bullets and never changes,
 *     drops or reorders a word. A run checks that for every row it would
 *     write and stops before writing anything when one fails.
 *   - Before an --apply run writes, every row it will change is saved, id and
 *     old text, to a JSON Lines file under tmp/backfills (git-ignored), so the
 *     change can be undone row by row.
 *
 * NP Hiring has one database: --env=prod reads .env.prod and --env=dev reads
 * .env, and both name it. A dry run is the default; nothing is written without
 * --apply. The database host is printed before anything is read.
 *
 * Usage, from the repo's folder:
 *   npx ts-node -r tsconfig-paths/register --project scripts/tsconfig.json scripts/backfill-description-structure.ts            # dry run
 *   npx ts-node -r tsconfig-paths/register --project scripts/tsconfig.json scripts/backfill-description-structure.ts --apply    # write
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import type { Prisma, PrismaClient } from '@prisma/client';
import { structureDescription, wordsOf } from '@/lib/description-structure';
import { looksLikeHtml } from '@/lib/jd-blocks';

const BATCH_SIZE = 500;
const SAMPLES = 5;

export interface DescriptionBackfillOptions {
  apply: boolean;
  env: 'prod' | 'dev';
}

export function parseDescriptionBackfillArgs(argv: readonly string[]): DescriptionBackfillOptions {
  const args = new Set(argv);
  return { apply: args.has('--apply'), env: args.has('--env=dev') ? 'dev' : 'prod' };
}

const KNOWN_ARGS: ReadonlySet<string> = new Set(['--apply', '--env=prod', '--env=dev']);

/** Arguments the script does not know: a mistyped one is never read as something else. */
export function unknownDescriptionBackfillArgs(argv: readonly string[]): string[] {
  return argv.filter((arg) => !KNOWN_ARGS.has(arg));
}

/** The rows of the next batch: published, not expired, ingested, after `lastId` in id order. */
export function descriptionBatchWhere(lastId: string | undefined, now: Date): Prisma.JobWhereInput {
  return {
    isPublished: true,
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      // An old row may carry no source type; the HTML check keeps an
      // employer's own markup out either way.
      { OR: [{ sourceType: null }, { NOT: { sourceType: 'employer' } }] },
    ],
    ...(lastId === undefined ? {} : { id: { gt: lastId } }),
  };
}

/** The structured text for a stored description, or null when nothing would change. Throws when a word would be lost. */
export function structuredDescriptionFor(description: string | null): string | null {
  // HTML is an employer's own markup, rendered as HTML, never reflowed.
  if (!description || looksLikeHtml(description)) return null;
  const next = structureDescription(description);
  if (next === description) return null;
  const before = wordsOf(description);
  const after = wordsOf(next);
  if (before.length !== after.length || before.some((word, i) => word !== after[i])) {
    throw new Error('structuring changed the words of a description; nothing was written');
  }
  return next;
}

export interface DescriptionBackfillResult {
  scanned: number;
  changed: number;
  written: number;
  samples: string[];
  backup: Array<{ id: string; description: string }>;
}

type Db = Pick<PrismaClient, 'job' | '$executeRaw'>;

/** One run: plan every change and its backup in full, then, with `apply`, write. A failed check writes nothing. */
export async function backfillDescriptionStructure(
  db: Db,
  options: { apply: boolean; now?: Date; saveBackup?: (rows: DescriptionBackfillResult['backup']) => void },
  batchSize: number = BATCH_SIZE,
): Promise<DescriptionBackfillResult> {
  const now = options.now ?? new Date();
  const result: DescriptionBackfillResult = { scanned: 0, changed: 0, written: 0, samples: [], backup: [] };
  const plan: Array<{ id: string; expected: string; next: string }> = [];
  let lastId: string | undefined;
  for (;;) {
    const batch: Array<{ id: string; slug: string | null; description: string }> = await db.job.findMany({
      where: descriptionBatchWhere(lastId, now),
      select: { id: true, slug: true, description: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      result.scanned += 1;
      const next = structuredDescriptionFor(row.description);
      if (next === null) continue;
      result.changed += 1;
      plan.push({ id: row.id, expected: row.description, next });
      result.backup.push({ id: row.id, description: row.description });
      if (result.samples.length < SAMPLES) {
        const headings = next.split('\n').filter((line) => line.endsWith(':') && line.length < 60).slice(0, 3);
        result.samples.push(`/jobs/${row.slug ?? row.id}: ${row.description.split('\n').length} -> ${next.split('\n').length} lines${headings.length ? `; headings ${headings.join(' | ')}` : ''}`);
      }
    }
    lastId = batch[batch.length - 1].id;
  }
  if (!options.apply || plan.length === 0) return result;
  options.saveBackup?.(result.backup);
  for (const change of plan) {
    result.written += await db.$executeRaw`UPDATE "jobs" SET "description" = ${change.next} WHERE "id" = ${change.id} AND "description" = ${change.expected}`;
  }
  return result;
}

/** The host a database address names, without its user or password. */
function databaseHost(url: string | undefined): string {
  if (!url) return '(none)';
  try {
    return new URL(url).host;
  } catch {
    return '(unreadable address)';
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const unknown = unknownDescriptionBackfillArgs(argv);
  if (unknown.length > 0) {
    console.error(`Not run: this script does not know ${unknown.join(' ')}. It knows --apply, --env=prod and --env=dev. Nothing was read.`);
    process.exitCode = 1;
    return;
  }
  const options = parseDescriptionBackfillArgs(argv);
  if (options.env === 'prod') {
    dotenvConfig({ path: '.env.prod' });
    if (process.env.PROD_DATABASE_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
    if (process.env.PROD_DIRECT_URL && !process.env.DIRECT_URL) process.env.DIRECT_URL = process.env.PROD_DIRECT_URL;
  } else {
    dotenvConfig({ path: '.env' });
  }
  console.log(`\n=== DESCRIPTION STRUCTURE BACKFILL (${options.env}) ===`);
  console.log(`Database host: ${databaseHost(process.env.DATABASE_URL)}`);
  console.log(`Mode: ${options.apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  const { prisma } = await import('@/lib/prisma');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(process.cwd(), 'tmp', 'backfills', `description-structure-${options.env}-${stamp}.jsonl`);
  let result: DescriptionBackfillResult;
  try {
    result = await backfillDescriptionStructure(prisma, {
      apply: options.apply,
      saveBackup: (rows) => {
        mkdirSync(path.dirname(backupFile), { recursive: true });
        writeFileSync(backupFile, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
        console.log(`Backup of ${rows.length} rows' old text: ${backupFile}`);
      },
    });
  } finally {
    await prisma.$disconnect();
  }
  console.log('\n' + '='.repeat(60));
  console.log(`Scanned: ${result.scanned} served ingested postings`);
  console.log(`${options.apply ? 'Changed' : 'Would change'}: ${result.changed}${options.apply ? `, written ${result.written} (a row whose text changed since the read is left alone)` : ''}`);
  for (const sample of result.samples) console.log(`  ${sample}`);
  console.log('A write sets the description only; updated_at and content_changed_at are not moved. Every word of every changed row was checked to be kept.');
  if (!options.apply) console.log('\n(dry run: pass --apply to write)');
}

// Run only as a script; a test that imports the helpers above must not open a database.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main().catch((err: unknown) => {
    console.error('backfill-description-structure failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
