/**
 * Whose word a source's listing is.
 *
 * An employer-direct source is the employer's own applicant tracking system,
 * or the government's own board: a posting listed there is one the employer
 * is running right now. A relisting source copies postings from elsewhere and
 * can go on listing one after the employer closed it.
 *
 * Read by the ingest renewal (lib/health/renewal-decision.ts): a live posting
 * from an employer-direct source may take over a stored job whose own posting
 * is gone, and a relisted copy may not.
 *
 * The record is keyed by JobSource, so a new source does not compile until it
 * is classified here.
 */
import type { JobSource } from './types';

export type SourceKind = 'employer-direct' | 'relisting';

export const SOURCE_KIND: Readonly<Record<JobSource, SourceKind>> = {
    adzuna: 'relisting',
    doccafe: 'relisting',
    'fantastic-jobs-db': 'relisting',
    healthcareercenter: 'relisting',
    greenhouse: 'employer-direct',
    lever: 'employer-direct',
    workday: 'employer-direct',
    smartrecruiters: 'employer-direct',
    usajobs: 'employer-direct',
    ashby: 'employer-direct',
    bamboohr: 'employer-direct',
    jazzhr: 'employer-direct',
    workable: 'employer-direct',
};

/**
 * True for a source whose listing is the employer's own. A source this
 * record does not know (a retired one still named on stored rows, or no
 * source at all) is not: the cautious answer.
 */
export function isEmployerDirectSource(source: string | null | undefined): boolean {
    if (!source) return false;
    return (SOURCE_KIND as Readonly<Record<string, SourceKind | undefined>>)[source] === 'employer-direct';
}
