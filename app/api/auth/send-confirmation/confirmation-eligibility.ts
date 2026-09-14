import { prisma } from '@/lib/prisma'

/** RFC 5321 caps a forward-path at 254 characters. */
const MAX_EMAIL_LENGTH = 254

/**
 * Deliberately conservative shape check: one "@", no whitespace, a dotted
 * domain. Anything that fails it can never receive a confirmation link, so
 * the route answers 400 instead of letting Supabase reject it with a 500.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export function isValidEmailAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_EMAIL_LENGTH && EMAIL_SHAPE.test(trimmed)
}

export type ConfirmationEligibility = 'unconfirmed' | 'confirmed' | 'unknown'

interface AuthUserRow {
  confirmed: boolean
}

/**
 * Looks the address up in Supabase Auth (auth.users) WITHOUT creating
 * anything. Only an existing, not yet confirmed account is eligible for a
 * resend: admin.generateLink({ type: 'magiclink' }) auto-creates an auth
 * user for an unknown address, and for a confirmed account it would mint
 * a one-click sign-in link, so neither case may reach it.
 *
 * Throws on a database failure; the caller must fail closed.
 */
export async function getConfirmationEligibility(normalizedEmail: string): Promise<ConfirmationEligibility> {
  const rows = await prisma.$queryRaw<AuthUserRow[]>`
    SELECT (email_confirmed_at IS NOT NULL) AS confirmed
    FROM auth.users
    WHERE lower(email) = ${normalizedEmail}
      AND deleted_at IS NULL
    LIMIT 1
  `
  if (!rows || rows.length === 0) return 'unknown'
  return rows[0].confirmed ? 'confirmed' : 'unconfirmed'
}
