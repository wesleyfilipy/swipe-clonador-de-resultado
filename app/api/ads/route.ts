import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { freeFeedUnlimitedEnv, isSubscriber } from "@/lib/subscription";
import { FREE_AD_LIMIT } from "@/lib/constants";
import type { AdRow, SortMode } from "@/types/database";
import { queryFeedAds, computeFeedHasMore } from "@/lib/feed-ads-query";
import { adRowToPublic } from "@/lib/spy/api-mapper";

const SORT: SortMode[] = ["scaled", "recent", "active", "score"];
function asSort(s: string | null): SortMode {
  if (s && SORT.includes(s as SortMode)) return s as SortMode;
  return "scaled";
}

/**
 * Listagem pública (auth): catálogo processado no Supabase — nunca chama Apify.
 * Filtros: ?country=US&niche=fitness&sort=score&trending=1&limit=20&offset=0&format=public
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const niche = searchParams.get("niche") ?? "";
  const sort = asSort(searchParams.get("sort"));
  const offset = Math.max(0, Number(searchParams.get("offset") ?? "0") || 0);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "8") || 8));
  const country = searchParams.get("country")?.trim() || undefined;
  const trendingOnly = searchParams.get("trending") === "1" || searchParams.get("trending") === "true";
  const asPublic = searchParams.get("format") === "public";

  const paid = await isSubscriber(supabase, user.id);
  const subscriber = paid || freeFeedUnlimitedEnv();

  const { data, count, error } = await queryFeedAds(supabase, {
    niche,
    country: country && country.length <= 3 ? country : undefined,
    trendingOnly: trendingOnly || undefined,
    sort,
    offset,
    pageSize,
    subscriber,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = count ?? 0;
  const hasMore = computeFeedHasMore({
    offset,
    pageSize,
    rowCount: data.length,
    total,
    subscriber,
  });

  if (asPublic) {
    return NextResponse.json({
      ads: (data as AdRow[]).map(adRowToPublic),
      subscriber,
      freeLimit: FREE_AD_LIMIT,
      hasMore,
      total,
    });
  }

  return NextResponse.json({
    ads: data,
    subscriber,
    freeLimit: FREE_AD_LIMIT,
    hasMore,
    total,
  });
}
