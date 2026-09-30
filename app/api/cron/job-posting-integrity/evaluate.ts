/**
 * app/api/cron/job-posting-integrity/evaluate.ts: the daily check over every
 * live, sitemap-eligible job (indexing audit GFJ-01, GFJ-04, CS-03). Pure:
 * the route loads the rows and posts the alert.
 *
 * WHAT FAILS THE CHECK (each one posts a Discord alert):
 *   - a stub description (GFJ-04): the page answers noindex and emits no
 *     JobPosting, but the row is still published and in the job sitemap, so
 *     it needs scripts/indexing-fixes/hold-stub-description-jobs.ts;
 *   - a work-mode invariant violation (GFJ-01): isRemote and isHybrid both
 *     true, a flag that disagrees with the stored mode, or a remote flag with
 *     no remote wording anywhere (the on-site jobs /jobs/remote listed);
 *   - work-mode drift that changes a flag: the row's flags are not what the
 *     ingest rules derive (the assert-only --check of
 *     scripts/backfill-remote-flags.ts, wired here so drift is not silent);
 *   - rows with no JobPosting location (CS-03 metric: no jobLocation and no
 *     verified remote declaration) above MISSING_LOCATION_ALERT_SHARE of the
 *     live jobs. The count is always reported so it can be watched.
 * Mode-only drift (the flags already agree) is reported, not failed.
 */
import { planWorkModeRepair, workModeViolations, type WorkModeRow, type WorkModeViolation } from '@/lib/work-mode-integrity';
import { hasJobPostingLocation, isStubJobDescription, type JobPostingFactsInput } from '@/app/jobs/[slug]/job-posting-facts';

/** The row the check reads: the work-mode columns plus the location columns the page reads. */
export interface IntegrityRow extends WorkModeRow {
  readonly slug: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly stateCode: string | null;
  readonly country: string | null;
}

/**
 * Share of live jobs allowed to emit no JobPosting location before the check
 * fails. The audit found 6.6 percent before ingest resolved titles, labelled
 * lines and Workday sites; above 5 percent something upstream regressed.
 */
export const MISSING_LOCATION_ALERT_SHARE = 0.05;

/** Examples carried per finding in the alert. */
export const EXAMPLES_PER_FINDING = 5;

export interface FindingExample {
  id: string;
  slug: string | null;
  title: string;
  employer: string;
  detail?: string;
}

export interface Finding {
  count: number;
  examples: FindingExample[];
}

export interface IntegrityReport {
  scanned: number;
  stubDescriptions: Finding;
  missingJobPostingLocation: Finding & { share: number };
  workModeViolations: Record<WorkModeViolation, Finding>;
  /** Rows whose flags differ from the ingest derivation (--check). */
  workModeFlagDrift: Finding;
  /** Of those, rows the derivation says are NOT remote but are flagged remote. */
  falseRemoteDrift: number;
  /** Rows whose mode alone differs (flags already agree): reported only. */
  workModeModeOnlyDrift: number;
  /** Human-readable reasons the check fails; empty when healthy. */
  failures: string[];
}

function emptyFinding(): Finding {
  return { count: 0, examples: [] };
}

function note(finding: Finding, row: IntegrityRow, detail?: string): void {
  finding.count += 1;
  if (finding.examples.length < EXAMPLES_PER_FINDING) {
    finding.examples.push({ id: row.id, slug: row.slug, title: row.title, employer: row.employer, ...(detail ? { detail } : {}) });
  }
}

function factsInput(row: IntegrityRow): JobPostingFactsInput {
  return {
    title: row.title,
    employer: row.employer,
    description: row.description,
    location: row.location,
    mode: row.mode,
    isRemote: row.isRemote,
    isHybrid: row.isHybrid,
    city: row.city,
    state: row.state,
    stateCode: row.stateCode,
    country: row.country,
  };
}

