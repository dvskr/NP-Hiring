/**
 * Bulk Search Engine Indexing Script
 *
 * Submits the site's URLs to Bing and IndexNow, and its job posting pages to
 * Google. The Google Indexing API accepts only pages that carry JobPosting
 * markup (see isGoogleIndexingEligibleUrl in lib/search-indexing.ts), so the
 * landings, blog posts and static pages in the sitemap go to Bing and
 * IndexNow only.
 *
 * Usage:
 *   npx tsx scripts/google-index.ts                    # Submit all URLs to all engines
 *   npx tsx scripts/google-index.ts --url <job page URL>  # Single URL
 *   npx tsx scripts/google-index.ts --engine google     # Google only (job pages)
 *   npx tsx scripts/google-index.ts --engine bing       # Bing only
 *   npx tsx scripts/google-index.ts --engine indexnow   # IndexNow only
 *   npx tsx scripts/google-index.ts --skip 500          # Skip the first 500 sitemap URLs
 *
 * Requires env vars in .env.local:
 *   GOOGLE_INDEXING_CREDENTIALS: Google service account JSON
 *   BING_WEBMASTER_API_KEY: Bing Webmaster Tools API key
 *   INDEXNOW_API_KEY: IndexNow key (must match public/{key}.txt)
 *
 * Quotas: Google takes at most the new-content lane's per-run grant
 * (GOOGLE_INDEXING_LANES['new-content'].perInvocation), job pages only;
 * Bing 10,000/day; IndexNow 10,000/batch.
 */

import * as dotenv from 'dotenv';
import {
    pingGoogle,
    pingBingBatch,
    pingIndexNow,
    pingAllSearchEnginesBatch,
    isGoogleIndexingEligibleUrl,
    GOOGLE_INDEXING_LANES,
} from '../lib/search-indexing';
import { brand } from '../config/brand';

dotenv.config({ path: '.env.local' });

// The board's own domain from the brand config, never a literal: this repo is
// forked per board, and a hardcoded domain submits another board's URLs.
const BASE_URL = brand.baseUrl;

// Google spends the new-content lane, the same lane app/api/cron/index-urls
// uses for new job pages, so a manual run is held to that lane's per-run
// grant rather than the project's whole daily quota.
const GOOGLE_CAP = GOOGLE_INDEXING_LANES['new-content'].perInvocation;

// ─── Fetch All URLs ──────────────────────────────────────────────────────────

