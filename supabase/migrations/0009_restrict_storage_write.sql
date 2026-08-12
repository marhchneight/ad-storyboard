-- storyboard_images_write allowed ANY client (including unauthenticated
-- requests using the public anon key) to insert arbitrary objects into the
-- storyboard-images bucket, with no ownership or ownership-adjacent check.
-- The only legitimate writer is the generate-image edge function, which
-- uploads via the service role key and therefore bypasses RLS entirely —
-- so this policy was pure unused attack surface. Public read stays: cut
-- image URLs are fetched directly by the browser (thumbnails, PDF export,
-- ZIP export) without an auth header.
drop policy if exists "storyboard_images_write" on storage.objects;
