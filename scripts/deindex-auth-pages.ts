/**
 * GSC Indexing Crisis (P2.3): one-shot removal signal for the 5 auth pages
 * stuck in "Indexed, though blocked by robots.txt".
 *
 * Run AFTER deploying the robots.ts change that unblocks these paths.
 * Sequence:
 *   1. Deploy the P2.3 robots.ts change → crawlers can now fetch these paths
 *      and see their X-Robots-Tag: noindex header
 *   2. Run this script → IndexNow tells Bing, Yandex and Seznam to recrawl
 *   3. For Google, file each URL in the Search Console Removals tool
 *      (Indexing > Removals > New request). The noindex header is what keeps
 *      a page out once Google recrawls; the Removals tool hides it sooner.
 *   4. Wait ~14 days → Google re-crawls, sees X-Robots-Tag: noindex, drops
 *   5. Manually re-add paths to FULL_DISALLOW (see AUTH_REBLOCK_DATE in robots.ts)
 *
 * No Google Indexing API call is made. That API accepts only job posting
 * pages, and lib/search-indexing.ts refuses everything else for every caller,
 * because a misuse sanction lands on the whole Cloud project that also
 * carries the site's real job publishes and removals.
 *
 * Run:
 *   npx tsx scripts/deindex-auth-pages.ts          # submit
 *   npx tsx scripts/deindex-auth-pages.ts --dry    # print what would be submitted
 */
import { config as dotenvConfig } from 'dotenv';
import { brand } from '@/config/brand';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });
dotenvConfig({ path: '.env.prod' });

const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run');
// The board's own domain from the brand config, never a literal: this repo is
// forked per board, and a hardcoded domain would signal another board's URLs.
const BASE = brand.baseUrl;

// The 5 URLs from GSC's "Indexed, though blocked by robots.txt" drilldown
// (GSC ISSUES/https___pmhnphiring.com_-Coverage-Drilldown-2026-05-04 (3)/Table.csv).
const AUTH_URLS = [
    `${BASE}/signup`,
    `${BASE}/messages`,
    `${BASE}/job-alerts/manage`,
    `${BASE}/employer/login`,
    `${BASE}/saved`,
];

async function main() {
    console.log(`P2.3: de-indexing ${AUTH_URLS.length} auth URLs.`);
    for (const url of AUTH_URLS) console.log(`  - ${url}`);

    if (DRY) {
        console.log(`\n--dry: not submitting. Re-run without --dry to submit.`);
        return;
    }

    // PRE-FLIGHT: confirm robots.txt actually permits crawling these paths.
    // A crawler only sees the noindex header on a path it is allowed to
    // fetch, so a recrawl signal sent while FULL_DISALLOW still blocks them
    // has nothing to act on.
    try {
        const robotsRes = await fetch(`${BASE}/robots.txt`);
        if (robotsRes.ok) {
            const txt = await robotsRes.text();
            const stillBlocked = AUTH_URLS.filter((u) => {
                const path = new URL(u).pathname;
                // crude line scan
                return new RegExp(`^Disallow:\\s*${path.replace(/[/.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*$`, 'm').test(txt);
            });
            if (stillBlocked.length > 0) {
                console.error(`\n⚠ robots.txt still blocks the following paths:`);
                for (const u of stillBlocked) console.error(`    ${u}`);
                console.error(`\nDeploy the P2.3 robots.ts change first, then re-run this script.`);
                process.exit(1);
            }
            console.log(`\nrobots.txt pre-flight: OK, paths are now crawlable.`);
        }
    } catch (err) {
        console.warn(`Could not fetch robots.txt for pre-flight (${err}). Proceeding anyway.`);
    }

    const { pingIndexNow } = await import('@/lib/search-indexing');

    console.log(`\nIndexNow batch...`);
    const indexNowResults = await pingIndexNow(AUTH_URLS);
    const indexNowOk = indexNowResults.filter((r) => r.success).length;

    console.log(`\nDone.`);
    console.log(`  IndexNow: ${indexNowOk}/${indexNowResults.length} ok`);
    console.log(`\nGoogle: not contacted. The Indexing API accepts job posting pages only.`);
    console.log(`Each page already sends X-Robots-Tag: noindex, which removes it once Google recrawls.`);
    console.log(`To hide them sooner, file each URL above in Search Console:`);
    console.log(`  Indexing > Removals > New request.`);
    console.log(`\nNext: wait ~14 days, re-pull the GSC Coverage report, and confirm the`);
    console.log(`"Indexed, though blocked by robots.txt" count drops to 0.`);
    console.log(`Then re-add paths to FULL_DISALLOW per AUTH_REBLOCK_DATE in robots.ts.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
