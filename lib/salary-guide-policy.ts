/**
 * lib/salary-guide-policy.ts: the employer-share cap constant on its own
 * (indexing audit CQ-15).
 *
 * This module has NO imports on purpose. lib/salary-guide-gate.ts applies
 * the cap, and it reaches lib/company-normalizer.ts, which imports the
 * Prisma client. Copy that only needs to STATE the rule (a client
 * component such as components/tools/EmployerBenchmarkPicker.tsx, or a pure
 * builder such as lib/pseo/listing-narrative.ts) imports the number from
 * here, so the rule's wording and its enforcement share one value without
 * pulling the database client into a browser bundle or a pure module.
 */

/**
 * The largest share of a published median's postings one employer may
 * contribute, in whole percent. The audit asked for 40 to 50%; 40 keeps a
 * clear margin under the point (more than half) where the median becomes
 * one employer's own figure. Integer percent so the gate's comparison is
 * exact integer arithmetic, with no floating-point edge at the boundary.
 */
export const MAX_EMPLOYER_SHARE_PERCENT = 40;
