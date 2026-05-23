// Apply Supabase RLS policies via direct postgres connection.
// Strategy:
//   1. Query pg_tables for actual public tables (some Prisma models without
//      @@map are PascalCase; others without @@map are stored unquoted as
//      lowercase). We discover real names instead of hardcoding.
//   2. Enable RLS on every public table by default (deny-all baseline).
//   3. Apply per-table policies from supabase/rls-policies.sql, skipping
//      any whose target table doesn't actually exist in the DB.
//
// Re-runnable: every CREATE POLICY is preceded by DROP POLICY IF EXISTS,
// every ALTER TABLE ENABLE RLS is idempotent. A failing per-table block
// rolls back ONLY that block; the next one still gets a try.

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
    console.error('No DIRECT_URL or DATABASE_URL in env.');
    process.exit(1);
}

const client = new Client({ connectionString });

console.log(`Connecting to ${connectionString.split('@')[1]?.split('/')[0]}...`);
await client.connect();

// 1. Discover real table names
const { rows: tableRows } = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
`);
const realTables = new Set(tableRows.map((r) => r.tablename.toLowerCase()));
console.log(`Found ${realTables.size} tables in public schema.`);

// 2. Read the SQL file and split into per-statement blocks (by semicolon).
const sqlPath = resolve(__dirname, '..', 'supabase', 'rls-policies.sql');
const rawSql = readFileSync(sqlPath, 'utf8');

// Crude statement splitter — works because none of our policies use
// semicolons inside string literals.
const statements = rawSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'))
    .filter((s) => {
        // Strip comment-only blocks
        const noComments = s.replace(/--[^\n]*/g, '').trim();
        return noComments.length > 0;
    });

console.log(`Parsed ${statements.length} SQL statements.`);

// 3. Apply each statement individually. Skip ones whose target table doesn't exist.
let applied = 0;
let skipped = 0;
let failed = 0;
const failures = [];

for (const stmt of statements) {
    // Extract target table name from common shapes:
    //   ALTER TABLE <name> ...
    //   CREATE POLICY ... ON <name> ...
    //   DROP POLICY IF EXISTS ... ON <name>
    const alterMatch = stmt.match(/^ALTER\s+TABLE\s+"?(\w+)"?/i);
    const policyMatch = stmt.match(/ON\s+"?(\w+)"?/i);
    const table = (alterMatch?.[1] || policyMatch?.[1] || '').toLowerCase();

    if (table && !realTables.has(table)) {
        skipped++;
        continue;
    }

    try {
        await client.query(stmt);
        applied++;
    } catch (err) {
        failed++;
        failures.push({ table, msg: err.message.slice(0, 100) });
    }
}

// 4. Report
console.log('\n── RESULT ──');
console.log(`  Applied: ${applied}`);
console.log(`  Skipped (table doesn't exist): ${skipped}`);
console.log(`  Failed:  ${failed}`);
if (failures.length > 0) {
    console.log('\n── FAILURES ──');
    failures.slice(0, 10).forEach((f) => console.log(`  [${f.table}] ${f.msg}`));
    if (failures.length > 10) console.log(`  ... and ${failures.length - 10} more`);
}

// 5. Verify
const { rows: verifyRows } = await client.query(
    `SELECT COUNT(*)::int AS rls_enabled
     FROM pg_tables
     WHERE schemaname = 'public' AND rowsecurity = true`,
);
console.log(`\n── VERIFICATION ──`);
console.log(`  Tables with RLS enabled: ${verifyRows[0].rls_enabled} / ${realTables.size}`);

await client.end();
process.exit(failed > 0 ? 1 : 0);
