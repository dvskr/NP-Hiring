import { Metadata } from 'next';
import Link from 'next/link';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { Bot, Link2, KeyRound, Send, MessageSquareText, ShieldCheck, LifeBuoy, ListChecks } from 'lucide-react';
import { brand } from '@/config/brand';
import { aiAppListings } from '@/config/ai-apps';
import { MCP_SCOPES, MCP_SCOPE_DESCRIPTIONS, mcpHostProfile } from '@/lib/mcp/config';
import { TOOL } from '@/lib/mcp/tool-names';

/**
 * Public documentation for the NP Hiring app in Claude and ChatGPT: how to
 * connect, what it can do, what sign-in allows, example prompts and support.
 * Both directories require a documentation URL (docs/ai-apps/submission.md),
 * and the OAuth metadata names this page as the service documentation.
 */
export const metadata: Metadata = {
    title: `${brand.name} in Claude and ChatGPT`,
    description: `Search ${brand.niche.short} jobs, apply with Easy Apply and follow your applications from Claude or ChatGPT.`,
    alternates: { canonical: `${brand.baseUrl}/ai-apps` },
    robots: { index: true, follow: true },
};

const clayCard: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow:
        '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
};
const linkStyle: React.CSSProperties = { color: '#BE185D', textDecoration: 'underline' };
const pStyle: React.CSSProperties = { margin: '0 0 10px 0' };
const ulStyle: React.CSSProperties = { margin: '0 0 10px 0', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' };
const codeStyle: React.CSSProperties = {
    display: 'inline-block',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '13.5px',
    background: '#F8FAFC',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: '8px',
    padding: '4px 10px',
    color: '#1A2E35',
    wordBreak: 'break-all',
};

interface SectionProps {
    id: string;
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
}

function Section({ id, icon, title, children }: SectionProps) {
    return (
        <section id={id} style={{ display: 'flex', gap: '14px', marginTop: '28px', scrollMarginTop: '96px' }}>
            <div
                aria-hidden="true"
                style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#FCE7F3',
                    color: '#BE185D',
                }}
            >
                {icon}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', margin: '4px 0 8px 0' }}>{title}</h2>
                <div style={{ fontSize: '14px', color: '#4A5568', lineHeight: 1.7 }}>{children}</div>
            </div>
        </section>
    );
}

const TOOLS: ReadonlyArray<{ name: string; does: string; signIn: boolean }> = [
    { name: TOOL.searchJobs, does: `Searches ${brand.name} jobs by specialty, place, work mode, schedule, pay and keywords`, signIn: false },
    { name: TOOL.getJob, does: 'Shows one job in full, with how to apply', signIn: false },
    { name: TOOL.practiceAuthority, does: "Gives a state's practice authority tier and what the state requires", signIn: false },
    { name: TOOL.profileStatus, does: 'Checks your profile and resume before you apply', signIn: true },
    { name: TOOL.startApplication, does: 'Opens the application review for a job without sending anything', signIn: true },
    { name: TOOL.submitApplication, does: 'Sends an Easy Apply application after you review it and agree to share it', signIn: true },
    { name: TOOL.trackEmployerSiteApplication, does: "Adds a job you applied to on the employer's site to My applications", signIn: true },
    { name: TOOL.listApplications, does: 'Lists your applications and where each one stands', signIn: true },
    { name: TOOL.withdrawApplication, does: 'Withdraws an application you choose', signIn: true },
    { name: TOOL.saveJob, does: 'Saves a job', signIn: true },
    { name: TOOL.unsaveJob, does: 'Removes a saved job', signIn: true },
    { name: TOOL.listSavedJobs, does: 'Lists your saved jobs', signIn: true },
];

const EXAMPLE_PROMPTS: readonly string[] = [
    `Find remote ${brand.niche.short} jobs in Texas that pay over $150k.`,
    'Show me Easy Apply family practice jobs in Florida and help me apply to one.',
    `Which of my ${brand.name} applications are still active?`,
    `Does Arizona give ${brand.niche.short}s full practice authority?`,
];

