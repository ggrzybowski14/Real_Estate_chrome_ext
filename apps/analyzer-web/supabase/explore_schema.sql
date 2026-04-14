-- Run in Supabase SQL editor (or supabase db push) before using /api/explore/jobs.

create table if not exists public.realtor_explore_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null check (status in ('queued', 'running', 'complete', 'failed')),
  location_query text not null,
  max_price numeric not null,
  radius_miles numeric not null default 10,
  geocoded_label text,
  center_lat double precision,
  center_lon double precision,
  price_max_tier numeric,
  error_message text,
  result_count integer not null default 0,
  meta jsonb
);

create table if not exists public.realtor_explore_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.realtor_explore_jobs (id) on delete cascade,
  mls_number text,
  listing_url text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists realtor_explore_results_job_id_idx on public.realtor_explore_results (job_id);
