import type { FilterCounts } from '@/types/filters';
import type { RecruitmentTypeParam } from '@/lib/filters';

/**
 * Whether the /jobs sidebar shows the Employer Type facet.
 *
 * Employer type is a human classification (Company.recruitmentType, set in
 * /admin/companies), so until companies are classified both options match
 * nothing: on 2026-11-19 none of the 6,150 live jobs had a classified
 * employer. The facet shows when a job in the current view has one, and
 * while it is active so it can be cleared. It stays hidden until counts
 * arrive, so it never renders empty first, and when a response carries no
 * employer-type counts.
 */
export function showsEmployerTypeFacet(
  counts: Partial<Pick<FilterCounts, 'recruitmentType'>> | null,
  active: RecruitmentTypeParam | null | undefined,
): boolean {
  if (active) return true;
  const buckets = counts?.recruitmentType;
  if (!buckets) return false;
  return buckets.direct_hire + buckets.staffing_agency > 0;
}
