-- [DEPRECADO] Ver supabase/complete_install.sql
-- Weekly centralized catalog (Apify) — "Winning Ads Spy" columns + ingest state
-- Run in Supabase SQL Editor after review.

create table if not exists public.spy_ingest_state (
  id int primary key default 1,
  last_completed_at timestamptz,
  last_error text
);

-- Single row
insert into public.spy_ingest_state (id, last_completed_at) values (1, null)
  on conflict (id) do nothing;

alter table public.ads add column if not exists country text default 'US';
alter table public.ads add column if not exists duplicate_count int default 1;
alter table public.ads add column if not exists is_scaled boolean default false;
alter table public.ads add column if not exists is_winner boolean default false;
alter table public.ads add column if not exists creative_url text;
alter table public.ads add column if not exists trending boolean default false;
alter table public.ads add column if not exists spy_ingest_batch text;

create index if not exists ads_country_niche_idx on public.ads (country, niche);
create index if not exists ads_score_idx on public.ads (score desc nulls last);
create index if not exists ads_trending_idx on public.ads (trending) where trending = true;

-- Replaces monolithic ad_library_id unique so the same archive id can exist per country.
drop index if exists ads_ad_library_id_key;
-- One logical row per ad + market (country 'GLOBAL' when null for legacy rows).
create unique index if not exists ads_ad_library_id_country_key
  on public.ads (ad_library_id, (coalesce(country, 'GLOBAL')))
  where ad_library_id is not null;

comment on column public.ads.creative_url is 'Primary image/creative URL from Ad Library (processed output)';
comment on column public.ads.duplicate_count is 'Size of creative duplicate group (same snapshot/image)';
comment on column public.ads.trending is 'Bonus flag: e.g. very recent start or high momentum';
