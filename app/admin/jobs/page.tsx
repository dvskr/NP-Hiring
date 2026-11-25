'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatCT } from '@/lib/format-ct';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { adminFetch, type AdminFetchResult } from '@/lib/admin/admin-fetch';
import AdminLoadError from '../_components/AdminLoadError';
import { describeBulkResult } from './bulk-result';
import {
  Search, ChevronLeft, ChevronRight, Eye, MousePointerClick,
  FileCheck, Trash2, Star, StarOff, Globe, GlobeLock,
  RefreshCw, X, Pencil,
} from 'lucide-react';

/* ─── Types ─── */
interface AdminJob {
  id: string; title: string; slug: string | null; employer: string;
  location: string; city: string | null; state: string | null;
  jobType: string | null; mode: string | null;
  displaySalary: string | null; sourceProvider: string | null;
  isPublished: boolean; isFeatured: boolean; isVerifiedEmployer: boolean;
  viewCount: number; applyClickCount: number; applications: number;
  qualityScore: number; createdAt: string; updatedAt: string;
  expiresAt: string | null; applyLink: string;
}
interface SourceOption { source: string; count: number }

interface JobsPayload { jobs?: AdminJob[]; total?: number; totalPages?: number; sources?: SourceOption[] }

/** The filters a list read is for. */
interface JobListQuery {
  page: number; search: string; sourceFilter: string;
  publishedFilter: string; featuredFilter: string; sortBy: string;
}

/** One string per set of filters, so the page can tell which list an answer belongs to. */
function listKeyOf(query: JobListQuery): string {
  return JSON.stringify([query.page, query.search, query.sourceFilter, query.publishedFilter, query.featuredFilter, query.sortBy]);
}

/** The list read for one set of filters. It sets no state: the page applies its answer (applyJobs). */
function requestJobs(query: JobListQuery): Promise<AdminFetchResult<JobsPayload>> {
  const params = new URLSearchParams();
  params.set('page', query.page.toString());
  params.set('limit', '25');
  params.set('sort', query.sortBy);
  if (query.search) params.set('search', query.search);
  if (query.sourceFilter !== 'all') params.set('source', query.sourceFilter);
  if (query.publishedFilter) params.set('published', query.publishedFilter);
  if (query.featuredFilter) params.set('featured', query.featuredFilter);
  return adminFetch<JobsPayload>(`/api/admin/jobs?${params.toString()}`);
}

/* ─── Shared styles ─── */
const s = {
  card: {
    backgroundColor: '#FAFBF9', border: '1px solid rgba(255,255,255,0.7)', borderRadius: '18px', boxShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.02)', overflow: 'hidden' as const,
  },
  heading: { color: '#1A2E35', fontWeight: 700 as const },
  sub: { color: '#6B7F8A', fontSize: '14px' },
  muted: { color: '#94A3B8', fontSize: '12px' },
  th: {
    padding: '12px 14px', textAlign: 'left' as const, fontSize: '11px',
    fontWeight: 600 as const, textTransform: 'uppercase' as const,
    letterSpacing: '0.05em', color: '#94A3B8',
    backgroundColor: '#F8FAF9', whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '12px 14px', fontSize: '13px', color: '#6B7F8A',
    borderBottom: '1px solid #E8ECF0', whiteSpace: 'nowrap' as const,
  },
  tdBold: {
    padding: '12px 14px', fontSize: '13px', color: '#1A2E35',
    fontWeight: 600 as const, borderBottom: '1px solid #E8ECF0',
  },
};

