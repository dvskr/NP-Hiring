/**
 * Renderer for the two definition guides (what-is-a-nurse-practitioner and
 * np-vs-pa). Not a route file.
 *
 * It prints only what a guide's content.ts holds, in the layout of the other
 * /resources guides (app/resources/fpa-guide/page.tsx): the pink hero, the
 * editorial byline, var(--bg-secondary) section cards, and Article, FAQPage
 * and BreadcrumbList JSON-LD built from the same data the page shows. The
 * first element under the H1 is the quick answer, by design: it is the
 * passage answer engines lift.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
    ArrowRight,
    Award,
    BookOpen,
    CheckCircle,
    Compass,
    GraduationCap,
    HelpCircle,
    Layers,
    Library,
    ListChecks,
    MapPin,
    Scale,
    ShieldCheck,
    Stethoscope,
    TrendingUp,
    Wallet,
    type LucideIcon,
} from 'lucide-react';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import EditorialByline from '@/components/EditorialByline';
import {
    articleJsonLd,
    breadcrumbItems,
    faqPageJsonLd,
    formatGuideDate,
    serializeJsonLd,
    type Block,
    type GuideContent,
    type GuideSection,
    type Inline,
    type Rich,
    type SectionIcon,
} from './guide-model';

const ICONS: Record<SectionIcon, LucideIcon> = {
    award: Award,
    book: BookOpen,
    compass: Compass,
    graduation: GraduationCap,
    layers: Layers,
    listChecks: ListChecks,
    mapPin: MapPin,
    scale: Scale,
    shield: ShieldCheck,
    stethoscope: Stethoscope,
    trending: TrendingUp,
    wallet: Wallet,
};

const HERO_TONES: Record<GuideContent['heroTone'], string> = {
    pink: 'bg-gradient-to-r from-pink-700 to-pink-800',
    pinkBlue: 'bg-gradient-to-r from-pink-700 to-blue-600',
};

const CARD_STYLE = { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' } as const;
const TILE_STYLE = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' } as const;
const PRIMARY_TEXT = { color: 'var(--text-primary)' } as const;
const SECONDARY_TEXT = { color: 'var(--text-secondary)' } as const;
const TERTIARY_TEXT = { color: 'var(--text-tertiary)' } as const;
const LINK_STYLE = { color: 'var(--color-primary)' } as const;
const LINK_CLASS = 'font-medium hover:underline';

// ─── Copy runs ───────────────────────────────────────────────────────────────

function InlineRun({ run }: { run: Inline }) {
    if (typeof run === 'string') return <>{run}</>;
    if (run.href.startsWith('/')) {
        return <Link href={run.href} className={LINK_CLASS} style={LINK_STYLE}>{run.text}</Link>;
    }
    if (run.href.startsWith('#')) {
        return <a href={run.href} className={LINK_CLASS} style={LINK_STYLE}>{run.text}</a>;
    }
    return (
        <a href={run.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS} style={LINK_STYLE}>
            {run.text}
        </a>
    );
}

function RichText({ content }: { content: Rich }) {
    return <>{content.map((run, index) => <InlineRun key={index} run={run} />)}</>;
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

type BlockOf<K extends Block['kind']> = Extract<Block, { kind: K }>;

function ChecklistBlock({ block }: { block: BlockOf<'checklist'> }) {
    return (
        <ul className="space-y-3 text-sm mb-5">
            {block.items.map((item, index) => (
                <li key={index} className="flex gap-2" style={SECONDARY_TEXT}>
                    <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <span><RichText content={item} /></span>
                </li>
            ))}
        </ul>
    );
}

function StepsBlock({ block }: { block: BlockOf<'steps'> }) {
    // CSS list markers number the steps, so no digit sits in the page text.
    return (
        <ol className="list-decimal pl-6 space-y-4 mb-5 marker:font-bold marker:text-pink-700">
            {block.items.map((step) => (
                <li key={step.title} className="pl-1">
                    <h3 className="font-semibold mb-1" style={PRIMARY_TEXT}>{step.title}</h3>
                    <p className="text-sm leading-relaxed" style={SECONDARY_TEXT}><RichText content={step.detail} /></p>
                </li>
            ))}
        </ol>
    );
}

function TermsBlock({ block }: { block: BlockOf<'terms'> }) {
    return (
        <dl className="space-y-4 mb-5">
            {block.items.map((item) => (
                <div key={item.term} className="rounded-lg p-4" style={TILE_STYLE}>
                    <dt className="font-semibold" style={PRIMARY_TEXT}>{item.term}</dt>
                    <dd className="text-sm leading-relaxed mt-1" style={SECONDARY_TEXT}><RichText content={item.detail} /></dd>
                </div>
            ))}
        </dl>
    );
}

function StatsBlock({ block }: { block: BlockOf<'stats'> }) {
    const columns = block.items.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3';
    return (
        <div className="mb-5">
            <ul className={`grid ${columns} gap-4`}>
                {block.items.map((stat) => (
                    <li key={stat.label} className="rounded-lg p-4 text-center" style={TILE_STYLE}>
                        <span className="block text-2xl font-bold" style={LINK_STYLE}>{stat.value}</span>
                        <span className="block text-xs mt-1" style={SECONDARY_TEXT}>{stat.label}</span>
                    </li>
                ))}
            </ul>
            <p className="text-xs mt-2" style={TERTIARY_TEXT}><RichText content={block.caption} /></p>
        </div>
    );
}

function TableBlock({ block }: { block: BlockOf<'table'> }) {
    const [rowHeader, ...columns] = block.columns;
    return (
        <div className="overflow-x-auto mb-5 rounded-lg" style={{ border: '1px solid var(--border-color)' }}>
            <table className="w-full text-sm" style={{ minWidth: '640px' }}>
                <caption className="sr-only">{block.caption}</caption>
                <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                        <th scope="col" className="text-left py-3 px-4"><span className="sr-only">{rowHeader}</span></th>
                        {columns.map((column) => (
                            <th key={column} scope="col" className="text-left py-3 px-4 font-semibold" style={PRIMARY_TEXT}>{column}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {block.rows.map((row) => (
                        <tr key={row.label} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <th scope="row" className="text-left align-top py-3 px-4 font-medium" style={PRIMARY_TEXT}>{row.label}</th>
                            {row.cells.map((cell, index) => (
                                <td key={index} className="align-top py-3 px-4 leading-relaxed" style={SECONDARY_TEXT}>
                                    <RichText content={cell} />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function CardsBlock({ block }: { block: BlockOf<'cards'> }) {
    return (
        <ul className="grid sm:grid-cols-2 gap-4 mb-5">
            {block.items.map((card) => (
                <li key={card.abbreviation} className="rounded-lg p-4" style={TILE_STYLE}>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={LINK_STYLE}>{card.abbreviation}</p>
                    <h3 className="font-semibold mb-1" style={PRIMARY_TEXT}>{card.name}</h3>
                    <p className="text-sm mb-3" style={SECONDARY_TEXT}>{card.focus}</p>
                    <Link href={card.link.href} className={`inline-flex items-center gap-1 text-sm ${LINK_CLASS}`} style={LINK_STYLE}>
                        {card.link.text} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                </li>
            ))}
        </ul>
    );
}

function LinksBlock({ block }: { block: BlockOf<'links'> }) {
    return (
        <ul className="flex flex-wrap gap-2 mb-5">
            {block.items.map((link) => (
                <li key={link.href}>
                    <Link
                        href={link.href}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium border border-pink-200 hover:bg-pink-50 transition-colors"
                        style={LINK_STYLE}
                    >
                        {link.text} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                </li>
            ))}
        </ul>
    );
}

function ChoicesBlock({ block }: { block: BlockOf<'choices'> }) {
    return (
        <div className="grid md:grid-cols-2 gap-6 mb-5">
            {block.columns.map((column) => (
                <div key={column.heading} className="rounded-lg p-5" style={TILE_STYLE}>
                    <h3 className="font-semibold mb-3" style={LINK_STYLE}>{column.heading}</h3>
                    <ul className="space-y-2 text-sm">
                        {column.items.map((item, index) => (
                            <li key={index} className="flex gap-2" style={SECONDARY_TEXT}>
                                <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                                <span><RichText content={item} /></span>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}

function BlockView({ block }: { block: Block }) {
    switch (block.kind) {
        case 'paragraph':
            return <p className="mb-4 leading-relaxed" style={SECONDARY_TEXT}><RichText content={block.content} /></p>;
        case 'checklist':
            return <ChecklistBlock block={block} />;
        case 'steps':
            return <StepsBlock block={block} />;
        case 'terms':
            return <TermsBlock block={block} />;
        case 'stats':
            return <StatsBlock block={block} />;
        case 'table':
            return <TableBlock block={block} />;
        case 'cards':
            return <CardsBlock block={block} />;
        case 'links':
            return <LinksBlock block={block} />;
        case 'choices':
            return <ChoicesBlock block={block} />;
    }
}

// ─── Page parts ──────────────────────────────────────────────────────────────

function StructuredData({ guide }: { guide: GuideContent }) {
    return (
        <>
            <BreadcrumbSchema items={breadcrumbItems(guide)} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd(guide)) }} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqPageJsonLd(guide.faqs)) }} />
        </>
    );
}

function Hero({ guide }: { guide: GuideContent }) {
    const HeroIcon = ICONS[guide.heroIcon];
    return (
        <section className={`${HERO_TONES[guide.heroTone]} text-white py-12 md:py-16`}>
            <div className="container mx-auto px-4">
                <div className="max-w-4xl mx-auto">
                    <nav aria-label="Breadcrumb" className="mb-6">
                        <ol className="flex flex-wrap justify-center gap-2 text-sm text-pink-100">
                            <li><Link href="/" className="hover:underline">Home</Link></li>
                            <li aria-hidden="true">/</li>
                            <li><Link href="/resources" className="hover:underline">Resources</Link></li>
                            <li aria-hidden="true">/</li>
                            <li aria-current="page" className="text-white">{guide.crumb}</li>
                        </ol>
                    </nav>
                    <div className="text-center">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/10 mb-6">
                            <HeroIcon className="w-8 h-8" aria-hidden="true" />
                        </div>
                        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6">{guide.h1}</h1>
                    </div>
                    <p className="rounded-xl bg-white/10 border border-white/20 p-5 md:p-6 text-base md:text-lg leading-relaxed text-white">
                        {guide.quickAnswer}
                    </p>
                    <p className="text-sm text-pink-100 text-center mt-4">
                        Updated <time dateTime={guide.dateModified}>{formatGuideDate(guide.dateModified)}</time>
                    </p>
                </div>
            </div>
        </section>
    );
}

function TableOfContents({ guide }: { guide: GuideContent }) {
    const entries = [
        ...guide.sections.map((section) => ({ id: section.id, label: section.heading })),
        { id: 'faq', label: guide.faqHeading },
        { id: 'sources', label: 'Sources' },
    ];
    return (
        <nav aria-labelledby="on-this-page" className="mb-8 md:mb-12 rounded-xl p-6" style={CARD_STYLE}>
            <p id="on-this-page" className="text-xs font-semibold uppercase tracking-wider mb-3" style={TERTIARY_TEXT}>On this page</p>
            <ol className="grid sm:grid-cols-2 gap-2 text-sm">
                {entries.map((entry) => (
                    <li key={entry.id}>
                        <a href={`#${entry.id}`} className={LINK_CLASS} style={LINK_STYLE}>{entry.label}</a>
                    </li>
                ))}
            </ol>
        </nav>
    );
}

interface SectionCardProps {
    id: string;
    heading: string;
    icon: LucideIcon;
    children: ReactNode;
}

function SectionCard({ id, heading, icon, children }: SectionCardProps) {
    const Icon = icon;
    return (
        <section id={id} aria-labelledby={`${id}-heading`} className="mb-8 md:mb-12 scroll-mt-24">
            <div className="rounded-xl p-6 md:p-8" style={CARD_STYLE}>
                <div className="flex items-center gap-3 mb-4">
                    <Icon className="h-6 w-6 flex-shrink-0" style={LINK_STYLE} aria-hidden="true" />
                    <h2 id={`${id}-heading`} className="text-2xl font-bold" style={PRIMARY_TEXT}>{heading}</h2>
                </div>
                {children}
            </div>
        </section>
    );
}

function ContentSection({ section }: { section: GuideSection }) {
    return (
        <SectionCard id={section.id} heading={section.heading} icon={ICONS[section.icon]}>
            {section.blocks.map((block, index) => <BlockView key={index} block={block} />)}
        </SectionCard>
    );
}

function FaqSection({ guide }: { guide: GuideContent }) {
    return (
        <SectionCard id="faq" heading={guide.faqHeading} icon={HelpCircle}>
            {guide.faqs.map((faq) => (
                <div key={faq.question} className="mb-6 last:mb-0">
                    <h3 data-faq-question="" className="font-semibold mb-2" style={PRIMARY_TEXT}>{faq.question}</h3>
                    <p data-faq-answer="" className="text-sm leading-relaxed" style={SECONDARY_TEXT}><RichText content={faq.answer} /></p>
                </div>
            ))}
        </SectionCard>
    );
}

function SourcesSection({ guide }: { guide: GuideContent }) {
    return (
        <SectionCard id="sources" heading="Sources" icon={Library}>
            <ol className="list-decimal pl-5 space-y-2 text-sm mb-4" style={SECONDARY_TEXT}>
                {guide.sources.map((source) => (
                    <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noopener noreferrer" className={LINK_CLASS} style={LINK_STYLE}>
                            {source.label}
                        </a>
                        : {source.note}
                    </li>
                ))}
            </ol>
            <p className="text-xs" style={TERTIARY_TEXT}>{guide.sourcesNote}</p>
        </SectionCard>
    );
}

function RelatedLinks({ guide }: { guide: GuideContent }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {guide.related.map((link) => (
                <Link key={link.href} href={link.href} className="block p-4 rounded-lg hover:shadow-sm transition-all" style={CARD_STYLE}>
                    <h3 className="font-semibold" style={LINK_STYLE}>{link.title}</h3>
                    <p className="text-sm mt-1" style={SECONDARY_TEXT}>{link.description}</p>
                </Link>
            ))}
        </div>
    );
}

function CtaBand({ guide }: { guide: GuideContent }) {
    return (
        <div className="text-center py-8">
            <h2 className="text-2xl font-bold mb-6" style={PRIMARY_TEXT}>{guide.cta.heading}</h2>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                    href={guide.cta.primary.href}
                    className="inline-block bg-pink-700 text-white px-8 py-3 rounded-lg font-medium hover:bg-pink-800 transition-colors"
                >
                    {guide.cta.primary.text}
                </Link>
                <Link
                    href={guide.cta.secondary.href}
                    className="inline-block bg-white px-8 py-3 rounded-lg font-medium border border-pink-200 hover:bg-pink-50 transition-colors"
                    style={LINK_STYLE}
                >
                    {guide.cta.secondary.text}
                </Link>
            </div>
        </div>
    );
}

export default function GuideView({ guide }: { guide: GuideContent }) {
    return (
        <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
            <StructuredData guide={guide} />
            <Hero guide={guide} />
            <div className="container mx-auto px-4 py-8 md:py-12">
                <div className="max-w-5xl mx-auto">
                    <div className="mb-8">
                        <EditorialByline variant="hero" />
                    </div>
                    <TableOfContents guide={guide} />
                    {guide.sections.map((section) => <ContentSection key={section.id} section={section} />)}
                    <FaqSection guide={guide} />
                    <SourcesSection guide={guide} />
                    <RelatedLinks guide={guide} />
                    <CtaBand guide={guide} />
                </div>
            </div>
        </div>
    );
}
