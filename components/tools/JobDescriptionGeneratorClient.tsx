'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Check, Copy, FileText, ShieldCheck } from 'lucide-react';
import { brand } from '@/config/brand';
import {
  JD_TEMPLATES,
  TEMPLATE_CATEGORY_LABELS,
  renderTemplate,
  visibleLength,
  type JdTemplateCategory,
  type JdTemplateId,
} from '@/lib/jd-templates';
import type { StateSalarySnapshot } from '@/lib/tools-salary-data';
import ToolStyles from './ToolStyles';
import { ShareableToolbar, saveDraftAndOpenPostJob } from './ToolUiHelpers';
import { evaluatePayTransparency } from './employer-ops-models';
import { TOOL_ACCENT, clayCard, controlStyle, formatUsd, labelStyle, selectStyle } from './tool-theme';

const BENEFIT_CHOICES = [
  'Health Insurance',
  'Dental & Vision',
  'PTO / Vacation',
  'CME Allowance',
  'Malpractice Coverage',
  '401k / Retirement',
  'Loan Repayment',
  'Flexible Schedule',
  'Sign-on Bonus',
] as const;

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h2>(.*?)<\/h2>/gi, '\n## $1\n\n')
    .replace(/<h3>(.*?)<\/h3>/gi, '\n### $1\n\n')
    .replace(/<li>(.*?)<\/li>/gi, '* $1\n')
    .replace(/<\/?ul>/gi, '\n')
    .replace(/<p>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<h2>(.*?)<\/h2>/gi, '\n$1\n')
    .replace(/<h3>(.*?)<\/h3>/gi, '\n$1\n')
    .replace(/<li>(.*?)<\/li>/gi, '• $1\n')
    .replace(/<\/?ul>/gi, '\n')
    .replace(/<p>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Props {
  states: readonly StateSalarySnapshot[];
}

export default function JobDescriptionGeneratorClient({ states }: Props) {
  const [categoryFilter, setCategoryFilter] = useState<'all' | JdTemplateCategory>('all');
  const [templateId, setTemplateId] = useState<JdTemplateId>('outpatient-adult');
  const [companyName, setCompanyName] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('California');
  const [workMode, setWorkMode] = useState<'In-Person' | 'Hybrid' | 'Remote'>('In-Person');
  const [jobType, setJobType] = useState<'Full-Time' | 'Part-Time' | 'Contract' | 'Per Diem'>('Full-Time');
  const [roleTitle, setRoleTitle] = useState(`Outpatient Primary Care ${brand.niche.long}`);
  const [salaryMin, setSalaryMin] = useState(125000);
  const [salaryMax, setSalaryMax] = useState(150000);
  const [headcount, setHeadcount] = useState(25);
  const [selectedBenefits, setSelectedBenefits] = useState<string[]>([
    'Health Insurance',
    'Dental & Vision',
    'PTO / Vacation',
    'CME Allowance',
    'Malpractice Coverage',
    '401k / Retirement',
  ]);
  const [copiedFormat, setCopiedFormat] = useState<null | 'html' | 'md' | 'txt'>(null);

  const visibleTemplates = useMemo(
    () => (categoryFilter === 'all' ? JD_TEMPLATES : JD_TEMPLATES.filter((t) => t.category === categoryFilter)),
    [categoryFilter],
  );

  const activeTemplate = useMemo(
    () => JD_TEMPLATES.find((t) => t.id === templateId) ?? JD_TEMPLATES[0],
    [templateId],
  );

  const stateMarket = useMemo(
    () => states.find((s) => s.state === stateName) ?? null,
    [states, stateName],
  );

  const transparency = useMemo(
    () =>
      evaluatePayTransparency({
        state: stateName,
        employerHeadcount: headcount,
        workMode,
        remoteNationwide: workMode === 'Remote',
      }),
    [stateName, headcount, workMode],
  );

  const finalHtml = useMemo(() => {
    let rendered = renderTemplate(activeTemplate, {
      employer: companyName,
      city,
      state: stateName,
    });
    if (salaryMin > 0 && salaryMax >= salaryMin) {
      rendered = rendered.replace(
        '$[XXX,000 to XXX,000]',
        `${formatUsd(salaryMin)} to ${formatUsd(salaryMax)} per year`,
      );
    }
    return rendered;
  }, [activeTemplate, companyName, city, stateName, salaryMin, salaryMax]);

  const charCount = useMemo(() => visibleLength(finalHtml), [finalHtml]);

  const copyAs = async (fmt: 'html' | 'md' | 'txt') => {
    const content =
      fmt === 'html' ? finalHtml : fmt === 'md' ? htmlToMarkdown(finalHtml) : htmlToPlainText(finalHtml);
    try {
      await navigator.clipboard.writeText(content);
      setCopiedFormat(fmt);
      setTimeout(() => setCopiedFormat(null), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  const toggleBenefit = (b: string) => {
    setSelectedBenefits((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]));
  };

  const handleOpenPostJob = () => {
    const loc =
      workMode === 'Remote' && !city.trim()
        ? `Remote (${stateName})`
        : [city.trim(), stateName].filter(Boolean).join(', ');
    saveDraftAndOpenPostJob({
      title: roleTitle.trim() || `${activeTemplate.label} ${brand.niche.long}`,
      companyName: companyName.trim(),
      location: loc,
      mode: workMode,
      jobType,
      salaryPeriod: 'annual',
      salaryMin,
      salaryMax,
      description: finalHtml,
      benefits: selectedBenefits,
      setting: activeTemplate.setting,
      population: activeTemplate.population,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ToolStyles />

      {/* Top Step 1: Pick Setting & Template */}
      <div style={{ ...clayCard, padding: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Step 1 · Setting Skeleton
            </span>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: '2px 0 0' }}>
              Choose a clinical practice template ({JD_TEMPLATES.length} built-in skeletons)
            </h3>
          </div>
          <ShareableToolbar
            queryParams={{
              tpl: templateId,
              state: stateName,
              mode: workMode,
              min: salaryMin,
              max: salaryMax,
            }}
            onReset={() => {
              setTemplateId('outpatient-adult');
              setCompanyName('');
              setCity('');
              setStateName('California');
              setWorkMode('In-Person');
              setJobType('Full-Time');
              setRoleTitle(`Outpatient Primary Care ${brand.niche.long}`);
              setSalaryMin(125000);
              setSalaryMax(150000);
            }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
          <button
            type="button"
            aria-pressed={categoryFilter === 'all'}
            onClick={() => setCategoryFilter('all')}
            style={{
              padding: '7px 14px',
              borderRadius: '999px',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
              border: categoryFilter === 'all' ? '1.5px solid #BE185D' : '1px solid rgba(0,0,0,0.1)',
              background: categoryFilter === 'all' ? '#FDF2F8' : '#F8FAFC',
              color: categoryFilter === 'all' ? '#9D174D' : '#334155',
            }}
          >
            All settings ({JD_TEMPLATES.length})
          </button>
          {(Object.keys(TEMPLATE_CATEGORY_LABELS) as JdTemplateCategory[]).map((cat) => {
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={active}
                onClick={() => setCategoryFilter(cat)}
                style={{
                  padding: '7px 14px',
                  borderRadius: '999px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: active ? '1.5px solid #BE185D' : '1px solid rgba(0,0,0,0.1)',
                  background: active ? '#FDF2F8' : '#F8FAFC',
                  color: active ? '#9D174D' : '#334155',
                }}
              >
                {TEMPLATE_CATEGORY_LABELS[cat]}
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '10px',
          }}
        >
          {visibleTemplates.map((t) => {
            const selected = t.id === templateId;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setTemplateId(t.id);
                  setRoleTitle(`${t.label.replace(':', '')} ${brand.niche.long}`);
                  if (t.category === 'telehealth') setWorkMode('Remote');
                }}
                style={{
                  textAlign: 'left',
                  padding: '13px 14px',
                  borderRadius: '14px',
                  cursor: 'pointer',
                  border: selected ? '2px solid #BE185D' : '1.5px solid rgba(0,0,0,0.08)',
                  background: selected ? '#FDF2F8' : '#FFFFFF',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#1A2E35', marginBottom: '4px' }}>
                  {t.label}
                </div>
                <div style={{ fontSize: '12px', color: '#5A4A42', lineHeight: 1.45 }}>{t.summary}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main 2-column Builder + Preview */}
      <div
        className="tool-two-col"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)',
          gap: '20px',
          alignItems: 'start',
        }}
      >
        {/* Left Controls */}
        <div style={{ ...clayCard, padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>
            Step 2 · Customize Role & Pay Details
          </h3>

          <div>
            <label htmlFor="jd-role-title" style={labelStyle}>Job posting title</label>
            <input
              id="jd-role-title"
              className="tool-control"
              type="text"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              style={controlStyle}
            />
          </div>

          <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label htmlFor="jd-company" style={labelStyle}>Organization / Practice</label>
              <input
                id="jd-company"
                className="tool-control"
                type="text"
                placeholder="e.g. Cascade Primary Care"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                style={controlStyle}
              />
            </div>
            <div>
              <label htmlFor="jd-city" style={labelStyle}>City</label>
              <input
                id="jd-city"
                className="tool-control"
                type="text"
                placeholder="e.g. Sacramento"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                style={controlStyle}
              />
            </div>
          </div>

          <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label htmlFor="jd-state" style={labelStyle}>State / Jurisdiction</label>
              <select
                id="jd-state"
                className="tool-control"
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
                style={selectStyle}
              >
                {states.map((s) => (
                  <option key={s.state} value={s.state}>{s.state}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="jd-headcount" style={labelStyle}>Employer headcount</label>
              <input
                id="jd-headcount"
                className="tool-control"
                type="number"
                min={1}
                value={headcount}
                onChange={(e) => setHeadcount(Math.max(1, Number(e.target.value) || 1))}
                style={controlStyle}
              />
            </div>
          </div>

          <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label htmlFor="jd-mode" style={labelStyle}>Work mode</label>
              <select
                id="jd-mode"
                className="tool-control"
                value={workMode}
                onChange={(e) => setWorkMode(e.target.value as 'In-Person' | 'Hybrid' | 'Remote')}
                style={selectStyle}
              >
                <option value="In-Person">In-Person</option>
                <option value="Hybrid">Hybrid</option>
                <option value="Remote">Remote</option>
              </select>
            </div>
            <div>
              <label htmlFor="jd-jobtype" style={labelStyle}>Employment type</label>
              <select
                id="jd-jobtype"
                className="tool-control"
                value={jobType}
                onChange={(e) => setJobType(e.target.value as 'Full-Time' | 'Part-Time' | 'Contract' | 'Per Diem')}
                style={selectStyle}
              >
                <option value="Full-Time">Full-Time</option>
                <option value="Part-Time">Part-Time</option>
                <option value="Contract">Contract</option>
                <option value="Per Diem">Per Diem</option>
              </select>
            </div>
          </div>

          <div className="tool-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label htmlFor="jd-sal-min" style={labelStyle}>Annual salary min ($)</label>
              <input
                id="jd-sal-min"
                className="tool-control"
                type="number"
                min={0}
                step={1000}
                value={salaryMin}
                onChange={(e) => setSalaryMin(Math.max(0, Number(e.target.value) || 0))}
                style={controlStyle}
              />
            </div>
            <div>
              <label htmlFor="jd-sal-max" style={labelStyle}>Annual salary max ($)</label>
              <input
                id="jd-sal-max"
                className="tool-control"
                type="number"
                min={0}
                step={1000}
                value={salaryMax}
                onChange={(e) => setSalaryMax(Math.max(0, Number(e.target.value) || 0))}
                style={controlStyle}
              />
            </div>
          </div>

          {stateMarket && (stateMarket.liveMedian !== null || stateMarket.blsMedian !== null) && (
            <div style={{ padding: '11px 14px', borderRadius: '12px', background: '#F8FAFC', border: '1px solid rgba(0,0,0,0.07)', fontSize: '12.5px', color: '#334155', lineHeight: 1.5 }}>
              <strong>{stateName} pay reference:</strong>{' '}
              {stateMarket.liveMedian !== null
                ? `Live posted median ${formatUsd(stateMarket.liveMedian)} (${stateMarket.liveEmployers} employers)`
                : `BLS May 2025 median annual wage ${formatUsd(stateMarket.blsMedian!)}`}
              {stateMarket.blsP25 !== null && stateMarket.blsP75 !== null && (
                <span> · BLS 25th to 75th percentile: {formatUsd(stateMarket.blsP25)} to {formatUsd(stateMarket.blsP75)}</span>
              )}
            </div>
          )}

          {/* Live Pay Transparency Compliance Reminder */}
          <div
            style={{
              padding: '13px 15px',
              borderRadius: '13px',
              background: transparency.mustPublishRangeNow ? '#FEF3C7' : '#EEF2FF',
              border: transparency.mustPublishRangeNow
                ? '1.5px solid rgba(217,119,6,0.35)'
                : '1.5px solid rgba(67,56,202,0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <ShieldCheck size={16} color={transparency.mustPublishRangeNow ? '#B45309' : '#4338CA'} />
              <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#1A2E35' }}>
                {transparency.headline}
              </span>
            </div>
            <p style={{ fontSize: '12px', color: '#334155', margin: 0, lineHeight: 1.5 }}>
              {transparency.rule.summary}
            </p>
          </div>

          {/* Benefits pills for Post-a-Job handoff */}
          <div>
            <span style={labelStyle}>Benefits to pre-check in Post a Job</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
              {BENEFIT_CHOICES.map((benefit) => {
                const checked = selectedBenefits.includes(benefit);
                const cbId = `jd-ben-${benefit.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                return (
                  <label
                    key={benefit}
                    htmlFor={cbId}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 11px',
                      borderRadius: '10px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      background: checked ? '#FDF2F8' : '#F8FAFC',
                      color: checked ? '#9D174D' : '#475569',
                      border: checked ? '1.5px solid rgba(190,24,93,0.35)' : '1px solid rgba(0,0,0,0.09)',
                    }}
                  >
                    <input
                      id={cbId}
                      className="tool-control"
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleBenefit(benefit)}
                      style={{ accentColor: TOOL_ACCENT }}
                    />
                    {benefit}
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Rich Preview & Export */}
        <div style={{ ...clayCard, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
            <div>
              <span style={{ fontSize: '11px', fontWeight: 800, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Step 3 · Live Preview ({charCount.toLocaleString('en-US')} visible chars)
              </span>
              <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#1A2E35', margin: '2px 0 0' }}>
                {roleTitle || activeTemplate.label}
              </h3>
            </div>

            <button
              type="button"
              onClick={handleOpenPostJob}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '7px',
                padding: '11px 18px',
                borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(145deg, #BE185D, #9D174D)',
                color: '#FFFFFF',
                fontSize: '13.5px',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(190,24,93,0.25)',
              }}
            >
              Open in Post a Job <ArrowRight size={15} />
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {[
              { key: 'txt' as const, label: 'Copy Plain Text' },
              { key: 'md' as const, label: 'Copy Markdown' },
              { key: 'html' as const, label: 'Copy HTML' },
            ].map((btn) => (
              <button
                key={btn.key}
                type="button"
                onClick={() => copyAs(btn.key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 13px',
                  borderRadius: '10px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: '1px solid rgba(0,0,0,0.11)',
                  background: copiedFormat === btn.key ? '#ECFDF5' : '#F8FAFC',
                  color: copiedFormat === btn.key ? '#065F46' : '#334155',
                }}
              >
                {copiedFormat === btn.key ? <Check size={14} /> : <Copy size={14} />}
                {copiedFormat === btn.key ? 'Copied!' : btn.label}
              </button>
            ))}
          </div>

          <div
            className="jd-preview-prose"
            style={{
              padding: '20px 22px',
              borderRadius: '14px',
              background: '#F8FAFC',
              border: '1px solid rgba(0,0,0,0.08)',
              maxHeight: '580px',
              overflowY: 'auto',
              fontSize: '13.5px',
              color: '#1A2E35',
              lineHeight: 1.65,
            }}
            dangerouslySetInnerHTML={{ __html: finalHtml }}
          />

          <p style={{ fontSize: '12px', color: '#5A4A42', margin: 0, lineHeight: 1.5 }}>
            <FileText size={13} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '5px' }} />
            Prompts inside <strong>[square brackets]</strong> mark clinic-specific details (EHR name, panel size, shift hours, call rotation) to customize before publishing so your listing stands out to experienced clinicians.
          </p>
        </div>
      </div>

      <style>{`
        .jd-preview-prose h2 { font-size: 15.5px; font-weight: 800; color: #1A2E35; margin: 16px 0 6px; }
        .jd-preview-prose h2:first-child { margin-top: 0; }
        .jd-preview-prose h3 { font-size: 14px; font-weight: 800; color: #334155; margin: 14px 0 6px; }
        .jd-preview-prose p { margin: 0 0 10px; }
        .jd-preview-prose ul { margin: 0 0 12px; padding-left: 20px; }
        .jd-preview-prose li { margin-bottom: 5px; }
      `}</style>
    </div>
  );
}
