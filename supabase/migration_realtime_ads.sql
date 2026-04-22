-- [DEPRECADO] Ver supabase/complete_install.sql
-- Rode no SQL Editor se o projeto já existia sem Realtime em `public.ads` (feed escuta INSERT).
do $$
begin
  alter publication supabase_realtime add table public.ads;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
