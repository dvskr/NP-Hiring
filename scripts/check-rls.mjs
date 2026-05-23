import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY rowsecurity DESC, tablename
`);

const enabled = rows.filter((r) => r.rowsecurity);
const disabled = rows.filter((r) => !r.rowsecurity);

console.log(`✅ RLS ENABLED (${enabled.length}):`);
enabled.forEach((r) => console.log(`    ${r.tablename}`));
console.log(`\n⚠ RLS DISABLED (${disabled.length}):`);
disabled.forEach((r) => console.log(`    ${r.tablename}`));

await client.end();