const inputStyle: React.CSSProperties = {
  padding: '9px 14px', borderRadius: '10px', fontSize: '13px',
  backgroundColor: '#F8FAF9', border: '1px solid rgba(255,255,255,0.5)',
  color: '#1A2E35', outline: 'none',
};

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sources, setSources] = useState<SourceOption[]>([]);

  // Filters
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [publishedFilter, setPublishedFilter] = useState('');
  const [featuredFilter, setFeaturedFilter] = useState('');
  const [sortBy, setSortBy] = useState('newest');

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Edit modal
  const [editingJob, setEditingJob] = useState<AdminJob | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Action feedback
  const [actionMsg, setActionMsg] = useState<{ text: string; isError: boolean } | null>(null);
  // A failed list load, kept until a load succeeds (actionMsg clears itself).
  const [loadError, setLoadError] = useState<string | null>(null);

  // The list asked for by the filters on screen, and the last list that answered. The list
  // is loading while they differ. Only an answer sets state, never the effect itself, and an
  // effect's read that answers after its filters changed is dropped.
  const listKey = listKeyOf({ page, search, sourceFilter, publishedFilter, featuredFilter, sortBy });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== listKey;

  const applyJobs = (result: AdminFetchResult<JobsPayload>, key: string) => {
    if (result.ok) {
      setJobs(result.data.jobs ?? []);
      setTotal(result.data.total ?? 0);
      setTotalPages(result.data.totalPages ?? 1);
      if (result.data.sources) setSources(result.data.sources);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
    setLoadedKey(key);
  };

  useEffect(() => {
    let current = true;
    const query = { page, search, sourceFilter, publishedFilter, featuredFilter, sortBy };
    void requestJobs(query).then((result) => { if (current) applyJobs(result, listKeyOf(query)); });
    return () => { current = false; };
  }, [page, search, sourceFilter, publishedFilter, featuredFilter, sortBy]);

  // Reads the list on screen again (after an action, or a retry).
  const refreshJobs = () => {
    const query = { page, search, sourceFilter, publishedFilter, featuredFilter, sortBy };
    void requestJobs(query).then((result) => applyJobs(result, listKeyOf(query)));
  };

  // Debounced search
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timeout = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  // Toggle helpers
  const toggleField = async (jobId: string, field: string, value: boolean) => {
    const result = await adminFetch(`/api/admin/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    if (!result.ok) {
      showMsg(`Could not update the job. ${result.error}`, true);
      return;
    }
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, [field]: value } : j));
    showMsg(`${field === 'isPublished' ? (value ? 'Published' : 'Unpublished') : (value ? 'Featured' : 'Unfeatured')}`, false);
  };

  const deleteJob = async (jobId: string, hard = false) => {
    if (!confirm(hard ? 'Permanently delete this job? This cannot be undone.' : 'Unpublish this job?')) return;
    const result = await adminFetch(`/api/admin/jobs/${jobId}?hard=${hard}`, { method: 'DELETE' });
    if (!result.ok) {
      showMsg(`Could not ${hard ? 'delete' : 'unpublish'} the job. ${result.error}`, true);
      return;
    }
    if (hard) setJobs(prev => prev.filter(j => j.id !== jobId));
    else setJobs(prev => prev.map(j => j.id === jobId ? { ...j, isPublished: false } : j));
    showMsg(hard ? 'Job permanently deleted' : 'Job unpublished', false);
  };

  // Bulk actions
  const handleBulk = async (action: string) => {
    if (selected.size === 0) return;
    const label = action === 'hard_delete' ? 'permanently delete' : action;
    if (action.includes('delete') && !confirm(`${label} ${selected.size} job(s)?`)) return;

    setBulkLoading(true);
    const result = await adminFetch<{ action?: string; affected?: number; skippedJobIds?: unknown }>('/api/admin/jobs/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, jobIds: Array.from(selected) }),
    });
    setBulkLoading(false);
    if (!result.ok) {
      showMsg(`Could not apply the bulk action. ${result.error}`, true);
      return;
    }
    // The jobs it left alone (an archived or unpaid post on a publish) are
    // counted, so a partial run never reads as a complete one.
    showMsg(describeBulkResult(result.data.action ?? action, result.data.affected ?? 0, result.data.skippedJobIds), false);
    setSelected(new Set());
    refreshJobs();
  };

  // Edit modal
  const openEdit = (job: AdminJob) => {
    setEditingJob(job);
    setEditError(null);
    setEditForm({
      title: job.title,
      employer: job.employer,
      location: job.location,
      displaySalary: job.displaySalary || '',
      jobType: job.jobType || '',
      mode: job.mode || '',
      applyLink: job.applyLink,
    });
  };

  const closeEdit = useCallback(() => setEditingJob(null), []);
  const editDialogRef = useFocusTrap<HTMLDivElement>({ isOpen: editingJob !== null, onEscape: closeEdit });

  const saveEdit = async () => {
    if (!editingJob || editLoading) return;
    setEditLoading(true);
    setEditError(null);
    const result = await adminFetch(`/api/admin/jobs/${editingJob.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    setEditLoading(false);
    if (!result.ok) {
      // Keep the dialog open with the admin's edits so they can correct and
      // retry; the reason shows inside the dialog, above its buttons.
      setEditError(`Could not save the job. ${result.error}`);
      return;
    }
    showMsg('Job updated', false);
    setEditingJob(null);
    refreshJobs();
  };

  const showMsg = (text: string, isError: boolean) => {
    setActionMsg({ text, isError });
    setTimeout(() => setActionMsg(null), 3000);
  };

  const selectAll = () => {
    if (selected.size === jobs.length) setSelected(new Set());
    else setSelected(new Set(jobs.map(j => j.id)));
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ ...s.heading, fontSize: '26px' }}>Jobs Management</h1>
          <p style={s.muted}>{total.toLocaleString()} total jobs</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={refreshJobs} style={{ ...inputStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Action message */}
      {actionMsg && (
        <div role={actionMsg.isError ? 'alert' : 'status'} style={{
          marginBottom: '16px', padding: '12px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
          backgroundColor: actionMsg.isError ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
          color: actionMsg.isError ? '#F87171' : '#22C55E',
        }}>{actionMsg.text}</div>
      )}

      {loadError && (
        <AdminLoadError subject="The jobs list" message={loadError} onRetry={refreshJobs} />
      )}

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input
            type="text"
            placeholder="Search title or employer..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{ ...inputStyle, width: '100%', paddingLeft: '36px' }}
          />
        </div>
        <select value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="all">All Sources</option>
          {sources.map(s => (
            <option key={s.source} value={s.source}>{s.source} ({s.count})</option>
          ))}
        </select>
        <select value={publishedFilter} onChange={e => { setPublishedFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">All Statuses</option>
          <option value="true">Published</option>
          <option value="false">Unpublished</option>
        </select>
        <select value={featuredFilter} onChange={e => { setFeaturedFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">All Featured</option>
          <option value="true">Featured</option>
          <option value="false">Not Featured</option>
        </select>
        <select value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1); }} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="views">Most Views</option>
          <option value="clicks">Most Clicks</option>
          <option value="title">Title A to Z</option>
        </select>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px',
          padding: '12px 18px', borderRadius: '10px',
          backgroundColor: 'rgba(244,114,182, 0.08)', border: '1px solid rgba(244,114,182, 0.2)',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D' }}>{selected.size} selected</span>
          {[
            { label: 'Publish', action: 'publish', color: '#22C55E' },
            { label: 'Unpublish', action: 'unpublish', color: '#F59E0B' },
            { label: 'Feature', action: 'feature', color: '#A855F7' },
            { label: 'Unfeature', action: 'unfeature', color: '#94A3B8' },
            { label: 'Delete', action: 'delete', color: '#EF4444' },
          ].map(b => (
            <button key={b.action} onClick={() => handleBulk(b.action)} disabled={bulkLoading}
              style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, backgroundColor: `${b.color}15`, color: b.color }}>
              {b.label}
            </button>
          ))}
          <button onClick={() => setSelected(new Set())} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Jobs Table */}
      <div style={s.card}>
        {loading && jobs.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, border: '3px solid #E8ECF0', borderTop: '3px solid #BE185D', borderRadius: '50%', margin: '0 auto', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ ...s.sub, marginTop: '12px' }}>Loading jobs…</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...s.th, width: '36px' }}>
                    <input type="checkbox" checked={selected.size === jobs.length && jobs.length > 0} onChange={selectAll} style={{ cursor: 'pointer' }} />
                  </th>
                  <th style={{ ...s.th, width: '40%' }}>Title</th>
                  <th style={{ ...s.th, width: '20%' }}>Employer</th>
                  <th style={{ ...s.th, width: '110px' }}>Source</th>
                  <th style={{ ...s.th, textAlign: 'center', width: '70px' }}>Status</th>
                  <th style={{ ...s.th, textAlign: 'center', width: '80px' }}>Featured</th>
                  <th style={{ ...s.th, textAlign: 'right', width: '60px' }}><Eye size={13} /></th>
                  <th style={{ ...s.th, textAlign: 'right', width: '60px' }}><MousePointerClick size={13} /></th>
                  <th style={{ ...s.th, textAlign: 'right', width: '60px' }}><FileCheck size={13} /></th>
                  <th style={{ ...s.th, width: '110px' }}>Created</th>
                  <th style={{ ...s.th, textAlign: 'center', width: '90px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr key={job.id} style={{ backgroundColor: selected.has(job.id) ? 'rgba(244,114,182,0.04)' : undefined }}>
                    <td style={s.td}>
                      <input type="checkbox" checked={selected.has(job.id)} onChange={() => toggleSelect(job.id)} style={{ cursor: 'pointer' }} />
                    </td>
                    <td style={{ ...s.tdBold, maxWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job.title}>
                      {job.title}
                    </td>
                    <td style={{ ...s.td, maxWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job.employer}>
                      {job.employer}
                    </td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                      <span style={{ textTransform: 'capitalize' }}>{job.sourceProvider || 'None'}</span>
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      <button onClick={() => toggleField(job.id, 'isPublished', !job.isPublished)}
                        title={job.isPublished ? 'Click to unpublish' : 'Click to publish'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                        {job.isPublished
                          ? <Globe size={16} style={{ color: '#22C55E' }} />
                          : <GlobeLock size={16} style={{ color: '#94A3B8' }} />}
                      </button>
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      <button onClick={() => toggleField(job.id, 'isFeatured', !job.isFeatured)}
                        title={job.isFeatured ? 'Click to unfeature' : 'Click to feature'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                        {job.isFeatured
                          ? <Star size={16} style={{ color: '#F59E0B', fill: '#F59E0B' }} />
                          : <StarOff size={16} style={{ color: '#94A3B8' }} />}
                      </button>
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{job.viewCount.toLocaleString()}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{job.applyClickCount.toLocaleString()}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{job.applications}</td>
                    <td style={s.td}>
                      {formatCT(job.createdAt, 'date')}
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                        <button onClick={() => openEdit(job)} title="Edit"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#3B82F6' }}>
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => deleteJob(job.id)} title="Unpublish"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#EF4444' }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {jobs.length === 0 && (
                  <tr><td colSpan={11} style={{ ...s.td, textAlign: 'center', padding: '40px' }}>No jobs found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px', borderTop: '1px solid #E8ECF0',
          }}>
            <span style={s.muted}>Page {page} of {totalPages} · {total.toLocaleString()} jobs</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ ...inputStyle, cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ChevronLeft size={14} /> Prev
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                style={{ ...inputStyle, cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingJob && (
        <>
          <div onClick={closeEdit} aria-hidden="true" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50 }} />
          <div
            ref={editDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-job-dialog-title"
            tabIndex={-1}
            style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 51, width: '90%', maxWidth: '600px', maxHeight: '85vh', overflowY: 'auto',
            backgroundColor: '#FAFBF9', borderRadius: '16px', boxShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.02)',
            border: '1px solid rgba(255,255,255,0.5)', padding: '28px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 id="edit-job-dialog-title" style={{ ...s.heading, fontSize: '20px' }}>Edit Job</h2>
              <button onClick={closeEdit} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {[
                { key: 'title', label: 'Title' },
                { key: 'employer', label: 'Employer' },
                { key: 'location', label: 'Location' },
                { key: 'displaySalary', label: 'Salary Display' },
                { key: 'jobType', label: 'Job Type' },
                { key: 'mode', label: 'Mode (remote/onsite/hybrid)' },
                { key: 'applyLink', label: 'Apply Link' },
              ].map(f => (
                <div key={f.key}>
                  <label htmlFor={`edit-job-${f.key}`} style={{ display: 'block', ...s.muted, fontWeight: 600, marginBottom: '6px' }}>{f.label}</label>
                  <input
                    id={`edit-job-${f.key}`}
                    type="text"
                    value={editForm[f.key] || ''}
                    onChange={e => setEditForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    style={{ ...inputStyle, width: '100%' }}
                  />
                </div>
              ))}
            </div>

            {editError && (
              <p role="alert" style={{ marginTop: '16px', padding: '10px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, backgroundColor: 'rgba(239,68,68,0.1)', color: '#B91C1C' }}>
                {editError}
              </p>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
              <button onClick={closeEdit}
                style={{ padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', backgroundColor: '#F8FAF9', border: '1px solid rgba(255,255,255,0.5)', color: '#1A2E35', fontWeight: 600, fontSize: '13px' }}>
                Cancel
              </button>
              <button onClick={saveEdit} disabled={editLoading}
                style={{ padding: '10px 24px', borderRadius: '10px', cursor: 'pointer', backgroundColor: '#BE185D', color: '#0F172A', border: 'none', fontWeight: 700, fontSize: '13px', opacity: editLoading ? 0.5 : 1 }}>
                {editLoading ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
