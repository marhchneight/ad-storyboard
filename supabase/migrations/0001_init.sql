create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  style text not null check (style in ('sketch', 'animation', 'live_action')),
  overall_prompt text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table cuts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  order_index int not null,
  scene_description text not null default '',
  dialogue text not null default '',
  camera_direction text not null default '',
  image_url text,
  generation_status text not null default 'idle' check (generation_status in ('idle', 'generating', 'done', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table projects enable row level security;
alter table cuts enable row level security;

create policy "projects_owner_all" on projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "cuts_owner_all" on cuts
  for all using (
    exists (select 1 from projects p where p.id = cuts.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = cuts.project_id and p.user_id = auth.uid())
  );

insert into storage.buckets (id, name, public) values ('storyboard-images', 'storyboard-images', true)
  on conflict (id) do nothing;

create policy "storyboard_images_read" on storage.objects
  for select using (bucket_id = 'storyboard-images');

create policy "storyboard_images_write" on storage.objects
  for insert with check (bucket_id = 'storyboard-images');
