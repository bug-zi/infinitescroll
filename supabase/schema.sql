create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'scroll_status') then
    create type scroll_status as enum ('generating', 'paused', 'complete');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'image_status') then
    create type image_status as enum ('succeeded', 'queued', 'generating', 'failed', 'needs_review');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_status') then
    create type job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_type') then
    create type job_type as enum ('auto_next', 'regenerate', 'insert_before', 'insert_after');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'log_level') then
    create type log_level as enum ('success', 'info', 'warning', 'error');
  end if;
end
$$;

create table if not exists scrolls (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  original_theme text not null,
  optimized_prompt text not null default '',
  generation_mode text not null default 'free' check (generation_mode in ('free', 'story')),
  story_template text,
  story_template_version text,
  story_total_frames integer check (story_total_frames is null or story_total_frames > 0),
  script_summary text,
  character_bible text,
  status scroll_status not null default 'generating',
  auto_generation_enabled boolean not null default true,
  interval_minutes integer not null default 5 check (interval_minutes > 0),
  overlap_preset text not null default 'standard',
  overlap_ratio numeric(5, 4) not null default 0.125 check (overlap_ratio >= 0 and overlap_ratio <= 0.25),
  image_count integer not null default 0 check (image_count >= 0),
  next_run_at timestamptz not null default now(),
  last_generated_at timestamptz,
  thumbnail_url text,
  archived_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists scrolls
  add column if not exists generation_mode text not null default 'free',
  add column if not exists story_template text,
  add column if not exists story_template_version text,
  add column if not exists story_total_frames integer,
  add column if not exists script_summary text,
  add column if not exists character_bible text,
  add column if not exists archived_at timestamptz,
  add column if not exists purge_after timestamptz;

create table if not exists scroll_story_frames (
  id uuid primary key default gen_random_uuid(),
  scroll_id uuid not null references scrolls(id) on delete cascade,
  frame_index integer not null check (frame_index > 0),
  chapter text not null default '',
  title text not null,
  scene text not null,
  characters jsonb not null default '[]'::jsonb,
  location text not null default '',
  mood text not null default '',
  continuity_anchor text not null default '',
  forbidden text not null default '',
  visual_prompt_hint text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scroll_id, frame_index)
);

create table if not exists scroll_images (
  id uuid primary key default gen_random_uuid(),
  scroll_id uuid not null references scrolls(id) on delete cascade,
  image_index integer not null check (image_index > 0),
  status image_status not null default 'queued',
  full_image_url text not null,
  prompt text not null,
  model text not null,
  file_size_bytes integer,
  width integer not null,
  height integer not null,
  ratio_label text not null,
  visible_crop jsonb not null,
  overlap_crop jsonb not null,
  new_content_crop jsonb not null,
  has_stitch_warning boolean not null default false,
  archived_at timestamptz,
  purge_after timestamptz,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (scroll_id, image_index)
);

alter table if exists scroll_images
  add column if not exists archived_at timestamptz,
  add column if not exists purge_after timestamptz;

create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  scroll_id uuid not null references scrolls(id) on delete cascade,
  target_index integer not null check (target_index > 0),
  type job_type not null,
  status job_status not null default 'queued',
  scheduled_for timestamptz not null,
  locked_at timestamptz,
  locked_by text,
  retry_count integer not null default 0,
  creative_plan jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists generation_jobs
  add column if not exists creative_plan jsonb;

create table if not exists generation_logs (
  id uuid primary key default gen_random_uuid(),
  scroll_id uuid not null references scrolls(id) on delete cascade,
  level log_level not null default 'info',
  message text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists one_running_job_per_scroll
  on generation_jobs(scroll_id)
  where status = 'running';

create index if not exists generation_jobs_due_idx
  on generation_jobs(status, scheduled_for);

create index if not exists scrolls_due_idx
  on scrolls(auto_generation_enabled, next_run_at)
  where auto_generation_enabled = true and archived_at is null;

create index if not exists scrolls_archive_purge_idx
  on scrolls(purge_after)
  where archived_at is not null;

create index if not exists scroll_images_archive_purge_idx
  on scroll_images(purge_after)
  where archived_at is not null;
