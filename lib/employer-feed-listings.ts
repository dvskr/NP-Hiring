import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { insensitiveIn } from '@/lib/insensitive-in';
import { normalizeCompanyName } from '@/lib/company-normalizer';

type Db = typeof prisma;

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Where clause for the free feed listings that may belong to employers using
 * these names: filed by the ingest under the company those names resolve to,
 * or carrying one of the names exactly. Null when there is nothing to match.
 *
 * A superset on purpose. The ingest's company key (normalizeCompanyName) drops
 * words like "health", "group" and "associates", so one company row can hold
 * several practices; it only widens the fetch. Callers keep the rows whose
 * employerOrgKey (lib/paid-post-twins.ts) matches, which is the identity that
 * decides.
 *
 * Names must be passed as typed: normalizeCompanyName splits CamelCase before
 * it lowercases ("AcmeMind" files under acme-mind), so a lowercased name
 * resolves to no company at all.
 */
export async function feedListingsWhere(
  names: readonly string[],
  db: Db = prisma,
): Promise<Prisma.JobWhereInput | null> {
  const trimmed = unique(names.map((name) => name.trim()));
  if (trimmed.length === 0) return null;

  // Company keys are stored kebab-case; rows from before that change still
  // carry the space form.
  const keys = unique(trimmed.map((name) => normalizeCompanyName(name)));
  const companies = keys.length === 0 ? [] : await db.company.findMany({
    where: { normalizedName: { in: unique([...keys, ...keys.map((key) => key.replace(/-/g, ' '))]) } },
    select: { id: true },
  });
  const companyIds = companies.map((company) => company.id);

  return {
    employerJobs: { is: null },
    OR: [
      ...(companyIds.length > 0 ? [{ companyId: { in: companyIds } }] : []),
      { employer: insensitiveIn(trimmed) },
    ],
  };
}
