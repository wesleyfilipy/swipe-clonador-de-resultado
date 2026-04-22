-- [DEPRECADO] Ver supabase/complete_install.sql
-- Migração: mineração automática, score, status, storage paths
-- Rode no SQL Editor após schema.sql

alter table public.ads
  add column if not exists ad_library_id text,
  add column if not exists start_date timestamptz,
  add column if not exists score numeric default 0,
  add column if not exists status text default 'testing',
  add column if not exists last_seen_at timestamptz default now(),
  add column if not exists page_name text,
  add column if not exists landing_domain text,
  add column if not exists appearance_count int default 1,
  add column if not exists domain_frequency int default 1,
  add column if not exists landing_ok boolean default true,
  add column if not exists vsl_html_path text,
  add column if not exists video_storage_path text,
  add column if not exists thumbnail_storage_path text;

update public.ads set status = 'testing' where status is null or status not in ('scaled', 'testing', 'weak');

alter table public.ads drop constraint if exists ads_status_check;
alter table public.ads add constraint ads_status_check
  check (status in ('scaled', 'testing', 'weak'));

update public.ads
set ad_library_id = coalesce(ad_library_id, facebook_ad_id)
where ad_library_id is null and facebook_ad_id is not null;

create unique index if not exists ads_ad_library_id_key on public.ads (ad_library_id) where ad_library_id is not null;

insert into storage.buckets (id, name, public)
values ('creatives', 'creatives', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "creatives_public_read" on storage.objects;
create policy "creatives_public_read"
on storage.objects for select
using (bucket_id = 'creatives');

create or replace function public.bot_cleanup_ads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.ads
  where coalesce(last_seen_at, to_timestamp(0)) < now() - interval '3 days'
     or coalesce(score, 0) < 8
     or landing_ok = false;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.bot_cleanup_ads() from public;
grant execute on function public.bot_cleanup_ads() to service_role;
