/**
 * Intersect an optional ?jobId= filter with the caller's owned job ids.
 *
 * Returns the job ids the applicants query may read, or null when the
 * requested job is not one the caller owns (the route answers 404). An absent
 * or blank filter means "all owned jobs". Fails closed: the result is always a
 * subset of ownedJobIds.
 */
export function scopeJobIdsToOwned(
    ownedJobIds: readonly string[],
    jobIdFilter: string | null | undefined,
): string[] | null {
    const requested = typeof jobIdFilter === 'string' ? jobIdFilter.trim() : '';
    if (!requested) return [...ownedJobIds];
    return ownedJobIds.includes(requested) ? [requested] : null;
}
