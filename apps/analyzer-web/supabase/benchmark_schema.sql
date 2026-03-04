create table if not exists public.market_rent_benchmarks (
  id uuid primary key default gen_random_uuid(),
  region_code text not null,
  region_label text not null,
  property_type text not null,
  bedrooms integer not null,
  sqft_band text not null,
  year_built_band text,
  period text not null,
  median_rent numeric not null,
  p25_rent numeric,
  p75_rent numeric,
  source_name text not null,
  source_publisher text not null,
  source_url text not null,
  source_fetched_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists market_rent_benchmarks_lookup_idx
  on public.market_rent_benchmarks (region_code, property_type, bedrooms, period);

create index if not exists market_rent_benchmarks_sizing_idx
  on public.market_rent_benchmarks (region_code, sqft_band, year_built_band);

create table if not exists public.vacancy_benchmarks (
  id uuid primary key default gen_random_uuid(),
  region_code text not null,
  region_label text not null,
  property_type text not null,
  period text not null,
  vacancy_pct numeric not null,
  source_name text not null,
  source_publisher text not null,
  source_url text not null,
  source_fetched_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists vacancy_benchmarks_lookup_idx
  on public.vacancy_benchmarks (region_code, property_type, period);

create table if not exists public.cost_benchmarks (
  id uuid primary key default gen_random_uuid(),
  region_code text not null,
  region_label text not null,
  cost_type text not null,
  property_type text,
  period text not null,
  value_monthly numeric,
  value_annual numeric,
  source_name text not null,
  source_publisher text not null,
  source_url text not null,
  source_fetched_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists cost_benchmarks_lookup_idx
  on public.cost_benchmarks (region_code, cost_type, period);

create index if not exists cost_benchmarks_property_lookup_idx
  on public.cost_benchmarks (region_code, cost_type, property_type, period);
