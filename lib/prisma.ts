import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { resolvePoolSizing } from '@/lib/prisma-pool-config'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

if (!globalForPrisma.pool) {
  // IMPORTANT: Use DATABASE_URL (pooled via PgBouncer) for app runtime
  // Only use DIRECT_URL for migrations/scripts that need schema access
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL must be set')
  }

  // Pool sizing is runtime-aware (see lib/prisma-pool-config.ts): the old
  // hard-coded max=2 was right for Vercel serverless (one Pool per function
  // instance, burst headroom comes from PgBouncer) but starved a long-lived
  // `next start` server, where a single Pool serves every request and
  // concurrent /jobs loads 500ed with "timeout exceeded when trying to
  // connect". Override with DATABASE_POOL_MAX / DATABASE_POOL_CONNECT_TIMEOUT_MS.
  const sizing = resolvePoolSizing(process.env)

  console.log(`[Prisma] Initializing connection pool (${sizing.runtime}, max ${sizing.max})...`)

  globalForPrisma.pool = new Pool({
    connectionString,
    max: sizing.max,
    idleTimeoutMillis: sizing.idleTimeoutMillis,
    // Bounds both the TCP connect and the wait for a free pool slot.
    connectionTimeoutMillis: sizing.connectionTimeoutMillis,
    allowExitOnIdle: sizing.allowExitOnIdle,
    // NOTE: statement_timeout is NOT supported by PgBouncer in transaction mode.
  })

  // Handle pool errors gracefully
  globalForPrisma.pool.on('error', (err) => {
    console.error('[Prisma] Unexpected error on idle client:', err)
  })
}

const adapter = new PrismaPg(globalForPrisma.pool)

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

export const prisma = globalForPrisma.prisma
