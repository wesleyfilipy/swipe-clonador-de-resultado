import { createClient } from "@supabase/supabase-js";
import { env } from "./config.js";

export function adminClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
