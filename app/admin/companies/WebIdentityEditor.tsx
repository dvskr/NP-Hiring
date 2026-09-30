'use client';

import { useState } from 'react';

/**
 * The admin data pass for an employer's own website and logo (indexing audit
 * GFJ-08). They feed the JobPosting hiringOrganization sameAs and logo on
 * every job page of the company. Writes go through
 * PATCH /api/admin/companies/:id/profile (https URLs only, audit-logged);
 * scripts/indexing-fixes/populate-company-website-logo.ts fills what it can
 * prove, and this editor covers the rest.
 */
export interface WebIdentityCompany {
    id: string;
    name: string;
    website: string | null;
    logoUrl: string | null;
}

interface WebIdentityEditorProps<T extends WebIdentityCompany> {
    company: T;
    onSaved: (company: T) => void;
    onMessage: (text: string, isError: boolean) => void;
}

const fieldStyle: React.CSSProperties = {
    padding: '6px 10px', borderRadius: '8px', fontSize: '12px', backgroundColor: '#F8FAF9',
    border: '1px solid #E2E8F0', color: '#1A2E35', outline: 'none', width: '100%',
};
const linkButton: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0, color: '#BE185D', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
};

/** A blank field means "clear"; anything else is sent as typed and validated by the route. */
function toPayloadValue(value: string): string | null {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

export default function WebIdentityEditor<T extends WebIdentityCompany>({ company, onSaved, onMessage }: WebIdentityEditorProps<T>) {
    const [open, setOpen] = useState(false);
    const [website, setWebsite] = useState(company.website ?? '');
    const [logoUrl, setLogoUrl] = useState(company.logoUrl ?? '');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch(`/api/admin/companies/${company.id}/profile`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ website: toPayloadValue(website), logoUrl: toPayloadValue(logoUrl) }),
            });
            const data = await res.json().catch(() => ({} as { error?: string; company?: T }));
            if (!res.ok || !data.company) {
                onMessage(data.error || 'Could not save the website and logo. Check that both are https URLs.', true);
                return;
            }
            onSaved(data.company as T);
            setOpen(false);
            onMessage(`${company.name}: website and logo saved. Job pages show them after their next refresh.`, false);
        } catch {
            onMessage('Network error. Please try again.', true);
        } finally {
            setSaving(false);
        }
    };

    if (!open) {
        return (
            <div style={{ color: '#94A3B8', fontSize: '12px', fontWeight: 400, marginTop: 4 }}>
                <div>{company.website ? company.website.replace(/^https?:\/\//, '') : 'No website on file'}</div>
                <div>{company.logoUrl ? 'Logo on file' : 'No logo on file'}</div>
                <button type="button" onClick={() => setOpen(true)} style={{ ...linkButton, marginTop: 4 }}>
                    Edit website and logo
                </button>
            </div>
        );
    }

    return (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}>
            <label style={{ fontSize: '11px', color: '#6B7F8A', fontWeight: 500 }}>
                Website (the employer&apos;s own site, https)
                <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.example.org" style={fieldStyle} />
            </label>
            <label style={{ fontSize: '11px', color: '#6B7F8A', fontWeight: 500 }}>
                Logo URL (an image on the employer&apos;s site, https)
                <input type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://www.example.org/logo.png" style={fieldStyle} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    style={{ padding: '6px 12px', borderRadius: '8px', fontSize: 12, fontWeight: 700, border: 'none', background: '#BE185D', color: '#fff', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.5 : 1 }}
                >
                    {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setOpen(false)} disabled={saving} style={linkButton}>Cancel</button>
            </div>
        </div>
    );
}