async function getAllUrls(): Promise<string[]> {
    const urls: string[] = [];

    // Static pages
    const staticPages = [
        '', '/jobs', '/blog', '/for-employers', '/for-job-seekers',
        '/about', '/contact', '/faq', '/privacy', '/terms',
    ];
    urls.push(...staticPages.map(p => `${BASE_URL}${p}`));

    // Fetch sitemap for dynamic URLs
    try {
        const sitemapResponse = await fetch(`${BASE_URL}/sitemap.xml`);
        if (sitemapResponse.ok) {
            const sitemapText = await sitemapResponse.text();
            const urlMatches = sitemapText.match(/<loc>(.*?)<\/loc>/g) || [];
            const sitemapUrls = urlMatches
                .map(match => match.replace(/<\/?loc>/g, ''))
                .filter(url => !urls.includes(url));
            urls.push(...sitemapUrls);
        } else {
            console.warn('⚠️  Could not fetch sitemap.xml, using static pages only');
        }
    } catch (error) {
        console.warn('⚠️  Error fetching sitemap:', error);
    }

    return [...new Set(urls)];
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);

    let singleUrl: string | null = null;
    let engine: 'all' | 'google' | 'bing' | 'indexnow' = 'all';
    let skip = 0;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--url' && args[i + 1]) {
            singleUrl = args[i + 1];
            i++;
        } else if (args[i] === '--engine' && args[i + 1]) {
            const validEngines = ['all', 'google', 'bing', 'indexnow'];
            const engineArg = args[i + 1];
            if (!validEngines.includes(engineArg)) {
                console.error(`❌ Invalid engine: "${engineArg}". Valid options: ${validEngines.join(', ')}`);
                process.exit(1);
            }
            engine = engineArg as typeof engine;
            i++;
        } else if (args[i] === '--skip' && args[i + 1]) {
            skip = parseInt(args[i + 1], 10) || 0;
            i++;
        }
    }

    console.log('🔍 Search Engine Bulk Indexing');
    console.log('─'.repeat(50));
    console.log(`   Engines: ${engine === 'all' ? 'Google + Bing + IndexNow' : engine}`);

    // Check configured engines
    const configured = {
        google: !!process.env.GOOGLE_INDEXING_CREDENTIALS,
        bing: !!process.env.BING_WEBMASTER_API_KEY,
        indexnow: !!process.env.INDEXNOW_API_KEY,
    };
    console.log(`   Google:   ${configured.google ? '✅ configured' : '⚠️  GOOGLE_INDEXING_CREDENTIALS not set'}`);
    console.log(`   Bing:     ${configured.bing ? '✅ configured' : '⚠️  BING_WEBMASTER_API_KEY not set'}`);
    console.log(`   IndexNow: ${configured.indexnow ? '✅ configured' : '⚠️  INDEXNOW_API_KEY not set'}`);
    console.log('');

    // Get URLs
    let urls: string[];
    if (singleUrl) {
        urls = [singleUrl];
        console.log(`📌 Single URL: ${singleUrl}\n`);
    } else {
        console.log('📋 Fetching all site URLs from sitemap...');
        urls = await getAllUrls();
        console.log(`   Found ${urls.length} total URLs`);
        if (skip > 0) {
            urls = urls.slice(skip);
            console.log(`   Skipping first ${skip}, processing ${urls.length} remaining URLs`);
        }
        console.log('');
    }

    // Only job posting pages may go to Google; lib/search-indexing.ts refuses
    // anything else, and a refusal would only clutter the output.
    const googleUrls = urls.filter(isGoogleIndexingEligibleUrl);

    if (engine === 'all') {
        console.log(`   Google takes job posting pages only: ${googleUrls.length} of ${urls.length} URLs qualify.`);
        if (googleUrls.length > GOOGLE_CAP) {
            console.warn(`⚠️  Google capped at ${GOOGLE_CAP} per run on the new-content budget. Submitting ${GOOGLE_CAP} of ${googleUrls.length} job pages to Google.`);
        }
        console.log(`   Bing and IndexNow will get all ${urls.length} URLs.\n`);

        console.log('🚀 Submitting to all engines...\n');

        // The batch helper takes the whole list because Bing and IndexNow
        // want all of it; its Google leg refuses the non-job pages itself,
        // before any network and without spending the lane.
        const results = await pingAllSearchEnginesBatch(urls, 'new-content');

        // Summary. Google is scored against the job pages only, so the
        // refused landings and posts do not read as failures.
        const googleEligible = new Set(googleUrls);
        const googleResults = results.google.filter(r => googleEligible.has(r.url));
        const gSuccess = googleResults.filter(r => r.success).length;
        const bSuccess = results.bing.filter(r => r.success).length;
        const iSuccess = results.indexNow.filter(r => r.success).length;

        console.log('\n' + '─'.repeat(50));
        console.log('📊 Results:');
        console.log(`   Google:   ${gSuccess}/${googleResults.length} job pages submitted`);
        console.log(`   Bing:     ${bSuccess}/${results.bing.length} submitted`);
        console.log(`   IndexNow: ${iSuccess}/${results.indexNow.length} submitted`);
    } else {
        console.log(`🚀 Submitting ${urls.length} URLs to ${engine}...\n`);

        let success = 0;
        let total = urls.length;

        if (engine === 'google') {
            if (googleUrls.length < urls.length) {
                console.log(`   Skipping ${urls.length - googleUrls.length} URLs that are not job posting pages.`);
            }
            const capped = googleUrls.slice(0, GOOGLE_CAP);
            total = capped.length;
            for (let i = 0; i < capped.length; i++) {
                const result = await pingGoogle(capped[i], 'URL_UPDATED', 'new-content');
                if (result.success) {
                    console.log(`  ✅ [${i + 1}/${total}] ${capped[i]}`);
                    success++;
                } else {
                    console.log(`  ❌ [${i + 1}/${total}] ${capped[i]}: ${result.error}`);
                }
                await new Promise(r => setTimeout(r, 100));
            }
        } else if (engine === 'bing') {
            const results = await pingBingBatch(urls);
            success = results.filter(r => r.success).length;
            for (const r of results) {
                console.log(`  ${r.success ? '✅' : '❌'} ${r.url}${r.error ? ': ' + r.error : ''}`);
            }
        } else if (engine === 'indexnow') {
            const results = await pingIndexNow(urls);
            success = results.filter(r => r.success).length;
            console.log(`  ${success > 0 ? '✅' : '❌'} Batch submitted ${urls.length} URLs`);
        }

        console.log('\n' + '─'.repeat(50));
        console.log(`📊 ${engine}: ${success}/${total} submitted`);
    }
}

main().catch((error) => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
});
