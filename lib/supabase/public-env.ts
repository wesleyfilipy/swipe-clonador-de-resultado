/**
 * Sem NEXT_PUBLIC_* o app cai no Supabase local (CLI `supabase start`, porta 54321).
 * Para projeto na nuvem, defina URL + anon key do painel em `.env.local` e reinicie `next dev`.
 */
const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

let warnedMissingPublicEnv = false;

export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anonKey) return { url, anonKey };

  if (!warnedMissingPublicEnv) {
    warnedMissingPublicEnv = true;
    console.warn(
      "[Supabase] NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes. " +
        "Usando fallback http://127.0.0.1:54321 (só funciona com `supabase start` local). " +
        "Para nuvem: Project Settings → API → copie URL e anon key para .env.local"
    );
  }

  return { url: url || LOCAL_URL, anonKey: anonKey || LOCAL_ANON };
}
