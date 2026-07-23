-- B104: jobs.expires_at gates every listing, sitemap, expiry-warning, and
-- cleanup query, but no index covered it. The cleanup-expired cron's comment
-- claimed an (isPublished, expiresAt) index that never existed — this
-- migration makes it real. Composite (is_published, expires_at) serves both
-- the "published AND expired" cleanup scan and the "published AND not yet
-- expired" listing/sitemap filters (equality on the leading column + range
-- on the second).
CREATE INDEX IF NOT EXISTS "jobs_is_published_expires_at_idx"
    ON "jobs"("is_published", "expires_at");
