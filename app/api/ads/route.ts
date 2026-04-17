import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { freeFeedUnlimitedEnv, isSubscriber } from "@/lib/subscription";
import { FREE_AD_LIMIT } from "@/lib/constants";
import type { SortMode } from "@/types/database";

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
  const sort = (searchParams.get("sort") ?? "scaled") as SortMode;
  const offset = Number(searchParams.get("offset") ?? "0");
  const pageSize = Math.min(Number(searchParams.get("limit") ?? "8"), 20);

  const paid = await isSubscriber(supabase, user.id);
  const buildFree = freeFeedUnlimitedEnv();
  /** Em modo construção (`FREE_FEED_UNLIMITED`) o feed não limita scroll nem exige Stripe. */
  const subscriber = paid || buildFree;
  const maxTotal = subscriber ? 10_000 : FREE_AD_LIMIT;

  let q = supabase.from("ads").select("*", { count: "exact" });

  if (niche && niche !== "todos") {
    q = q.eq("niche", niche);
  }

  /* "scaled": prioriza volume + tempo ativo. Coluna score (migration_bot_ads) é opcional no ORDER BY
     para não quebrar projetos que só rodaram schema.sql (sem score). */
  if (sort === "scaled") {
    q = q.order("views_week", { ascending: false }).order("active_days", { ascending: false });
  } else if (sort === "recent") {
    q = q.order("created_at", { ascending: false });
  } else {
    q = q.order("active_days", { ascending: false });
  }

  const from = offset;
  const to = Math.min(offset + pageSize - 1, maxTotal - 1);
  if (from > to) {
    return NextResponse.json({
      ads: [],
      subscriber,
      freeLimit: FREE_AD_LIMIT,
      hasMore: false,
    });
  }

  const { data, error, count } = await q.range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = count ?? 0;
  const cap = subscriber ? total : Math.min(total, FREE_AD_LIMIT);
  const loaded = offset + (data?.length ?? 0);
  const hasMore = loaded < cap && (data?.length ?? 0) === pageSize;

  return NextResponse.json({
    ads: data ?? [],
    subscriber,
    freeLimit: FREE_AD_LIMIT,
    hasMore,
  });
}
