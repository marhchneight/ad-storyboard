alter table projects
  add column if not exists aspect_ratio text not null default '1:1';

alter table projects
  drop constraint if exists projects_aspect_ratio_check;

alter table projects
  add constraint projects_aspect_ratio_check check (aspect_ratio in ('1:1', '9:16', '16:9'));
