-- [DEPRECADO] Ver supabase/complete_install.sql
-- Evita disparos repetidos da sincronização Ad Library em background (lib/ad-library-sync.ts).
-- Opcional: se a tabela não existir, o código ignora o lock e segue.
create table if not exists public.ingest_lock (
  key text primary key,
  cooldown_until timestamptz not null default '1970-01-01Z'
);

alter table public.ingest_lock enable row level security;
