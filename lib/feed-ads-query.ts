import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_AD_LIMIT } from "@/lib/constants";
import type { AdRow, SortMode } from "@/types/database";

/** Mesmo filtro do feed (exclui instant_demo e outros mine_source fora da lista). */
export async function countFeedVisibleAds(
  supabase: SupabaseClient
): Promise<{ count: number | null; error: { message: string } | null }> {
  const { count, error } = await supabase
    .from("ads")
    .select("id", { count: "exact", head: true })
    .or("mine_source.is.null,mine_source.in.(manual,ad_library_daily,spy_weekly)");
  if (error) return { count: null, error: { message: error.message } };
  return { count: count ?? 0, error: null };
}

export type FeedQueryParams = {
  niche: string;
  /** ISO-2, ex. US, BR. Vazio = qualquer. */
  country?: string;
  sort: SortMode;
  /** Só anúncios com trending=true (batch recente / momentum). */
  trendingOnly?: boolean;
  offset: number;
  pageSize: number;
  subscriber: boolean;
};

export async function queryFeedAds(
  supabase: SupabaseClient,
  p: FeedQueryParams
): Promise<{ data: AdRow[]; count: number | null; error: { message: string } | null }> {
  const maxTotal = p.subscriber ? 10_000 : FREE_AD_LIMIT;
  let q = supabase.from("ads").select("*", { count: "exact" });
  /** Nunca listar criativos de fallback de teste no feed. */
  q = q.or("mine_source.is.null,mine_source.in.(manual,ad_library_daily,spy_weekly)");

  if (p.niche && p.niche !== "todos") {
    q = q.eq("niche", p.niche);
  }
  if (p.country) {
    q = q.eq("country", p.country.toUpperCase());
  }
  if (p.trendingOnly) {
    q = q.eq("trending", true);
  }

  if (p.sort === "score") {
    q = q.order("score", { ascending: false, nullsFirst: false });
  } else if (p.sort === "scaled") {
    q = q.order("views_week", { ascending: false }).order("active_days", { ascending: false });
  } else if (p.sort === "recent") {
    q = q.order("created_at", { ascending: false });
  } else {
    q = q.order("active_days", { ascending: false });
  }

  const from = p.offset;
  const to = Math.min(from + p.pageSize - 1, maxTotal - 1);
  if (from > to) {
    return { data: [], count: 0, error: null };
  }

  const { data, error, count } = await q.range(from, to);
  if (error) {
    return { data: [], count: null, error: { message: error.message } };
  }

  return { data: (data ?? []) as AdRow[], count, error: null };
}

export function computeFeedHasMore(p: {
  offset: number;
  pageSize: number;
  rowCount: number;
  total: number;
  subscriber: boolean;
}): boolean {
  const cap = p.subscriber ? p.total : Math.min(p.total, FREE_AD_LIMIT);
  const loaded = p.offset + p.rowCount;
  return p.rowCount === p.pageSize && loaded < cap;
}
