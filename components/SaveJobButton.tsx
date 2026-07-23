'use client';

import { useState, useEffect } from 'react';
import { trackJobSave, trackJobUnsave, buildJobItem } from '@/lib/analytics';
// B82: go through the shared useSavedJobs hook (same as JobCard) instead of
// writing localStorage directly. The hook is auth-aware — for signed-in users
// it POSTs/DELETEs /api/saved-jobs so the detail-page save survives across
// devices and shows up on the server-backed /saved page; for anonymous users
// it stays localStorage-only. It also broadcasts changes, so a save here
// immediately updates every JobCard bookmark on the page.
import useSavedJobs from '@/lib/hooks/useSavedJobs';

interface SaveJobButtonProps {
  jobId: string;
}

export default function SaveJobButton({ jobId }: SaveJobButtonProps) {
  const { isSaved: isJobSaved, saveJob, removeJob } = useSavedJobs();
  // Mount guard: SSR markup renders "unsaved" (no localStorage on the server),
  // so the first client paint must match it to avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isSaved = mounted && isJobSaved(jobId);

  const toggleSave = () => {
    if (isSaved) {
      removeJob(jobId);
      trackJobUnsave(buildJobItem({ id: jobId, title: '' }));
    } else {
      saveJob(jobId);
      trackJobSave(buildJobItem({ id: jobId, title: '' }));
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
