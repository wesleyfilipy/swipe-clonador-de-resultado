-- [DEPRECADO] Esquema mínimo antigo. Usa: supabase/complete_install.sql
create extension if not exists "uuid-ossp";

create table if not exists public.users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  created_at timestamptz default now()
);

-- Mirror auth.users if you prefer: link via trigger. Simpler path: use auth.users id as profiles
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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists ads_niche_idx on public.ads (niche);
create index if not exists ads_views_week_idx on public.ads (views_week desc);

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

-- RLS
alter table public.ads enable row level security;
alter table public.transcriptions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.favorites enable row level security;
alter table public.watch_history enable row level security;
alter table public.profiles enable row level security;

-- Ads readable by authenticated users (API uses service role for mining)
create policy "ads_select_auth" on public.ads for select to authenticated using (true);

create policy "transcriptions_select_auth" on public.transcriptions
  for select to authenticated using (true);

create policy "subs_select_own" on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

create policy "subs_insert_own" on public.subscriptions
  for insert to authenticated with check (auth.uid() = user_id);

create policy "subs_update_own" on public.subscriptions
  for update to authenticated using (auth.uid() = user_id);

create policy "favorites_all_own" on public.favorites
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "history_all_own" on public.watch_history
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "profiles_own" on public.profiles
  for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Trigger: new user -> profile
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
