import type { SupabaseClient } from "@supabase/supabase-js";

const ACTIVE = new Set(["active", "trialing"]);

/**
 * Feed sem cobrança Stripe: por padrão scroll ilimitado.
 * Para voltar ao limite free + banner de assinatura: FREE_FEED_UNLIMITED=0 na Vercel.
 */
export function freeFeedUnlimitedEnv(): boolean {
  const v = process.env.FREE_FEED_UNLIMITED ?? process.env.NEXT_PUBLIC_FREE_FEED_UNLIMITED;
  if (v === "0" || String(v).toLowerCase() === "false") return false;
  return true;
}

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
