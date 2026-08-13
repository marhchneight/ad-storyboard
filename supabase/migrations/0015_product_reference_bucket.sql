-- New bucket for user-uploaded product reference photos, used to keep AI
-- image generation visually consistent with a real product's appearance
-- (see upload-product-reference edge function). Public read (same as
-- storyboard-images) so cut generation and the frontend can load images by
-- URL; no client write policy — writes only happen server-side via the
-- edge function's service-role key, matching the storyboard-images bucket's
-- post-0009 state.
insert into storage.buckets (id, name, public) values ('product-references', 'product-references', true)
  on conflict (id) do nothing;

create policy "product_references_read" on storage.objects
  for select using (bucket_id = 'product-references');
