import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { AlertTriangle, ArrowRight, Download, Library as LibraryIcon } from 'lucide-react';
import { brand } from '@/config/brand';
import { StickerStage, StickerStyles } from '@/components/sticker';
import GuideCover from '@/components/guides/GuideCover';
import { GUIDES_CSS } from '@/components/guides/styles';
import { GUIDES, getProduct } from '@/lib/guides/catalog';
import { GUIDES_COOKIE, MAX_DOWNLOADS_PER_PURCHASE, parseLibraryCookie } from '@/lib/guides/access';
import { loadLibrary } from '@/lib/guides/library';

/**
 * /guides/library: the guides this browser holds, read from the httpOnly
 * library cookie (lib/guides/access.ts). Private to the browser, so it is
 * never cached, indexed or sent as a referrer; robots.txt disallows it too.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Your Guide Library',
    robots: { index: false, follow: false },
    // The download links must carry a Referer on this site: browsers that
    // send no Sec-Fetch-Site are refused without one (app/api/guides/download).
    // This page's address holds no token, and no other site ever sees it.
    referrer: 'same-origin',
};

const SUPPORT = brand.email.support;

const ERRORS: Readonly<Record<string, string>> = {
    link: 'That library link is not valid. Check that you opened the full link from your guides email.',
    retry: 'We could not open your library just now. Please open the link in your email again in a few minutes.',
    'no-access': 'This browser does not have that guide yet. Open the link in your guides email to add it here.',
    revoked: 'That purchase was refunded or disputed, so its downloads are no longer available.',
    limit: `That purchase has reached its download limit of ${MAX_DOWNLOADS_PER_PURCHASE}. Email ${SUPPORT} and we will reset it.`,
    unavailable: 'That file is not available right now. Please try again in a few minutes.',
    unknown: 'We could not find that guide.',
};

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const supportLink = (
    <a href={`mailto:${SUPPORT}`} className="stk-link" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 'inherit' }}>{SUPPORT}</a>
);

type PageProps = { searchParams: Promise<{ error?: string | string[] }> };

export default async function GuideLibraryPage({ searchParams }: PageProps) {
    const { error } = await searchParams;
    // Own keys only: "?error=__proto__" must not reach an inherited property.
    const errorMessage = typeof error === 'string' && Object.hasOwn(ERRORS, error) ? ERRORS[error] : null;
    const tokens = parseLibraryCookie((await cookies()).get(GUIDES_COOKIE)?.value);
    const library = await loadLibrary(tokens);

    return (
        <>
            <StickerStyles />
            <style>{GUIDES_CSS}</style>
            <StickerStage variant="grid" aria-labelledby="library-heading" maxWidth={900}>
                <div style={{ textAlign: 'left', minHeight: '50vh' }}>
                    <p className="stk-eyebrow">{brand.niche.short} Career Guides</p>
                    <h1 id="library-heading" className="stk-h1 font-heading" style={{ fontSize: 'clamp(1.9rem, 4.4vw, 2.6rem)', marginBottom: '28px' }}>
                        Your guide library
                    </h1>

                    {errorMessage && (
                        <div role="alert" className="stk-card stk-static" style={{ height: 'auto', flexDirection: 'row', gap: '10px', alignItems: 'flex-start', marginBottom: '24px', background: '#FFFBEB' }}>
                            <AlertTriangle size={18} style={{ color: '#B45309', flexShrink: 0, marginTop: '1px' }} aria-hidden="true" />
                            <p style={{ margin: 0, fontSize: '14px', color: '#2b1a1e', lineHeight: 1.55 }}>{errorMessage}</p>
                        </div>
                    )}

                    {library.guides.length === 0 && library.purchases.length > 0 ? (
                        <div className="stk-card stk-static" style={{ height: 'auto', textAlign: 'center' }}>
                            <h2 className="stk-title font-heading">No downloads available</h2>
                            <p style={{ fontSize: '14.5px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                                The purchases in this browser were refunded or disputed, so their guides can no longer be downloaded. Questions? Write to {supportLink}.
                            </p>
                        </div>
                    ) : library.guides.length === 0 ? (
                        <div className="stk-card stk-static" style={{ height: 'auto', textAlign: 'center', alignItems: 'center', gap: '12px', padding: '36px 28px' }}>
                            <LibraryIcon size={34} style={{ color: '#BE185D' }} aria-hidden="true" />
                            <h2 className="stk-title font-heading" style={{ margin: 0 }}>No guides in this browser yet</h2>
                            <p style={{ fontSize: '14.5px', color: '#5A4A42', margin: 0, lineHeight: 1.6, maxWidth: '480px' }}>
                                Already have a guide? Open the link in your guides email and it will appear here. Lost the email? Write to {supportLink} from the address you used.
                            </p>
                            <Link href="/guides" className="stk-link">
                                Browse the guides <ArrowRight size={14} aria-hidden="true" />
                            </Link>
                        </div>
                    ) : (
                        <div className="stk-grid stk-cols-2">
                            {library.guides.map((slug) => {
                                const guide = GUIDES[slug];
                                return (
                                    <article key={slug} className="stk-card stk-static gd-row-card gd-row-card-center">
                                        <div className="gd-cover-wrap"><GuideCover slug={slug} width={80} /></div>
                                        <div style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
                                            <div>
                                                <h2 className="stk-title font-heading" style={{ fontSize: '16px', margin: '0 0 2px' }}>{guide.title}</h2>
                                                <p className="gd-meta">PDF, {guide.pages} pages</p>
                                            </div>
                                            <a href={`/api/guides/download?guide=${slug}`} className="gd-btn gd-btn-auto" style={{ justifySelf: 'start', padding: '10px 16px' }}>
                                                <Download size={15} aria-hidden="true" /> Download PDF
                                            </a>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}

                    {library.purchases.length > 0 && (
                        <section style={{ marginTop: '36px' }} aria-labelledby="library-history">
                            <h2 id="library-history" className="stk-eyebrow" style={{ marginBottom: '10px' }}>Added to this browser</h2>
                            <ul className="stk-list">
                                {library.purchases.map((purchase) => (
                                    <li key={purchase.id}>
                                        <span>{getProduct(purchase.productSlug)?.title ?? 'Guide purchase'}</span>
                                        <span className="stk-list-meta">
                                            {dateFormat.format(purchase.purchasedAt)}
                                            {purchase.revoked ? ' (refunded or disputed)' : ''}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </div>
            </StickerStage>
        </>
    );
}
