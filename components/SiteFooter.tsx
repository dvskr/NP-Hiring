/**
 * components/SiteFooter.tsx
 *
 * Server wrapper for the site footer (indexing audit TECH-06, M-02): it
 * reads which category landings are indexable right now and hands the
 * footer's two category columns to the client Footer, so the footer never
 * spends a sitewide link on an empty noindexed landing (/jobs/va with
 * "0 positions") and picks a landing back up once it passes the gate.
 * Render this in app/layout.tsx in place of <Footer />; rendered bare, the
 * client Footer falls back to its fixed list of standing landings.
 */
import Footer from '@/components/Footer';
import { selectFooterCategoryColumns } from '@/lib/pseo/footer-category-links';
import { loadFooterIndexableLandings } from '@/lib/pseo/footer-category-loader';

export default async function SiteFooter() {
  const indexable = await loadFooterIndexableLandings();
  return <Footer categoryColumns={selectFooterCategoryColumns(indexable)} />;
}