export function evaluateJobPostingIntegrity(rows: readonly IntegrityRow[]): IntegrityReport {
  const report: IntegrityReport = {
    scanned: rows.length,
    stubDescriptions: emptyFinding(),
    missingJobPostingLocation: { ...emptyFinding(), share: 0 },
    workModeViolations: {
      both_flags: emptyFinding(),
      flags_disagree_with_mode: emptyFinding(),
      remote_without_evidence: emptyFinding(),
    },
    workModeFlagDrift: emptyFinding(),
    falseRemoteDrift: 0,
    workModeModeOnlyDrift: 0,
    failures: [],
  };

  for (const row of rows) {
    const facts = factsInput(row);
    if (isStubJobDescription(facts)) note(report.stubDescriptions, row);
    if (!hasJobPostingLocation(facts)) note(report.missingJobPostingLocation, row, row.location ?? '(no location)');
    for (const violation of workModeViolations(row)) {
      note(report.workModeViolations[violation], row, `mode ${row.mode ?? 'null'}, remote ${row.isRemote}, hybrid ${row.isHybrid}`);
    }
    const repair = planWorkModeRepair(row);
    if (repair) {
      const flagsChange = repair.newIsRemote !== repair.oldIsRemote || repair.newIsHybrid !== repair.oldIsHybrid;
      if (flagsChange) {
        note(
          report.workModeFlagDrift,
          row,
          `mode ${repair.oldMode ?? 'null'} to ${repair.newMode ?? 'null'}, remote ${repair.oldIsRemote} to ${repair.newIsRemote}`,
        );
        if (repair.oldIsRemote && !repair.newIsRemote) report.falseRemoteDrift += 1;
      } else {
        report.workModeModeOnlyDrift += 1;
      }
    }
  }

  const missing = report.missingJobPostingLocation;
  missing.share = rows.length > 0 ? missing.count / rows.length : 0;

  if (report.stubDescriptions.count > 0) {
    report.failures.push(
      `${report.stubDescriptions.count} live job(s) have a stub description (noindexed, no JobPosting); run scripts/indexing-fixes/hold-stub-description-jobs.ts`,
    );
  }
  const violations = Object.entries(report.workModeViolations).filter(([, f]) => f.count > 0);
  for (const [kind, finding] of violations) {
    report.failures.push(`${finding.count} live job(s) violate the work-mode invariant (${kind.replace(/_/g, ' ')})`);
  }
  if (report.workModeFlagDrift.count > 0) {
    report.failures.push(
      `${report.workModeFlagDrift.count} live job(s) carry work-mode flags the ingest rules do not derive (${report.falseRemoteDrift} flagged remote without support); review scripts/backfill-remote-flags.ts dry run`,
    );
  }
  if (missing.share > MISSING_LOCATION_ALERT_SHARE) {
    report.failures.push(
      `${missing.count} live job(s) (${(missing.share * 100).toFixed(1)} percent) emit no JobPosting location, above the ${(MISSING_LOCATION_ALERT_SHARE * 100).toFixed(0)} percent alert line`,
    );
  }
  return report;
}

/** The alert text: each failure, then up to EXAMPLES_PER_FINDING example URLs per finding. */
export function formatIntegrityAlert(report: IntegrityReport, baseUrl: string): string {
  const lines = [`Job posting integrity check: ${report.failures.length} problem(s) across ${report.scanned} live job(s).`];
  for (const failure of report.failures) lines.push(`- ${failure}`);
  const sections: Array<[string, Finding]> = [
    ['Stub descriptions', report.stubDescriptions],
    ['Remote flag without remote wording', report.workModeViolations.remote_without_evidence],
    ['Both remote and hybrid', report.workModeViolations.both_flags],
    ['Flags disagree with mode', report.workModeViolations.flags_disagree_with_mode],
    ['Work-mode drift', report.workModeFlagDrift],
    ['No JobPosting location', report.missingJobPostingLocation],
  ];
  for (const [label, finding] of sections) {
    if (finding.count === 0) continue;
    lines.push(`${label}:`);
    for (const ex of finding.examples) {
      const url = ex.slug ? `${baseUrl}/jobs/${ex.slug}` : `id ${ex.id}`;
      lines.push(`  ${url} (${ex.employer})${ex.detail ? `: ${ex.detail}` : ''}`);
    }
  }
  return lines.join('\n').slice(0, 1900);
}
