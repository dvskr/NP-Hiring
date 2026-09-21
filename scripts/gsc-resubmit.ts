/**
 * GSC Resubmit Script
 * 
 * Parses the "Crawled — not indexed" and "Discovered — not indexed" CSV exports
 * from Google Search Console, cross-references with the prod database to check
 * which URLs are still live, then batch-submits valid URLs via IndexNow.
 * 
 * Usage:
 *   npx tsx scripts/gsc-resubmit.ts [--dry] [exportFolder ...]
 *
 * With no folder arguments it picks up every unzipped Coverage drilldown
 * export sitting in the repo root.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.prod', override: true });

import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';

// ─── Config ──────────────────────────────────────────────────────────────────

const PROD_DB_URL = process.env.PROD_DATABASE_URL;
if (!PROD_DB_URL) {
    console.error('❌ PROD_DATABASE_URL not set in .env.prod.');
    process.exit(1);
}

const pool = new pg.Pool({ connectionString: PROD_DB_URL });
const DRY_RUN = process.argv.includes('--dry');

/** Every Coverage drilldown export unzips to a folder with this in its name. */
const GSC_EXPORT_FOLDER_MARKER = 'Coverage-Drilldown';

/**
 * Where the CSV exports live.
 *
 * This used to be two absolute folder names from the donor board's March 2026
 * export. On any other board neither path exists, so the script printed two
 * "Missing" lines, found zero URLs, and still reported success. Take the
 * folders from the command line, or find whatever the owner unzipped into the
 * repo root, which is what Search Console produces by default.
 */
