import type { SupabaseClient } from "@supabase/supabase-js";

const ACTIVE = new Set(["active", "trialing"]);

export async function isSubscriber(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return false;
  if (!ACTIVE.has(data.status)) return false;
  if (data.current_period_end) {
    const end = new Date(data.current_period_end).getTime();
    if (end < Date.now()) return false;
  }
  return true;
}
