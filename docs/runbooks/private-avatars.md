# Runbook: make the avatars bucket private

> Audience: whoever runs the Supabase project. Do this AFTER the deploy that adds `lib/avatar-url.ts` is live.
> Last updated: 2026-11-25.

Profile photos live in the Supabase Storage bucket `avatars`, and it holds nothing else: its one writer is the profile photo upload (`uploadAvatar` in `lib/supabase-storage.ts`); company logos, site images and email images each have their own bucket. Since `lib/avatar-url.ts`, the app never serves a photo's public URL. Every avatar in a response is a signed URL that expires after an hour, minted only where the route has decided to show the photo. The bucket is still public, so a public URL someone kept from before still opens. Making the bucket private closes that.

The code works with the bucket public or private, so the order is: deploy first, bucket second. Made private before the deploy, every photo breaks, because the old code serves public URLs.

## Before

1. The deploy is live. Signed in on the live site, open Settings and copy the photo's image address. It carries `sign%2Favatars` or `/object/sign/avatars/` and a `token=`, not `/object/public/avatars/`.
2. Only profile photos are in the bucket. Storage, `avatars`: the top level holds only the upload prefixes (`prod`, and `dev` or `local` if used), each holding account id folders.
3. Nothing public points into it. In the SQL editor, read only:

   ```sql
   select 'employer_jobs' as source, count(*) from employer_jobs where company_logo_url like '%/object/public/avatars/%'
   union all select 'companies', count(*) from companies where logo_url like '%/object/public/avatars/%'
   union all select 'blog_posts', count(*) from blog_posts where image_url like '%/object/public/avatars/%';
   ```

   Every count must be 0. If one is not, stop: that image would break on a public page.
4. Note the storage policies that name the bucket, read only:

   ```sql
   select policyname, cmd, roles, qual, with_check
   from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and (coalesce(qual, '') ilike '%avatars%' or coalesce(with_check, '') ilike '%avatars%');
   ```

   Copy the output somewhere safe: the rollback recreates what you remove.

## Make it private

1. Storage, `avatars`, Edit bucket: turn off "Public bucket" and save. The SQL equivalent is `update storage.buckets set public = false where id = 'avatars';`.
2. Drop any SELECT policy from step 4 that lets `anon`, `authenticated` or `public` read the bucket. A private bucket still serves through the API to any role a policy allows, and the anon key ships in every page, so such a policy keeps every photo readable. The app needs no policy: it signs with the service role key, which bypasses row level security. Leave the other policies alone.

## Check

1. A public URL from before now fails: `https://<project>.supabase.co/storage/v1/object/public/avatars/<a key>` answers an error (bucket or object not found), not the image.
2. Photos still show: Settings, the header menu, the messages inbox and a thread (both sides), and for an employer the talent pool, a candidate page and saved candidates (unlocked candidates only), and the applicants view.
3. A new photo uploaded in Settings shows at once.

## Rollback

Turn "Public bucket" back on (`update storage.buckets set public = true where id = 'avatars';`) and recreate any policy dropped above from the copy made in step 4. Nothing in the app changes: it signs links whether the bucket is public or private, and the stored `avatar_url` values were never touched. If photos break after the deploy itself, with the bucket still public, roll back the deploy; the bucket needs nothing.