function resolveExportFolders(): string[] {
    const fromArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
    if (fromArgs.length > 0) {
        return fromArgs.map((folder) => path.resolve(process.cwd(), folder));
    }
    return fs
        .readdirSync(process.cwd(), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.includes(GSC_EXPORT_FOLDER_MARKER))
        .map((entry) => path.join(process.cwd(), entry.name))
        .sort();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseCSV(filePath: string): string[] {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return lines.slice(1).map(line => {
        const url = line.split(',')[0].replace(/^"|"$/g, '').trim();
        return url;
    }).filter(u => u.startsWith('https://'));
}

function extractPathname(url: string): string | null {
    try { return new URL(url).pathname; } catch { return null; }
}

function extractJobId(pathname: string): string | null {
    const match = pathname.match(/\/jobs\/[^/]+-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
    return match ? match[1] : null;
}

// ─── IndexNow submission ─────────────────────────────────────────────────────

/** Engines cap a submission at 10,000 URLs, so chunk before handing over. */
const INDEXNOW_CHUNK = 10000;

/**
 * Submit through lib/indexnow.ts, the board's only IndexNow client.
 *
 * This script used to carry a private copy that read INDEXNOW_KEY alone, with
 * no fallback to INDEXNOW_API_KEY, hardcoded the donor board's host, and
 * skipped the same-host filter and the logging the shared client does. The one
 * manual resubmit tool an owner reaches for after configuring credentials was
 * therefore the one place most likely to silently submit nothing.
 *
 * The import is dynamic on purpose: lib/indexnow.ts captures its host from
 * NEXT_PUBLIC_BASE_URL at module load, and a static import would be evaluated
 * before the dotenv.config() calls at the top of this file have run.
 */
async function submitToIndexNow(
    urls: string[],
): Promise<{ success: boolean; submitted: number; error?: string }> {
    const { pingIndexNow } = await import('../lib/indexnow');

    let totalSubmitted = 0;
    for (let i = 0; i < urls.length; i += INDEXNOW_CHUNK) {
        const result = await pingIndexNow(urls.slice(i, i + INDEXNOW_CHUNK));
        totalSubmitted += result.submitted;
        if (!result.ok) {
            return { success: false, submitted: totalSubmitted, error: result.reason ?? 'rejected' };
        }
    }

    return { success: true, submitted: totalSubmitted };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    console.log('🔍 GSC URL Resubmission Script');
    console.log(`Mode: ${DRY_RUN ? '🏜️ DRY RUN' : '🚀 LIVE'}`);
    console.log('─'.repeat(60));

    // 1. Parse all CSV files
    const folders = resolveExportFolders();
    if (folders.length === 0) {
        console.error(`❌ No Search Console export folders found. Unzip the Coverage drilldown exports into ${process.cwd()}, or pass their paths as arguments.`);
        await pool.end();
        process.exitCode = 1;
        return;
    }

    let allUrls: string[] = [];
    for (const folder of folders) {
        const csvPath = path.join(folder, 'Table.csv');
        if (!fs.existsSync(csvPath)) {
            console.log(`⚠️ Missing: ${csvPath}`);
            continue;
        }
        const metaPath = path.join(folder, 'Metadata.csv');
        const meta = fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf-8') : '';
        const issue = meta.split('\n').filter(l => l.includes('Issue')).map(l => l.split(',')[1]).join(', ');
        console.log(`📂 ${path.basename(folder)}`);
        console.log(`   Issue: ${issue}`);

        const urls = parseCSV(csvPath);
        console.log(`   URLs: ${urls.length}`);
        allUrls.push(...urls);
    }

    allUrls = [...new Set(allUrls)];
    console.log(`\n📊 Total unique URLs: ${allUrls.length}`);

    // 2. Categorize URLs
    const jobUrls: { url: string; jobId: string }[] = [];
    const otherUrls: string[] = [];

    for (const url of allUrls) {
        const pathname = extractPathname(url);
        if (!pathname) continue;
        const jobId = extractJobId(pathname);
        if (jobId) {
            jobUrls.push({ url, jobId });
        } else {
            otherUrls.push(url);
        }
    }

    console.log(`\n📋 Breakdown:`);
    console.log(`   Job pages:   ${jobUrls.length}`);
    console.log(`   Other pages: ${otherUrls.length}`);

    // 3. Cross-reference with prod DB
    console.log(`\n🔗 Connecting to production database...`);

    const jobIds = jobUrls.map(j => j.jobId);
    const publishedJobIds = new Set<string>();

    // Query in batches of 500
    for (let i = 0; i < jobIds.length; i += 500) {
        const batch = jobIds.slice(i, i + 500);
        const result = await pool.query(
            `SELECT id FROM jobs WHERE id = ANY($1) AND is_published = true`,
            [batch]
        );
        result.rows.forEach((row: { id: string }) => publishedJobIds.add(row.id));
    }

    const validJobUrls = jobUrls.filter(j => publishedJobIds.has(j.jobId));
    const expiredJobUrls = jobUrls.filter(j => !publishedJobIds.has(j.jobId));

    console.log(`\n✅ Published job pages:  ${validJobUrls.length}`);
    console.log(`❌ Expired/missing jobs: ${expiredJobUrls.length}`);

    // Combine all valid URLs
    const validUrls = [
        ...validJobUrls.map(j => j.url),
        ...otherUrls,
    ];

    console.log(`\n📤 URLs to resubmit: ${validUrls.length}`);
    console.log(`🚫 Skipped (expired): ${expiredJobUrls.length}`);

    if (DRY_RUN) {
        console.log('\n🏜️ DRY RUN — not submitting. Sample valid URLs:');
        validUrls.slice(0, 20).forEach(u => console.log(`   ✅ ${u}`));
        if (validUrls.length > 20) console.log(`   ... and ${validUrls.length - 20} more`);

        console.log('\nSample expired job URLs (will skip):');
        expiredJobUrls.slice(0, 10).forEach(j => console.log(`   ❌ ${j.url}`));

        await pool.end();
        return;
    }

    // 4. Submit via IndexNow (instantly reaches Bing, Yandex, Seznam, Naver)
    console.log('\n🚀 Submitting to IndexNow...');
    const indexNowResult = await submitToIndexNow(validUrls);
    console.log(`   ${indexNowResult.success ? '✅' : '❌'} IndexNow: ${indexNowResult.submitted} URLs submitted`);
    if (indexNowResult.error) console.log(`   Error: ${indexNowResult.error}`);

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('📊 RESUBMISSION SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Total URLs in GSC exports: ${allUrls.length}`);
    console.log(`Still published (valid):   ${validUrls.length}`);
    console.log(`Expired (skipped):         ${expiredJobUrls.length}`);
    console.log(`IndexNow submitted:        ${indexNowResult.submitted}`);

    await pool.end();
}

main().catch(err => {
    console.error('Fatal error:', err);
    pool.end();
    process.exit(1);
});
