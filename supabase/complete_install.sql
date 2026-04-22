-- =============================================================================
-- ESPIÃO NUTRA / swipe — INSTALAÇÃO ÚNICA NO SUPABASE (um único ficheiro)
-- Cole tudo no SQL Editor e executa. É idempotente (pode voltar a correr).
-- Substitui: schema.sql, migration_*.sql (um único ficheiro de referência)
-- =============================================================================
-- ANTES (opcional, projeto novo / reset): apagar tabelas antigas se quiseres
-- começar do zero. Em projetos a mexer, NÃO apagues — só executa o script.
-- =============================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Tabelas base
-- ---------------------------------------------------------------------------

create table if not exists public.users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  created_at timestamptz default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

create table if not exists public.ads (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  niche text not null default 'geral',
  video_url text,
  vsl_url text,
  thumbnail text,
  ad_copy text,
  views_day int default 0,
  views_week int default 0,
  active_days int default 0,
  facebook_ad_id text,
  mine_source text default 'manual',
  ad_library_id text,
  start_date timestamptz,
  score numeric default 0,
  status text not null default 'testing',
  last_seen_at timestamptz default now(),
  page_name text,
  landing_domain text,
  appearance_count int default 1,
  domain_frequency int default 1,
  landing_ok boolean default true,
  vsl_html_path text,
  video_storage_path text,
  thumbnail_storage_path text,
  -- Spy / feed avançado
  country text default 'US',
  duplicate_count int default 1,
  is_scaled boolean default false,
  is_winner boolean default false,
  creative_url text,
  trending boolean default false,
  spy_ingest_batch text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Colunas que possam faltar (instalação por migrações antigas)
alter table public.ads add column if not exists mine_source text default 'manual';
alter table public.ads add column if not exists ad_library_id text;
alter table public.ads add column if not exists start_date timestamptz;
alter table public.ads add column if not exists score numeric default 0;
alter table public.ads add column if not exists status text default 'testing';
alter table public.ads add column if not exists last_seen_at timestamptz default now();
alter table public.ads add column if not exists page_name text;
alter table public.ads add column if not exists landing_domain text;
alter table public.ads add column if not exists appearance_count int default 1;
alter table public.ads add column if not exists domain_frequency int default 1;
alter table public.ads add column if not exists landing_ok boolean default true;
alter table public.ads add column if not exists vsl_html_path text;
alter table public.ads add column if not exists video_storage_path text;
alter table public.ads add column if not exists thumbnail_storage_path text;
alter table public.ads add column if not exists country text default 'US';
alter table public.ads add column if not exists duplicate_count int default 1;
alter table public.ads add column if not exists is_scaled boolean default false;
alter table public.ads add column if not exists is_winner boolean default false;
alter table public.ads add column if not exists creative_url text;
alter table public.ads add column if not exists trending boolean default false;
alter table public.ads add column if not exists spy_ingest_batch text;

update public.ads set status = 'testing' where status is null or status not in ('scaled', 'testing', 'weak');
update public.ads
set ad_library_id = coalesce(ad_library_id, facebook_ad_id)
where ad_library_id is null and facebook_ad_id is not null;

-- Índices
create index if not exists ads_niche_idx on public.ads (niche);
create index if not exists ads_views_week_idx on public.ads (views_week desc);
create index if not exists ads_mine_source_idx on public.ads (mine_source);
create index if not exists ads_country_niche_idx on public.ads (country, niche);
create index if not exists ads_score_idx on public.ads (score desc nulls last);
create index if not exists ads_trending_idx on public.ads (trending) where trending = true;

-- Unicidade: o mesmo ad_library_id pode repetir-se por país
drop index if exists ads_ad_library_id_key;
create unique index if not exists ads_ad_library_id_country_key
  on public.ads (ad_library_id, (coalesce(country, 'GLOBAL')))
  where ad_library_id is not null;

-- Estado ingest spy (semanal)
create table if not exists public.spy_ingest_state (
  id int primary key default 1,
  last_completed_at timestamptz,
  last_error text
);
insert into public.spy_ingest_state (id, last_completed_at) values (1, null)
  on conflict (id) do nothing;

create table if not exists public.transcriptions (
  id uuid primary key default uuid_generate_v4(),
  ad_id uuid not null references public.ads (id) on delete cascade,
  type text not null check (type in ('creative', 'vsl')),
  text text not null,
  created_at timestamptz default now(),
  unique (ad_id, type)
);

create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'inactive',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz default now(),
  unique (user_id)
);

create table if not exists public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  ad_id uuid not null references public.ads (id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, ad_id)
);

create table if not exists public.watch_history (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ad_id uuid not null references public.ads (id) on delete cascade,
  viewed_at timestamptz default now()
);

create index if not exists watch_history_user_idx on public.watch_history (user_id, viewed_at desc);

-- Lock (sync Apify / Ad Library)
create table if not exists public.ingest_lock (
  key text primary key,
  cooldown_until timestamptz not null default '1970-01-01Z'
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.ads enable row level security;
alter table public.transcriptions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.favorites enable row level security;
alter table public.watch_history enable row level security;
alter table public.profiles enable row level security;
alter table public.ingest_lock enable row level security;

drop policy if exists "ads_select_auth" on public.ads;
create policy "ads_select_auth" on public.ads for select to authenticated using (true);

drop policy if exists "transcriptions_select_auth" on public.transcriptions;
create policy "transcriptions_select_auth" on public.transcriptions
  for select to authenticated using (true);

drop policy if exists "subs_select_own" on public.subscriptions;
create policy "subs_select_own" on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "subs_insert_own" on public.subscriptions;
create policy "subs_insert_own" on public.subscriptions
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "subs_update_own" on public.subscriptions;
create policy "subs_update_own" on public.subscriptions
  for update to authenticated using (auth.uid() = user_id);

drop policy if exists "favorites_all_own" on public.favorites;
create policy "favorites_all_own" on public.favorites
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "history_all_own" on public.watch_history;
create policy "history_all_own" on public.watch_history
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles
  for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Perfil no registo
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Storage: bucket "creatives" (se o teu projecto disser 42501 no INSERT, cria
-- o bucket no menu Storage → New bucket → público → "creatives")
-- ---------------------------------------------------------------------------

do $bucket$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('creatives', 'creatives', true, 104857600, null)
  on conflict (id) do update set
    public = true,
    file_size_limit = 104857600;
exception
  when others then
    raise notice
      'Não foi possível criar o bucket "creatives" por SQL. Vai a Storage → New bucket, nome: creatives, Public: sim. (Erro: %)',
      sqlerrm;
end
$bucket$;

drop policy if exists "creatives_public_read" on storage.objects;
create policy "creatives_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'creatives');

-- ---------------------------------------------------------------------------
-- Função de limpeza (bot; só service_role)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Realtime (INSERT em public.ads no feed)
-- ---------------------------------------------------------------------------

do $pub$
begin
  alter publication supabase_realtime add table public.ads;
exception
  when duplicate_object then null;
  when undefined_object then null;
  when others then null;
end
$pub$;

-- Comentários úteis (opcional)
comment on column public.ads.creative_url is 'URL de imagem/criativo (spy)';
comment on column public.ads.duplicate_count is 'Tamanho do grupo de duplicados';
comment on column public.ads.trending is 'Sinal de momentum (spy)';
