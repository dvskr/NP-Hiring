-- B110: table-growth maintenance for the partitioned job_health_checks.
-- The 20260429 partition migration pre-created monthly partitions only
-- through 2027-05; after that every insert would land in the default
-- catch-all partition, silently defeating the partitioning strategy
-- (retention drops become impossible without repartitioning the default).
--
-- This migration extends coverage through 2028-06. Ongoing coverage is
-- maintained by the daily purge-soft-deleted cron, which idempotently
-- creates partitions for the next 12 months (see
-- app/api/cron/purge-soft-deleted/route.ts, ensureJobHealthCheckPartitions).
CREATE TABLE IF NOT EXISTS "job_health_checks_2027_06" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE IF NOT EXISTS "job_health_checks_2027_07" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE IF NOT EXISTS "job_health_checks_2027_08" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE IF NOT EXISTS "job_health_checks_2027_09" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE IF NOT EXISTS "job_health_checks_2027_10" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE IF NOT EXISTS "job_health_checks_2027_11" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE IF NOT EXISTS "job_health_checks_2027_12" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');
CREATE TABLE IF NOT EXISTS "job_health_checks_2028_01" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2028-01-01') TO ('2028-02-01');
CREATE TABLE IF NOT EXISTS "job_health_checks_2028_02" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2028-02-01') TO ('2028-03-01');
CREATE TABLE IF NOT EXISTS "job_health_checks_2028_03" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2028-03-01') TO ('2028-04-01');
CREATE TABLE IF NOT EXISTS "job_health_checks_2028_04" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2028-04-01') TO ('2028-05-01');
CREATE TABLE IF NOT EXISTS "job_health_checks_2028_05" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2028-05-01') TO ('2028-06-01');
CREATE TABLE IF NOT EXISTS "job_health_checks_2028_06" PARTITION OF "job_health_checks"
    FOR VALUES FROM ('2028-06-01') TO ('2028-07-01');