export default function AiAppsPage() {
    const claude = mcpHostProfile('claude');
    const chatgpt = mcpHostProfile('chatgpt');
    return (
        <div style={{ background: '#F5F0EB', minHeight: '100vh', padding: '48px 16px 80px' }}>
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'AI apps', url: `${brand.baseUrl}/ai-apps` },
                ]}
            />
            <article style={{ ...clayCard, maxWidth: '820px', margin: '0 auto', padding: 'clamp(28px, 5vw, 48px) clamp(20px, 5vw, 40px)' }}>
                <header style={{ marginBottom: '8px' }}>
                    <div
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 14px',
                            background: '#FCE7F3',
                            color: '#BE185D',
                            borderRadius: '20px',
                            fontSize: '13px',
                            fontWeight: 700,
                            marginBottom: '16px',
                        }}
                    >
                        <Bot size={14} aria-hidden="true" /> AI apps
                    </div>
                    <h1
                        style={{
                            fontSize: 'clamp(2rem, 5vw, 2.75rem)',
                            fontWeight: 800,
                            fontFamily: 'var(--font-lora), Georgia, serif',
                            color: '#1A2E35',
                            margin: '0 0 12px 0',
                            lineHeight: 1.15,
                        }}
                    >
                        {brand.name} in <span style={{ color: '#BE185D' }}>Claude and ChatGPT</span>
                    </h1>
                    <p style={{ fontSize: '15px', color: '#4A5568', margin: 0, lineHeight: 1.7 }}>
                        Search {brand.niche.short} jobs, apply with Easy Apply and follow your applications without
                        leaving the conversation.
                    </p>
                </header>

                <Section id="what-it-does" icon={<ListChecks size={20} />} title="What it does">
                    <ul style={ulStyle}>
                        <li>Searches every {brand.niche.short} job listed on {brand.name}, with pay, location and schedule.</li>
                        <li>Shows a job in full and checks a state&apos;s practice authority.</li>
                        <li>Sends Easy Apply applications with the resume on your profile, after you review and agree.</li>
                        <li>Gives the employer&apos;s link for other jobs and adds them to My applications.</li>
                        <li>Lists your applications and saved jobs, and withdraws an application when you ask.</li>
                    </ul>
                </Section>

                <Section id="connect-claude" icon={<Link2 size={20} />} title="Connect in Claude">
                    {aiAppListings.claude ? (
                        <p style={pStyle}>
                            Open the{' '}
                            <a href={aiAppListings.claude} style={linkStyle} target="_blank" rel="noopener noreferrer">
                                {brand.name} listing in Claude&apos;s connectors directory
                            </a>{' '}
                            and choose Connect.
                        </p>
                    ) : null}
                    <p style={pStyle}>{aiAppListings.claude ? 'Or add' : 'Add'} a custom connector in Claude with this URL:</p>
                    <p style={pStyle}>
                        <code style={codeStyle}>{claude.resourceUrl}</code>
                    </p>
                </Section>

                <Section id="connect-chatgpt" icon={<Link2 size={20} />} title="Connect in ChatGPT">
                    {aiAppListings.chatgpt ? (
                        <p style={pStyle}>
                            Open the{' '}
                            <a href={aiAppListings.chatgpt} style={linkStyle} target="_blank" rel="noopener noreferrer">
                                {brand.name} listing in ChatGPT
                            </a>{' '}
                            and add it.
                        </p>
                    ) : null}
                    <p style={pStyle}>
                        {aiAppListings.chatgpt ? 'ChatGPT plans that allow custom MCP servers can also add' : 'ChatGPT plans that allow custom MCP servers can add'}{' '}
                        this URL:
                    </p>
                    <p style={pStyle}>
                        <code style={codeStyle}>{chatgpt.resourceUrl}</code>
                    </p>
                </Section>

                <Section id="sign-in" icon={<KeyRound size={20} />} title="Signing in">
                    <p style={pStyle}>
                        Searching jobs works without an account. To apply or see your applications, the app asks you to
                        sign in on a {brand.name} page and approve what it may do:
                    </p>
                    <ul style={ulStyle}>
                        {MCP_SCOPES.map((scope) => (
                            <li key={scope}>{MCP_SCOPE_DESCRIPTIONS[scope]}.</li>
                        ))}
                    </ul>
                    <p style={pStyle}>
                        You can remove access at any time in <Link href="/settings?tab=account" style={linkStyle}>Settings</Link>,
                        under Account, in Connected apps.
                    </p>
                </Section>

                <Section id="applying" icon={<Send size={20} />} title="Applying">
                    <p style={pStyle}>
                        For an Easy Apply job, the assistant opens a review with the resume on your profile, a cover letter
                        you can edit, the employer&apos;s screening questions and the consent line. Nothing is sent until you
                        submit it. Other jobs continue on the employer&apos;s site, and the app can add them to My applications.
                    </p>
                </Section>

                <Section id="examples" icon={<MessageSquareText size={20} />} title="Example prompts">
                    <ul style={ulStyle}>
                        {EXAMPLE_PROMPTS.map((prompt) => (
                            <li key={prompt}>{prompt}</li>
                        ))}
                    </ul>
                </Section>

                <Section id="tools" icon={<ListChecks size={20} />} title="Tools">
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', color: '#1A2E35' }}>
                                    <th style={{ padding: '6px 8px 6px 0' }}>Tool</th>
                                    <th style={{ padding: '6px 8px' }}>What it does</th>
                                    <th style={{ padding: '6px 0 6px 8px' }}>Sign-in</th>
                                </tr>
                            </thead>
                            <tbody>
                                {TOOLS.map((tool) => (
                                    <tr key={tool.name} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                                        <td style={{ padding: '6px 8px 6px 0', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', whiteSpace: 'nowrap' }}>
                                            {tool.name}
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>{tool.does}</td>
                                        <td style={{ padding: '6px 0 6px 8px' }}>{tool.signIn ? 'Yes' : 'No'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Section>

                <Section id="privacy" icon={<ShieldCheck size={20} />} title="Privacy">
                    <p style={pStyle}>
                        The app never asks for your NPI, DEA or Social Security number, your license numbers or your EEO
                        information, and it does not receive your conversation. Section 17 of our{' '}
                        <Link href="/privacy#ai-apps" style={linkStyle}>Privacy Policy</Link> explains what an assistant
                        receives and how long we keep it.
                    </p>
                </Section>

                <Section id="support" icon={<LifeBuoy size={20} />} title="Support">
                    <p style={pStyle}>
                        Email <a href={`mailto:${brand.email.support}`} style={linkStyle}>{brand.email.support}</a> for help,{' '}
                        <a href={`mailto:${brand.email.privacy}`} style={linkStyle}>{brand.email.privacy}</a> for privacy
                        requests and <a href={`mailto:${brand.email.security}`} style={linkStyle}>{brand.email.security}</a>{' '}
                        to report a security issue.
                    </p>
                </Section>
            </article>
        </div>
    );
}
