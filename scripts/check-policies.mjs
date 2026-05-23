import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(`
    SELECT tablename, policyname, cmd, roles
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
`);

console.log(`Total policies: ${rows.length}\n`);
const byTable = {};
for (const r of rows) {
    if (!byTable[r.tablename]) byTable[r.tablename] = [];
    const roles = Array.isArray(r.roles) ? r.roles.join(',') : String(r.roles);
    byTable[r.tablename].push(`${r.policyname} (${r.cmd}) → ${roles}`);
}

for (const [t, policies] of Object.entries(byTable)) {
    console.log(`${t}:`);
    policies.forEach((p) => console.log(`    ${p}`));
}

console.log(`\nTables WITH RLS but NO policy (deny-all for anon, deny-all for authenticated):`);
const { rows: rls } = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND rowsecurity = true
      AND tablename NOT IN (SELECT DISTINCT tablename FROM pg_policies WHERE schemaname='public')
    ORDER BY tablename
`);
rls.forEach((r) => console.log(`    ${r.tablename}`));

await client.end();
