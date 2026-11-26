#!/usr/bin/env node
/**
 * `prisma migrate deploy` for the Vercel build, retried when the database
 * cannot be reached or a migration runs out of lock time.
 *
 * Every deploy runs it first (npm run build), even with no new migration, and
 * it needs a connection to the database. When the deploy can try again, and
 * why a migration that ran out of lock time is marked rolled back first, is
 * in scripts/migrate-deploy-policy.mjs. Any other failure (a migration that
 * fails for another reason, a drifted history) is reported at once, unchanged.
 *
 * Migrations still apply on deploy: .github/workflows/migrate-prod.yml is the
 * other path, but it applies nothing until PROD_DIRECT_DATABASE_URL is set.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { deployWithRetry } from './migrate-deploy-policy.mjs';

/**
 * Runs one Prisma CLI command, echoing its output as it comes.
 * @param {string[]} args
 * @returns {Promise<{ code: number, output: string }>}
 */
function runPrisma(args) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['prisma', ...args], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: process.env,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
    child.on('error', (error) => resolve({ code: 1, output: String(error) }));
  });
}

/**
 * @param {string} migration a folder under prisma/migrations
 * @returns {Promise<string | null>} its migration.sql, or null when unreadable
 */
async function readMigration(migration) {
  try {
    return await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), 'utf8');
  } catch (error) {
    console.error(`[migrate] could not read the file of ${migration}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

const code = await deployWithRetry({
  deploy: () => runPrisma(['migrate', 'deploy']),
  markRolledBack: (migration) => runPrisma(['migrate', 'resolve', '--rolled-back', migration]),
  readMigration,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (line) => console.error(line),
});
process.exit(code);
