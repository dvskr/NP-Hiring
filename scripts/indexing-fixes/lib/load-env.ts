/**
 * Loads the database connection BEFORE Prisma starts. Every script in
 * scripts/indexing-fixes/ imports this module first.
 *
 * The repo's .env points at the PRODUCTION database (there is no dev
 * database). That is why every script here is a read-only dry run unless
 * --apply is passed. Pass --env-file=<path> to read another file.
 */
import { config } from 'dotenv';

export const ENV_FILE: string =
  process.argv.find((a) => a.startsWith('--env-file='))?.slice('--env-file='.length) || '.env';

config({ path: ENV_FILE });

if (!process.env.DATABASE_URL) {
  console.error(`DATABASE_URL is not set after loading ${ENV_FILE}. Nothing was read or written.`);
  process.exit(1);
}
