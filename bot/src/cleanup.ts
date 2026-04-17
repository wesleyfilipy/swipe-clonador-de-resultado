import { adminClient } from "./supabaseAdmin.js";

export async function runCleanup(): Promise<number> {
  const supabase = adminClient();
  const { data, error } = await supabase.rpc("bot_cleanup_ads");
  if (error) throw error;
  return typeof data === "number" ? data : Number(data);
}
