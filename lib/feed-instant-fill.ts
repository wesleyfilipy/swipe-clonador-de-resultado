import { waitUntil } from "@vercel/functions";
import { createAdminClient } from "@/lib/supabase/admin";
import { countFeedVisibleAds } from "@/lib/feed-ads-query";
import { getApifyAdLibraryToken, getMetaAdLibraryToken, runAdLibraryIngest } from "@/lib/ad-library-sync";
import { isUserAdIngestBlocked } from "@/lib/spy/user-ingest-guard";

const DEMO_ADS = [
  {
    title: "VSL Fitness — protocolo 21 dias",
    niche: "fitness",
    video_url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    vsl_url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    thumbnail: null as string | null,
    ad_copy: "Criativo de exemplo (ambiente de teste). Ative FEED_INSTANT_DEMO_FALLBACK=1 na Vercel para usar este fallback.",
    views_day: 4200,
    views_week: 28000,
    active_days: 45,
    facebook_ad_id: "demo-1",
    mine_source: "instant_demo",
    status: "scaled" as const,
  },
  {
    title: "Renda extra com IA",
    niche: "renda extra",
    video_url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    vsl_url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    thumbnail: null as string | null,
    ad_copy: "Criativo de exemplo (ambiente de teste).",
    views_day: 9100,
    views_week: 62000,
    active_days: 72,
    facebook_ad_id: "demo-2",
    mine_source: "instant_demo",
    status: "scaled" as const,
  },
  {
    title: "Suplemento natural",
    niche: "saúde",
    video_url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    vsl_url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    thumbnail: null as string | null,
    ad_copy: "Criativo de exemplo (ambiente de teste).",
    views_day: 3000,
    views_week: 19000,
    active_days: 28,
    facebook_ad_id: "demo-3",
    mine_source: "instant_demo",
    status: "scaled" as const,
  },
];

/**
 * Quando `ads` está vazio: tenta mineração (ignora cooldown do ingest_lock no modo feed).
 * Demos só com FEED_INSTANT_DEMO_FALLBACK=1. Respeita AUTO_AD_LIBRARY_SYNC=0.
 */
export async function runCatalogFillOnce(): Promise<void> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return;
  }

  const { count, error } = await countFeedVisibleAds(admin);
  if (error || (count ?? 0) > 0) return;

  if (isUserAdIngestBlocked()) {
    return;
  }

  /** Só a Meta no `if` impedia a mineração com Apify puro. Precisa de um dos dois. */
  const canMine =
    (getMetaAdLibraryToken() || getApifyAdLibraryToken()) && process.env.AUTO_AD_LIBRARY_SYNC !== "0";
  if (canMine) {
    try {
      const r = await runAdLibraryIngest({ mode: "feed_blocking_fill" });
      if (!r.ok) {
        console.error("[runCatalogFillOnce] ingest", r.message ?? r.errors?.slice?.(0, 3));
      }
    } catch (e) {
      console.error("[runCatalogFillOnce] ingest", e);
    }
  }

  const { count: c2 } = await countFeedVisibleAds(admin);
  if ((c2 ?? 0) > 0) return;

  if (process.env.FEED_INSTANT_DEMO_FALLBACK !== "1") return;

  const { data: existing } = await admin.from("ads").select("id").eq("facebook_ad_id", "demo-1").maybeSingle();
  if (existing) return;

  const { error: insErr } = await admin.from("ads").insert(DEMO_ADS);
  if (insErr) {
    console.error("[runCatalogFillOnce] demo insert", insErr.message);
  }
}

/**
 * Agenda mineração em background (Vercel `waitUntil`) quando o catálogo está vazio.
 * Não usar junto com `FEED_INSTANT_BLOCKING_FILL=1` no mesmo request (o /feed chama só um dos fluxos).
 */
export function scheduleFeedCatalogFill(): void {
  if (process.env.FEED_INSTANT_BLOCKING_FILL === "0") return;
  if (process.env.FEED_INSTANT_BLOCKING_FILL === "1") return;

  const task = runCatalogFillOnce().catch((e) => console.error("[scheduleFeedCatalogFill]", e));
  waitUntil(task);
}

/**
 * Mineração síncrona no /feed só com FEED_INSTANT_BLOCKING_FILL=1 (ex.: depuração).
 * Comportamento padrão: `scheduleFeedCatalogFill()` no page (não bloqueia a SSR).
 */
export async function ensureFeedAdsForPageLoad(): Promise<void> {
  if (process.env.FEED_INSTANT_BLOCKING_FILL === "0") return;
  if (process.env.FEED_INSTANT_BLOCKING_FILL !== "1") return;
  await runCatalogFillOnce();
}
