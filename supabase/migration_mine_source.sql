-- [DEPRECADO] Usa em conjunto: supabase/complete_install.sql (ficheiro único).
-- Identifica anúncios injetados pela mineração diária (para substituir o lote no cron)
alter table public.ads add column if not exists mine_source text default 'manual';
create index if not exists ads_mine_source_idx on public.ads (mine_source);
