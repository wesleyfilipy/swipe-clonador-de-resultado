/**
 * Fallbacks permitem `next build` sem .env. Em produção, defina as variáveis reais.
 */
const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || LOCAL_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || LOCAL_ANON;
  return { url, anonKey };
}
