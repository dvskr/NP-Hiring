/**
 * B80 — shared config + event recording for the semantic-search A/B test.
 *
 * The experiment definition and the anonymous-tenant cookie used to be
 * private to GET /api/jobs/search/semantic, which meant the impression was
 * the ONLY event the experiment ever recorded — CTR / apply-rate could
 * never be computed, so the A/B loop was unevaluable. This module exports:
 *
 *   - `SEMANTIC_SEARCH_EXPERIMENT` / `SEMANTIC_ANON_COOKIE` — single source
 *     of truth shared by the search route, the click/apply event route
 *     (POST /api/jobs/search/semantic/event), and the apply tracker.
 *   - `recordSemanticSearchEvent(...)` — best-effort click/apply recorder.
 *     It reconstitutes the tenant exactly the way the search route does
 *     (authed user, else the sticky anon cookie), reads the EXISTING
 *     assignment, and appends an ExperimentEvent. It deliberately never
 *     creates assignments: a tenant with no assignment never saw the
 *     experiment, so their event carries no arm signal and is dropped.
 *
 * Route handlers only — uses next/headers cookies() (read-only).
 */

import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import {
    trackExperimentEvent,
    type ExperimentTenant,
} from '@/lib/ai/experiments';

/** Sticky anonymous-tenant cookie — set by GET /api/jobs/search/semantic. */
export const SEMANTIC_ANON_COOKIE = 'pmhnp_exp_anon';

export const SEMANTIC_SEARCH_EXPERIMENT = {
    experiment: 'semantic_search.v1',
    arms: ['control', 'treatment'] as const,
    /** 50% rollout — give the experiment enough volume per arm to detect a CTR delta. */
    rolloutPercent: 50,
};

export type SemanticSearchEventType = 'click' | 'apply';

export interface SemanticEventResult {
    recorded: boolean;
    reason?: 'no_tenant' | 'no_assignment' | 'error';
}

/**
 * Resolve the experiment tenant for the current request: the signed-in user
 * when there is one, otherwise the sticky anon cookie. Never SETS the
 * cookie — a caller without one simply has no tenant (and no assignment).
 */
export async function resolveSemanticExperimentTenant(): Promise<ExperimentTenant | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        return { type: 'candidate', id: user.id };
    }
    const anonId = (await cookies()).get(SEMANTIC_ANON_COOKIE)?.value;
    if (anonId) {
        return { type: 'system', id: `anon:${anonId}` };
    }
    return null;
}

/**
 * Record a click/apply ExperimentEvent for the current request's tenant.
 * Best-effort: returns { recorded: false } instead of throwing, so callers
 * on hot request paths can await it safely.
 */
export async function recordSemanticSearchEvent(
    eventType: SemanticSearchEventType,
    jobId: string,
): Promise<SemanticEventResult> {
    try {
        const tenant = await resolveSemanticExperimentTenant();
        if (!tenant) {
            return { recorded: false, reason: 'no_tenant' };
        }

        // Read-only assignment lookup — do NOT bucket new tenants here.
        const assignment = await prisma.experimentAssignment.findUnique({
            where: {
                experiment_assignment_unique_target: {
                    experiment: SEMANTIC_SEARCH_EXPERIMENT.experiment,
                    tenantType: tenant.type,
                    tenantId: tenant.id,
                },
            },
            select: { arm: true },
        });
        if (!assignment) {
            return { recorded: false, reason: 'no_assignment' };
        }

        await trackExperimentEvent({
            experiment: SEMANTIC_SEARCH_EXPERIMENT.experiment,
            arm: assignment.arm,
            tenant,
            eventType,
            subjectId: jobId,
        });
        return { recorded: true };
    } catch (err) {
        logger.warn('semantic experiment event recording failed — dropping', undefined, err);
        return { recorded: false, reason: 'error' };
    }
}
