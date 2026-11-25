'use client';

import { useState, useEffect } from 'react';
import { formatCT } from '@/lib/format-ct';
import { adminFetch, type AdminFetchResult } from '@/lib/admin/admin-fetch';
import AdminLoadError from '../_components/AdminLoadError';
import { BLOG_CATEGORIES } from '@/lib/blog-categories';
import {
    FileText, Plus, Pencil, Trash2, Eye, Globe, GlobeLock,
    X, ChevronDown, Tag, Calendar,
} from 'lucide-react';

/* ─── Types ─── */
interface BlogPost {
    id: string; title: string; slug: string; category: string;
    status: string; metaDescription: string | null; targetKeyword: string | null;
    imageUrl: string | null; publishDate: string | null;
    createdAt: string; updatedAt: string;
    // Only loaded when editing (the list endpoint selects a lighter row).
    content?: string;
    reviewedAt?: string | null;
    faqJson?: Array<{ name: string; text: string }> | null;
}

// Derive from the public taxonomy so the editor can never drift from the
// categories /blog actually filters and renders (the old local list was
// missing 4 of the 13 public categories, making them unauthorable from the
// admin panel). Imported from lib/blog-categories.ts, NOT lib/blog.ts:
// this is a 'use client' component, and lib/blog.ts's graph pulls in
// @supabase/supabase-js + sanitize-html (its top-level sanitize config
// dereferences sanitizeHtml.defaults, so the sanitizer stays reachable) —
// importing it here shipped that entire server graph to the browser.
const CATEGORIES = BLOG_CATEGORIES.map((c) => ({ value: c.id, label: c.label }));

/* ─── Styles ─── */
const card: React.CSSProperties = { backgroundColor: '#FAFBF9', border: '1px solid rgba(255,255,255,0.7)', borderRadius: '18px', boxShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.02)', overflow: 'hidden' };
const heading: React.CSSProperties = { color: '#1A2E35', fontWeight: 700 };
const sub: React.CSSProperties = { color: '#6B7F8A', fontSize: '14px' };
const muted: React.CSSProperties = { color: '#94A3B8', fontSize: '12px' };
const th: React.CSSProperties = { padding: '12px 16px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8', textAlign: 'left', whiteSpace: 'nowrap', backgroundColor: '#F8FAF9' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: '13px', color: '#6B7F8A', borderBottom: '1px solid #E8ECF0', whiteSpace: 'nowrap' };
const inputStyle: React.CSSProperties = { padding: '10px 14px', borderRadius: '10px', fontSize: '13px', backgroundColor: '#F8FAF9', border: '1px solid rgba(255,255,255,0.5)', color: '#1A2E35', outline: 'none', width: '100%' };

interface PostsPayload { posts?: BlogPost[] }

/** The post list read. It sets no state: the page applies its answer (applyPosts). */
function requestPosts(): Promise<AdminFetchResult<PostsPayload>> {
    return adminFetch<PostsPayload>('/api/admin/blog');
}

