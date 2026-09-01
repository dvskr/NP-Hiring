import { Client } from 'pg';

const which = process.argv[2] === 'direct' ? 'DIRECT_URL' : 'DATABASE_URL';
const connectionString = process.env[which];
if (!connectionString) {
  console.error(`${which} not set`);
  process.exit(1);
}

const client = new Client({ connectionString, connectionTimeoutMillis: 15000 });
const t = Date.now();
client
  .connect()
  .then(() => client.query('SELECT 1'))
  .then(() => {
    console.log(`${which} OK in`, Date.now() - t, 'ms');
    return client.end();
  })
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(`${which} FAIL:`, e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
