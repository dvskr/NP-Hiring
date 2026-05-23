// Brute-force: enable RLS on every public table that doesn't have it yet.
// This is the baseline (deny-all for anon, allow all for service_role).
// The per-table SELECT/INSERT policies applied separately layer on top.

import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND rowsecurity = false
      AND tablename != '_prisma_migrations'
`);

console.log(`Enabling RLS on ${rows.length} tables...`);
let success = 0;
let failed = 0;
for (const r of rows) {
    try {
        // Quote the table name to handle PascalCase tables like "PseoStats"
        await client.query(`ALTER TABLE "${r.tablename}" ENABLE ROW LEVEL SECURITY`);
        success++;
    } catch (err) {
        console.log(`  ✗ ${r.tablename}: ${err.message}`);
        failed++;
    }
}
console.log(`\n  ✓ Enabled: ${success}`);
console.log(`  ✗ Failed:  ${failed}`);

const { rows: final } = await client.query(
    `SELECT COUNT(*)::int AS n FROM pg_tables
     WHERE schemaname = 'public' AND rowsecurity = true`,
);
console.log(`\n  Total tables with RLS: ${final[0].n}`);

await client.end();
