#!/usr/bin/env node
/**
 * `prisma migrate deploy` for the Vercel build, retried when the database
 * cannot be reached.
 *
 * Every deploy runs it first (npm run build), even with no new migration, and
 * it needs a connection to the database. The production build of 171bef4
 * failed two minutes in on 2026-11-17 at 18:59 UTC, with no migration in the
 * commit, while crawler load was exhausting the database's connections; the
 * same code built later. A connection failure there is transient, so it is
 * retried twice, 15 and 30 seconds apart. Any other failure (a migration that
 * fails, a drifted history) is reported at once, unchanged.
 *
 * Migrations still apply on deploy: .github/workflows/migrate-prod.yml is the
 * other path, but it applies nothing until PROD_DIRECT_DATABASE_URL is set.
 */
import { spawn } from 'node:child_process';

const RETRY_DELAYS_MS = [15_000, 30_000];

// Prisma's connection error codes: P1001 can't reach the server, P1002 the
// server timed out (also the advisory-lock wait), P1017 the server closed the
// connection. The text patterns cover a pooler or Postgres refusing a client.
const TRANSIENT = [
  /\bP1001\b/,
  /\bP1002\b/,
  /\bP1017\b/,
  /too many (clients|connections)/i,
  /max client connections/i,
  /remaining connection slots are reserved/i,
  /ECONNRESET|ETIMEDOUT|ECONNREFUSED/,
];

function runOnce() {
  return new Promise((resolve) => {
    const child = spawn('npx', ['prisma', 'migrate', 'deploy'], {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let attempt = 0; ; attempt += 1) {
  const { code, output } = await runOnce();
  if (code === 0) process.exit(0);
  const transient = TRANSIENT.some((pattern) => pattern.test(output));
  const delay = RETRY_DELAYS_MS[attempt];
  if (!transient || delay === undefined) {
    console.error(
      transient
        ? `[migrate] the database stayed unreachable after ${attempt + 1} attempts`
        : '[migrate] prisma migrate deploy failed; not a connection error, so no retry',
    );
    process.exit(code);
  }
  console.error(`[migrate] could not reach the database; retrying in ${delay / 1000} s (attempt ${attempt + 2} of ${RETRY_DELAYS_MS.length + 1})`);
  await sleep(delay);
}
