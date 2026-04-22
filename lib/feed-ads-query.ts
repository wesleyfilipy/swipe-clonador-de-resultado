import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_AD_LIMIT } from "@/lib/constants";
import type { AdRow, SortMode } from "@/types/database";

/**
 * Filtro padrão do catálogo. Se a coluna `mine_source` não existir, tentamos
 * de novo sem este `.or` (migrations antigas).
 */
const MINE_SOURCE_OR = "mine_source.is.null,mine_source.in.(manual,ad_library_daily,spy_weekly)";

export type FeedQueryParams = {
  niche: string;
  country?: string;
  sort: SortMode;
  trendingOnly?: boolean;
  offset: number;
  pageSize: number;
  subscriber: boolean;
};

type Attempt = {
  mineOr: boolean;
  country: boolean;
  /** se false e sort===score, ordena como "scaled" (evita coluna `score` em falta) */
  useScoreOrder: boolean;
  /**
   * Com `p.trendingOnly`: se true, aplica `eq(trending,true)`; se false, ignora o filtro
   * (útil se a coluna `trending` não existir no Supabase).
   */
  useTrendingFilter: boolean;
};

const QUERY_ATTEMPTS: Attempt[] = [
  { mineOr: true, country: true, useScoreOrder: true, useTrendingFilter: true },
  { mineOr: true, country: true, useScoreOrder: true, useTrendingFilter: false },
  { mineOr: true, country: false, useScoreOrder: true, useTrendingFilter: false },
  { mineOr: false, country: false, useScoreOrder: true, useTrendingFilter: false },
  { mineOr: false, country: false, useScoreOrder: false, useTrendingFilter: false },
];

function isRecoverableColumnError(msg: string): boolean {
  return /column|does not exist|schema cache|undefined column|Could not find/i.test(msg);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function orderForSort(q: any, sort: SortMode, useScoreOrder: boolean) {
  if (sort === "score" && !useScoreOrder) {
    return q.order("views_week", { ascending: false }).order("active_days", { ascending: false });
  }
  if (sort === "score") {
    return q.order("score", { ascending: false, nullsFirst: false });
  }
  if (sort === "scaled") {
    return q.order("views_week", { ascending: false }).order("active_days", { ascending: false });
  }
  if (sort === "recent") {
    return q.order("created_at", { ascending: false });
  }
  return q.order("active_days", { ascending: false });
}

export async function queryFeedAds(
  supabase: SupabaseClient,
  p: FeedQueryParams
): Promise<{ data: AdRow[]; count: number | null; error: { message: string } | null }> {
  const maxTotal = p.subscriber ? 10_000 : FREE_AD_LIMIT;
  const from = p.offset;
  const to = Math.min(from + p.pageSize - 1, maxTotal - 1);
  if (from > to) {
    return { data: [], count: 0, error: null };
  }

  let lastErr = "";
  for (const a of QUERY_ATTEMPTS) {
    if (a.country && !p.country) continue;
    if (a.useTrendingFilter && !p.trendingOnly) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from("ads").select("*", { count: "exact" });
    if (a.mineOr) {
      q = q.or(MINE_SOURCE_OR);
    }
    if (p.niche && p.niche !== "todos") {
      q = q.eq("niche", p.niche);
    }
    if (a.country && p.country) {
      q = q.eq("country", p.country.toUpperCase());
    }
    if (p.trendingOnly && a.useTrendingFilter) {
      q = q.eq("trending", true);
    }
    q = orderForSort(q, p.sort, a.useScoreOrder);

    const { data, error, count } = await q.range(from, to);
    if (!error) {
      return { data: (data ?? []) as AdRow[], count, error: null };
    }
    lastErr = error.message;
    if (!isRecoverableColumnError(error.message)) {
      return { data: [], count: null, error: { message: error.message } };
    }
  }

  return { data: [], count: null, error: { message: lastErr || "Falha ao listar anúncios" } };
}

const COUNT_ATTEMPTS: Array<{ mineOr: boolean; country: boolean }> = [
  { mineOr: true, country: true },
  { mineOr: true, country: false },
  { mineOr: false, country: false },
];

/** Mesmo filtro do feed (exclui instant_demo e outros mine_source fora da lista). */
export async function countFeedVisibleAds(
  supabase: SupabaseClient,
  opts?: { country?: string }
): Promise<{ count: number | null; error: { message: string } | null }> {
  let lastErr = "";
  for (const a of COUNT_ATTEMPTS) {
    if (a.country && !opts?.country) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from("ads").select("id", { count: "exact", head: true });
    if (a.mineOr) {
      q = q.or(MINE_SOURCE_OR);
    }
    if (a.country && opts?.country) {
      q = q.eq("country", opts.country.toUpperCase());
    }
    const { count, error } = await q;
    if (!error) {
      return { count: count ?? 0, error: null };
    }
    lastErr = error.message;
    if (!isRecoverableColumnError(error.message)) {
      return { count: null, error: { message: error.message } };
    }
  }
  return { count: null, error: { message: lastErr || "Falha na contagem" } };
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
