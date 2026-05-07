create extension if not exists pgcrypto;

create type scroll_status as enum ('generating', 'paused', 'complete');
create type image_status as enum ('succeeded', 'queued', 'generating', 'failed', 'needs_review');
create type job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type job_type as enum ('auto_next', 'regenerate', 'insert_before', 'insert_after');
create type log_level as enum ('success', 'info', 'warning', 'error');

create table if not exists scrolls (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  original_theme text not null,
  optimized_prompt text not null default '',
  status scroll_status not null default 'generating',
  auto_generation_enabled boolean not null default true,
  interval_minutes integer not null default 5 check (interval_minutes > 0),
  overlap_preset text not null default 'standard',
  overlap_ratio numeric(5, 4) not null default 0.125 check (overlap_ratio >= 0 and overlap_ratio <= 0.25),
  image_count integer not null default 0 check (image_count >= 0),
  next_run_at timestamptz not null default now(),
  last_generated_at timestamptz,
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (scroll_id, image_index)
);

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
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  where auto_generation_enabled = true;
