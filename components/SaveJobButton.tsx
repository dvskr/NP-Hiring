'use client';

import { useState, useEffect } from 'react';
import { trackJobSave, trackJobUnsave } from '@/lib/analytics';
import { buildTrackedJobItem, type TrackedJob } from '@/components/analytics/ViewTrackers';
// B82: go through the shared useSavedJobs hook (same as JobCard) instead of
// writing localStorage directly. The hook is auth-aware — for signed-in users
// it POSTs/DELETEs /api/saved-jobs so the detail-page save survives across
// devices and shows up on the server-backed /saved page; for anonymous users
// it stays localStorage-only. It also broadcasts changes, so a save here
// immediately updates every JobCard bookmark on the page.
import useSavedJobs from '@/lib/hooks/useSavedJobs';

interface SaveJobButtonProps {
  jobId: string;
  /**
   * Analytics-only job dimensions for the add_to_wishlist item. The job
   * detail page forwards every one of them from the same row its view_item
   * reports, so a save lines up with the view in GA4. They stay optional so
   * a caller holding less than a full row reports the missing dimensions as
   * absent instead of inventing a stand-in, and
   * tests/regressions/ga-conversion-coverage.test.ts fails if a detail page
   * render site drops one. Nothing here affects what the button renders.
   *
   * There is deliberately no salary prop. trackJobSave sends the item's
   * price as the event's monetary `value`, so forwarding a $120,000 listing
   * would book a $120,000 conversion for a bookmark, which is the number
   * Google Ads would optimise against. Salary belongs on the impression and
   * detail-view items, where it is an item attribute and not a value.
   */
  jobTitle?: string;
  employer?: string | null;
  jobType?: string | null;
  stateCode?: string | null;
  sourceProvider?: string | null;
}

export default function SaveJobButton({
  jobId,
  jobTitle,
  employer = null,
  jobType = null,
  stateCode = null,
  sourceProvider = null,
}: SaveJobButtonProps) {
  const { isSaved: isJobSaved, saveJob, removeJob } = useSavedJobs();
  // Mount guard: SSR markup renders "unsaved" (no localStorage on the server),
  // so the first client paint must match it to avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Deferred a tick: the saved-state read is stable for the life of the
    // page load, so resolving one macrotask after mount avoids a cascading
    // synchronous re-render while keeping the SSR/first-render markup
    // ("unsaved") hydration-safe.
    const arm = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(arm);
  }, []);
  const isSaved = mounted && isJobSaved(jobId);

  // `title` is passed through undefined when the caller did not supply one,
  // and buildTrackedJobItem then drops item_name rather than sending the
  // empty string this button used to send. GA4 keys the item on item_id, so
  // a save from a caller without a title still joins the same job's
  // view_item; only its label reads "(not set)".
  const trackedJob: TrackedJob = {
    id: jobId,
    title: jobTitle,
    employer,
    jobType,
    stateCode,
    sourceProvider,
  };

  const toggleSave = () => {
    if (isSaved) {
      removeJob(jobId);
      trackJobUnsave(buildTrackedJobItem(trackedJob));
    } else {
      saveJob(jobId);
      trackJobSave(buildTrackedJobItem(trackedJob));
    }
  };

  return (
    <button
      onClick={toggleSave}
      aria-label={isSaved ? 'Remove saved job' : 'Save job'}
      aria-pressed={isSaved}
      data-icon-btn
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        padding: '10px 18px',
        borderRadius: '16px',
        fontSize: '14px', fontWeight: 600,
        backgroundColor: isSaved ? '#FBCFE8' : '#EDF2EE',
        color: isSaved ? '#9D174D' : '#374151',
        border: '1px solid rgba(255,255,255,0.5)',
        boxShadow: isSaved
          ? '5px 5px 12px rgba(190,24,93,0.18), -3px -3px 8px rgba(255,255,255,0.8), inset 2px 2px 4px rgba(255,255,255,0.5), inset -1px -1px 2px rgba(0,0,0,0.04)'
          : '5px 5px 12px rgba(0,0,0,0.08), -3px -3px 8px rgba(255,255,255,0.9), inset 2px 2px 4px rgba(255,255,255,0.6), inset -1px -1px 2px rgba(0,0,0,0.03)',
        cursor: 'pointer', transition: 'all 0.2s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '7px 7px 16px rgba(0,0,0,0.10), -4px -4px 10px rgba(255,255,255,0.9), inset 2px 2px 5px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.03)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = isSaved
          ? '5px 5px 12px rgba(190,24,93,0.18), -3px -3px 8px rgba(255,255,255,0.8), inset 2px 2px 4px rgba(255,255,255,0.5), inset -1px -1px 2px rgba(0,0,0,0.04)'
          : '5px 5px 12px rgba(0,0,0,0.08), -3px -3px 8px rgba(255,255,255,0.9), inset 2px 2px 4px rgba(255,255,255,0.6), inset -1px -1px 2px rgba(0,0,0,0.03)';
      }}
    >
      {/* Clay icon pebble */}
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, borderRadius: 10,
        backgroundColor: isSaved ? '#FCE7F3' : '#DDE8DF',
        boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.04), 2px 2px 4px rgba(0,0,0,0.06)',
        border: '1px solid rgba(255,255,255,0.6)',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill={isSaved ? '#9D174D' : 'none'} stroke={isSaved ? '#9D174D' : 'currentColor'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
        </svg>
      </span>
      {isSaved ? 'Saved' : 'Save'}
    </button>
  );
}
