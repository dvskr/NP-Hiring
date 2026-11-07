/**
 * Upload the store's guide PDFs to the private Supabase Storage bucket the
 * download route signs links from (lib/guides/storage.ts). Run it again after
 * editing a guide: it replaces each file in place, which is how readers get
 * the updated edition.
 *
 * Reads the PDFs from the repo's "NP Guides" folder (each guide's sourceFile
 * in lib/guides/catalog.ts), which is gitignored because the guides are sold,
 * not published in this public repo.
 *
 *   npx ts-node -r tsconfig-paths/register --project scripts/tsconfig.json scripts/guides/upload-guides.ts [flags]
 *
 *   (no flags)        dry run, .env project
 *   --apply           upload to the .env project
 *   --prod            dry run, .env.prod project
 *   --prod --apply    upload to the .env.prod project
 *
 * Run it from the main checkout: worktrees have neither .env nor "NP Guides".
 *
 * Without --prod it uses NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * from .env; with --prod, PROD_SUPABASE_URL and PROD_SUPABASE_SERVICE_ROLE_KEY
 * from .env.prod. In this repo .env points at the PRODUCTION project (there is
 * no dev project), so --apply without --prod uploads to production too: read
 * the host the script prints before passing --apply.
 *
 * Nothing is written without --apply. After uploading it checks the files
 * cannot be fetched without a signed link; set NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (or PROD_SUPABASE_ANON_KEY with --prod) to include the anon-key check.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { GUIDES, GUIDES_BUCKET, GUIDE_SLUGS, type GuideSlug } from '@/lib/guides/catalog';
import { guideObjectKey } from '@/lib/guides/storage';

const SOURCE_DIR = path.resolve(process.cwd(), 'NP Guides');
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const prod = args.has('--prod');

interface Credentials {
    url: string;
    key: string;
}

function credentials(): Credentials {
    if (prod) {
        dotenvConfig({ path: '.env.prod' });
        const url = process.env.PROD_SUPABASE_URL;
        const key = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) throw new Error('PROD_SUPABASE_URL and PROD_SUPABASE_SERVICE_ROLE_KEY must be set in .env.prod');
        return { url, key };
    }
    dotenvConfig({ path: '.env' });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
    return { url, key };
}

interface SourceFile {
    slug: GuideSlug;
    file: string;
    bytes: number;
}

async function sourceFiles(): Promise<SourceFile[]> {
    return Promise.all(
        GUIDE_SLUGS.map(async (slug) => {
            const file = path.join(SOURCE_DIR, GUIDES[slug].sourceFile);
            const info = await stat(file).catch(() => null);
            if (!info?.isFile()) throw new Error(`Missing PDF for ${slug}: ${file}`);
            if (info.size > MAX_FILE_BYTES) throw new Error(`${file} is over ${MAX_FILE_BYTES} bytes`);
            return { slug, file, bytes: info.size };
        }),
    );
}

async function main(): Promise<void> {
    const { url, key } = credentials();
    const host = new URL(url).host;
    console.log(`${apply ? 'UPLOAD' : 'DRY RUN'} to ${prod ? '.env.prod' : '.env'} project ${host}, bucket "${GUIDES_BUCKET}"`);

    const files = await sourceFiles();
    for (const { slug, file, bytes } of files) {
        console.log(`  ${guideObjectKey(slug).padEnd(32)} <- ${path.basename(file)} (${(bytes / 1024).toFixed(0)} KB)`);
    }
    if (!apply) {
        console.log('Dry run only. Pass --apply to upload.');
        return;
    }

    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: bucket } = await supabase.storage.getBucket(GUIDES_BUCKET);
    if (!bucket) {
        const { error } = await supabase.storage.createBucket(GUIDES_BUCKET, {
            public: false,
            allowedMimeTypes: ['application/pdf'],
            fileSizeLimit: MAX_FILE_BYTES,
        });
        if (error) throw new Error(`Could not create bucket: ${error.message}`);
        console.log(`Created private bucket "${GUIDES_BUCKET}"`);
    } else if (bucket.public) {
        throw new Error(`Bucket "${GUIDES_BUCKET}" is public. Make it private before uploading paid files.`);
    }

    for (const { slug, file } of files) {
        const body = await readFile(file);
        const { error } = await supabase.storage
            .from(GUIDES_BUCKET)
            .upload(guideObjectKey(slug), body, { contentType: 'application/pdf', upsert: true, cacheControl: '0' });
        if (error) throw new Error(`Upload failed for ${slug}: ${error.message}`);
        console.log(`  uploaded ${guideObjectKey(slug)}`);
    }
    await verifyPrivate(url, files[0].slug);
    console.log('Done.');
}

/**
 * Proves a file cannot be fetched without a signed link: not by its public
 * URL, and not with the anon key when one is configured (a storage policy
 * added in the dashboard would allow that even on a private bucket).
 */
async function verifyPrivate(url: string, slug: GuideSlug): Promise<void> {
    const key = guideObjectKey(slug);
    const publicRes = await fetch(`${url}/storage/v1/object/public/${GUIDES_BUCKET}/${key}`);
    await publicRes.body?.cancel();
    if (publicRes.ok) throw new Error(`${key} is readable at its public URL. Make the bucket private now.`);

    const anonKey = prod ? process.env.PROD_SUPABASE_ANON_KEY : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anonKey) {
        console.log('  public URL refused; no anon key set, so storage policies were not checked');
        return;
    }
    const anonRes = await fetch(`${url}/storage/v1/object/authenticated/${GUIDES_BUCKET}/${key}`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    await anonRes.body?.cancel();
    if (anonRes.ok) throw new Error(`${key} is readable with the anon key. Remove the storage policy that allows it.`);
    console.log('  verified private: public URL and anon key both refused');
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