export default function AdminBlogPage() {
    const [posts, setPosts] = useState<BlogPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionMsg, setActionMsg] = useState<{ text: string; isError: boolean } | null>(null);
    // A failed list load, kept until a load succeeds (actionMsg clears itself).
    const [loadError, setLoadError] = useState<string | null>(null);
    // Shown inside the editor: the page's own message sits under the modal.
    const [editorError, setEditorError] = useState<string | null>(null);

    // Editor state
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingPost, setEditingPost] = useState<BlogPost | null>(null);
    const [form, setForm] = useState({
        title: '', content: '', category: 'job_seeker_attraction', status: 'draft',
        metaDescription: '', targetKeyword: '', imageUrl: '',
        reviewedAt: '', faqJson: '',
    });
    const [saving, setSaving] = useState(false);

    // Filter
    const [statusFilter, setStatusFilter] = useState('all');
    const [catFilter, setCatFilter] = useState('all');

    // The post list's answer. Only an answer sets state, never the effect itself; the first
    // load starts with the spinner on (useState(true)) and a reload turns it on (reloadPosts).
    const applyPosts = (result: AdminFetchResult<PostsPayload>) => {
        if (result.ok) {
            setPosts(result.data.posts ?? []);
            setLoadError(null);
        } else {
            setLoadError(result.error);
        }
        setLoading(false);
    };

    const reloadPosts = () => {
        setLoading(true);
        void requestPosts().then(applyPosts);
    };

    useEffect(() => {
        let current = true;
        void requestPosts().then((result) => { if (current) applyPosts(result); });
        return () => { current = false; };
    }, []);

    const showMsg = (text: string, isError: boolean) => {
        setActionMsg({ text, isError });
        setTimeout(() => setActionMsg(null), 3000);
    };

    const openNew = () => {
        setEditingPost(null);
        setEditorError(null);
        setForm({ title: '', content: '', category: 'job_seeker_attraction', status: 'draft', metaDescription: '', targetKeyword: '', imageUrl: '', reviewedAt: '', faqJson: '' });
        setEditorOpen(true);
    };

    const openEdit = async (post: BlogPost) => {
        const result = await adminFetch<{ post?: BlogPost }>(`/api/admin/blog/${post.id}`);
        const loaded = result.ok ? result.data.post : undefined;
        if (!loaded) {
            // Never open an empty editor over a failed load: saving from it
            // would write blanks over the real post.
            showMsg(`Could not open the post. ${result.ok ? 'The answer had no post in it.' : result.error}`, true);
            return;
        }
        setEditingPost(loaded);
        setEditorError(null);
        setForm({
            title: loaded.title || '',
            content: loaded.content || '',
            category: loaded.category || 'job_seeker_attraction',
            status: loaded.status || 'draft',
            metaDescription: loaded.metaDescription || '',
            targetKeyword: loaded.targetKeyword || '',
            imageUrl: loaded.imageUrl || '',
            reviewedAt: loaded.reviewedAt ? String(loaded.reviewedAt).slice(0, 10) : '',
            faqJson: loaded.faqJson ? JSON.stringify(loaded.faqJson, null, 2) : '',
        });
        setEditorOpen(true);
    };

    const savePost = async () => {
        if (!form.title || !form.content || !form.category) {
            setEditorError('Title, content, and category are required');
            return;
        }
        // FAQ JSON is authored as text — validate the shape client-side so a
        // typo surfaces immediately instead of silently dropping schema data.
        let faqJson: Array<{ name: string; text: string }> | null = null;
        if (form.faqJson.trim()) {
            try {
                const parsed = JSON.parse(form.faqJson);
                const valid = Array.isArray(parsed) && parsed.every(
                    (q) => q && typeof q.name === 'string' && typeof q.text === 'string',
                );
                if (!valid) {
                    setEditorError('FAQ JSON must be an array of { "name", "text" } objects');
                    return;
                }
                faqJson = parsed;
            } catch {
                setEditorError('FAQ JSON is not valid JSON');
                return;
            }
        }
        setSaving(true);
        setEditorError(null);
        const url = editingPost ? `/api/admin/blog/${editingPost.id}` : '/api/admin/blog';
        const result = await adminFetch(url, {
            method: editingPost ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...form,
                faqJson,
                reviewedAt: form.reviewedAt || null,
            }),
        });
        setSaving(false);
        if (!result.ok) {
            // The editor stays open so the draft is not lost to a failed save.
            setEditorError(`Could not save the post. ${result.error}`);
            return;
        }
        showMsg(editingPost ? 'Post updated' : 'Post created', false);
        setEditorOpen(false);
        reloadPosts();
    };

    const toggleStatus = async (post: BlogPost) => {
        const newStatus = post.status === 'published' ? 'draft' : 'published';
        const result = await adminFetch(`/api/admin/blog/${post.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
        });
        if (!result.ok) {
            // The row keeps its real status: showing the new one over a failed
            // write is how a draft comes to look live.
            showMsg(`Could not change the post status. ${result.error}`, true);
            return;
        }
        setPosts(prev => prev.map(p => p.id === post.id ? { ...p, status: newStatus } : p));
        showMsg(newStatus === 'published' ? 'Published' : 'Unpublished', false);
    };

    const deletePost = async (id: string) => {
        if (!confirm('Delete this blog post permanently?')) return;
        const result = await adminFetch(`/api/admin/blog/${id}`, { method: 'DELETE' });
        if (!result.ok) {
            showMsg(`Could not delete the post. ${result.error}`, true);
            return;
        }
        setPosts(prev => prev.filter(p => p.id !== id));
        showMsg('Post deleted', false);
    };

    const filteredPosts = posts.filter(p => {
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        if (catFilter !== 'all' && p.category !== catFilter) return false;
        return true;
    });

    const catLabel = (cat: string) => CATEGORIES.find(c => c.value === cat)?.label || cat;

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 16px' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <h1 style={{ ...heading, fontSize: 26 }}>Blog Management</h1>
                    <p style={muted}>{posts.length} total posts · {posts.filter(p => p.status === 'published').length} published</p>
                </div>
                <button onClick={openNew} style={{
                    padding: '10px 20px', borderRadius: '10px', cursor: 'pointer',
                    backgroundColor: '#BE185D', color: '#0F172A', border: 'none',
                    fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                    <Plus size={16} /> New Post
                </button>
            </div>

            {actionMsg && (
                <div style={{
                    marginBottom: 16, padding: '12px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    backgroundColor: actionMsg.isError ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                    color: actionMsg.isError ? '#F87171' : '#22C55E',
                }}>{actionMsg.text}</div>
            )}

            {loadError && (
                <AdminLoadError subject="The post list" message={loadError} onRetry={reloadPosts} />
            )}

            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                    <option value="all">All Statuses</option>
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                </select>
                <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                    <option value="all">All Categories</option>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
            </div>

            {/* Posts Table */}
            <div style={card}>
                {loading ? (
                    <div style={{ padding: 60, textAlign: 'center' }}>
                        <div style={{ width: 40, height: 40, border: '3px solid #E8ECF0', borderTop: '3px solid #BE185D', borderRadius: '50%', margin: '0 auto', animation: 'spin 0.8s linear infinite' }} />
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr>
                                <th style={th}>Title</th>
                                <th style={th}>Category</th>
                                <th style={{ ...th, textAlign: 'center' }}>Status</th>
                                <th style={th}>Keyword</th>
                                <th style={th}>Published</th>
                                <th style={th}>Created</th>
                                <th style={{ ...th, textAlign: 'center' }}>Actions</th>
                            </tr></thead>
                            <tbody>
                                {filteredPosts.map(post => (
                                    <tr key={post.id}>
                                        <td style={{ ...td, fontWeight: 600, color: '#1A2E35', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {post.title}
                                        </td>
                                        <td style={td}>
                                            <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, backgroundColor: 'rgba(59,130,246,0.1)', color: '#3B82F6' }}>
                                                {catLabel(post.category)}
                                            </span>
                                        </td>
                                        <td style={{ ...td, textAlign: 'center' }}>
                                            <button onClick={() => toggleStatus(post)} title={post.status === 'published' ? 'Click to unpublish' : 'Click to publish'}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                                                {post.status === 'published'
                                                    ? <Globe size={16} style={{ color: '#22C55E' }} />
                                                    : <GlobeLock size={16} style={{ color: '#94A3B8' }} />}
                                            </button>
                                        </td>
                                        <td style={td}>{post.targetKeyword || 'None'}</td>
                                        <td style={td}>
                                            {formatCT(post.publishDate, 'date')}
                                        </td>
                                        <td style={td}>{formatCT(post.createdAt, 'date')}</td>
                                        <td style={{ ...td, textAlign: 'center' }}>
                                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                                <button onClick={() => openEdit(post)} title="Edit"
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#3B82F6' }}>
                                                    <Pencil size={14} />
                                                </button>
                                                {/* A draft has no public page: /blog/<slug> reads only
                                                    published posts, so the live URL 404s until the post
                                                    is published. Drafts go to the admin-only preview,
                                                    in this tab; the live page opens in a new one. */}
                                                <a
                                                    href={post.status === 'published' ? `/blog/${post.slug}` : `/admin/blog/preview/${post.id}`}
                                                    target={post.status === 'published' ? '_blank' : undefined}
                                                    rel={post.status === 'published' ? 'noopener noreferrer' : undefined}
                                                    title={post.status === 'published' ? 'Open the live page' : 'Preview this draft'}
                                                    style={{ padding: 4, color: '#BE185D' }}>
                                                    <Eye size={14} />
                                                </a>
                                                <button onClick={() => deletePost(post.id)} title="Delete"
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#EF4444' }}>
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {filteredPosts.length === 0 && (
                                    <tr><td colSpan={7} style={{ ...td, textAlign: 'center', padding: 40 }}>No posts found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ═══ EDITOR MODAL ═══ */}
            {editorOpen && (
                <>
                    <div onClick={() => setEditorOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50 }} />
                    <div style={{
                        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                        zIndex: 51, width: '95%', maxWidth: 800, maxHeight: '90vh', overflowY: 'auto',
                        backgroundColor: '#FFFFFF', borderRadius: 16, border: '1px solid rgba(255,255,255,0.5)', padding: 28,
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <h2 style={{ ...heading, fontSize: 20 }}>{editingPost ? 'Edit Post' : 'New Blog Post'}</h2>
                            <button onClick={() => setEditorOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* Title */}
                            <div>
                                <label style={{ ...muted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Title *</label>
                                <input type="text" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} style={inputStyle} placeholder="Blog post title..." />
                            </div>

                            {/* Category + Status */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label style={{ ...muted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Category *</label>
                                    <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                                        {/* A row that predates the taxonomy keeps its own id as an option.
                                            Without it the select shows the first category while the form
                                            still holds the legacy one, so the editor misreports the post. */}
                                        {form.category && !CATEGORIES.some(c => c.value === form.category) && (
                                            <option value={form.category}>{form.category} (legacy category)</option>
                                        )}
                                        {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ ...muted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Status</label>
                                    <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                                        <option value="draft">Draft</option>
                                        <option value="published">Published</option>
                                    </select>
                                </div>
                            </div>

                            {/* SEO Fields */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label style={{ ...muted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Meta Description</label>
                                    <input type="text" value={form.metaDescription} onChange={e => setForm(p => ({ ...p, metaDescription: e.target.value }))} style={inputStyle} placeholder="Brief description for SEO..." />
                                </div>
                                <div>
                                    <label style={{ ...muted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Target Keyword</label>
                                    <input type="text" value={form.targetKeyword} onChange={e => setForm(p => ({ ...p, targetKeyword: e.target.value }))} style={inputStyle} placeholder="Primary keyword..." />
                                </div>
                            </div>

                            {/* Image URL */}
                            <div>
                                <label style={{ ...muted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Image URL</label>
                                <input type="text" value={form.imageUrl} onChange={e => setForm(p => ({ ...p, imageUrl: e.target.value }))} style={inputStyle} placeholder="https://..." />
                            </div>

                            {/* Editorial review date — feeds BlogPosting.dateModified
                                and the visible "Last Reviewed" line on the post page.
                                Only set it when a real review pass happened. */}
                            <div>
                                <label style={{ ...muted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Reviewed At (editorial review date)</label>
                                <input type="date" value={form.reviewedAt} onChange={e => setForm(p => ({ ...p, reviewedAt: e.target.value }))} style={inputStyle} />
                            </div>

                            {/* FAQ JSON — emitted as FAQPage JSON-LD by the post page.
                                Must mirror the post's visible FAQ section. */}
                            <div>
                                <label style={{ ...muted, fontWeight: 600, display: 'block', marginBottom: 6 }}>FAQ JSON (FAQPage schema; must match the post&apos;s visible FAQ)</label>
                                <textarea
                                    value={form.faqJson}
                                    onChange={e => setForm(p => ({ ...p, faqJson: e.target.value }))}
                                    style={{
                                        ...inputStyle, minHeight: 120, fontFamily: 'monospace', fontSize: '12px',
                                        lineHeight: '1.6', resize: 'vertical',
                                    }}
                                    placeholder='[{"name": "Question?", "text": "Answer."}]'
                                />
                            </div>

                            {/* Content */}
                            <div>
                                <label style={{ ...muted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Content (Markdown) *</label>
                                <textarea
                                    value={form.content}
                                    onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
                                    style={{
                                        ...inputStyle, minHeight: 300, fontFamily: 'monospace', fontSize: '13px',
                                        lineHeight: '1.7', resize: 'vertical',
                                    }}
                                    placeholder="Write your blog post content in Markdown..."
                                />
                            </div>
                        </div>

                        {editorError && (
                            <p role="alert" style={{ marginTop: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, backgroundColor: 'rgba(239,68,68,0.1)', color: '#B91C1C' }}>
                                {editorError}
                            </p>
                        )}

                        <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
                            <button onClick={() => setEditorOpen(false)}
                                style={{ padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', backgroundColor: '#F8FAF9', border: '1px solid rgba(255,255,255,0.5)', color: '#1A2E35', fontWeight: 600, fontSize: '13px' }}>
                                Cancel
                            </button>
                            <button onClick={savePost} disabled={saving}
                                style={{ padding: '10px 24px', borderRadius: '10px', cursor: 'pointer', backgroundColor: '#BE185D', color: '#0F172A', border: 'none', fontWeight: 700, fontSize: '13px', opacity: saving ? 0.5 : 1 }}>
                                {saving ? 'Saving…' : (editingPost ? 'Update Post' : 'Create Post')}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
