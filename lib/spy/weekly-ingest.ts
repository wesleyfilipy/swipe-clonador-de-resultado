import { fetchApifyAdLibraryItems, getApifyAdLibraryTokenFromEnv } from "@/lib/ad-library-apify";
import { apifyItemsToPipelineRows, type SpyPipelineRow } from "@/lib/spy/pipeline";
import {
  getSpyAdsPerCountry,
  getSpyCountries,
  getSpyKeywords,
  getSpyMinIntervalHours,
  getSpyVslMaxEnrichments,
} from "@/lib/spy/config";
import { enrichVslBatch } from "@/lib/spy/vsl-extract";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

const CHUNK = 60;

export type WeeklySpyIngestResult = {
  ok: boolean;
  skipped?: "no_token" | "interval" | "disabled" | "error";
  inserted?: number;
  countries: string[];
  errors: string[];
  message?: string;
  batchId?: string;
};

function toDbRow(r: SpyPipelineRow, now: string) {
  return {
    title: r.pageName.slice(0, 500),
    page_name: r.pageName,
    niche: r.niche,
    ad_copy: r.adText,
    creative_url: r.creative || null,
    video_url: r.videoUrl,
    thumbnail: r.thumbnail,
    vsl_url: r.vslUrl,
    active_days: r.daysRunning,
    start_date: r.startDate,
    facebook_ad_id: r.adLibraryId,
    ad_library_id: r.adLibraryId,
    country: r.country,
    duplicate_count: r.duplicateCount,
    is_scaled: r.isScaled,
    is_winner: r.isWinner,
    score: r.score,
    trending: r.trending,
    views_week: r.viewsWeek,
    views_day: r.viewsDay,
    mine_source: "spy_weekly",
    spy_ingest_batch: r.spyIngestBatch,
    status: r.isWinner ? "scaled" : "testing",
    appearance_count: r.duplicateCount,
    created_at: now,
    updated_at: now,
  };
}

/** Tabela `spy_ingest_state` não está no gen de types do app; cast só para o checker (runtime continua o nome real). */
function spyIngestStateTable(admin: SupabaseClient) {
  return admin.from("spy_ingest_state" as "ads");
}

async function markState(
  admin: SupabaseClient,
  p: { lastError?: string | null; lastOk?: boolean }
) {
  const now = new Date().toISOString();
  const q = spyIngestStateTable(admin);
  if (p.lastOk) {
    const { error } = await q.upsert(
      { id: 1, last_completed_at: now, last_error: null },
      { onConflict: "id" }
    );
    if (error) console.warn("[spy_ingest_state]", error.message);
  } else if (p.lastError != null) {
    const { error } = await q.upsert(
      { id: 1, last_completed_at: null, last_error: p.lastError },
      { onConflict: "id" }
    );
    if (error) console.warn("[spy_ingest_state]", error.message);
  }
}

export async function runWeeklySpyIngest(options: {
  /** Ignora o intervalo mínimo (ex.: teste com SPY_FORCE_RUN=1). */
  force?: boolean;
}): Promise<WeeklySpyIngestResult> {
  const errors: string[] = [];
  if (process.env.SPY_WEEKLY_ENABLED === "0") {
    return { ok: false, skipped: "disabled", countries: [], errors, message: "SPY_WEEKLY_ENABLED=0" };
  }

  const apify = getApifyAdLibraryTokenFromEnv();
  if (!apify) {
    return { ok: false, skipped: "no_token", countries: [], errors, message: "Defina APIFY_TOKEN." };
  }

  const admin = createAdminClient();
  const force = options.force || process.env.SPY_FORCE_RUN === "1";
  if (!force) {
    const minH = getSpyMinIntervalHours();
    const { data, error: stErr } = await spyIngestStateTable(admin)
      .select("last_completed_at")
      .eq("id", 1)
      .maybeSingle();

    if (stErr && /does not exist|schema cache|Could not find/i.test(stErr.message)) {
      errors.push(
        "Tabela spy_ingest_state ausente. Aplique supabase/migration_spy_weekly_ads.sql (o gate de intervalo fica inativo)."
      );
    } else if (data?.last_completed_at) {
      const t = new Date(String(data.last_completed_at)).getTime();
      if (Date.now() - t < minH * 3_600_000) {
        return {
          ok: true,
          skipped: "interval",
          countries: [],
          errors,
          message: `Última ingestão há menos de ${minH}h. Use SPY_FORCE_RUN=1 para forçar.`,
        };
      }
    }
  }

  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const countries = getSpyCountries();
  const keywords = getSpyKeywords();
  const perCountry = getSpyAdsPerCountry();

  const all: SpyPipelineRow[] = [];
  for (const cc of countries) {
    const { items, errors: e } = await fetchApifyAdLibraryItems({
      apifyToken: apify,
      country: cc,
      keywords,
      count: perCountry,
    });
    errors.push(...e);
    if (items.length) {
      all.push(...apifyItemsToPipelineRows(items, cc, batchId));
    }
  }

  if (all.length === 0) {
    await markState(admin, { lastError: "Nenhum item retornado do Apify" });
    return {
      ok: false,
      skipped: "error",
      countries,
      errors,
      message: "Nenhum anúncio bruto. Confira o token Apify, custo e as keywords.",
    };
  }

  const vslCap = getSpyVslMaxEnrichments();
  const winnerLandings = all
    .filter((r) => r.isWinner && !r.vslUrl && r.landingUrl)
    .slice(0, vslCap);

  if (winnerLandings.length) {
    await enrichVslBatch(
      winnerLandings.map((r) => ({
        landing: r.landingUrl,
        enrich: (v) => {
          if (v) r.vslUrl = v;
        },
      })),
      5
    );
  }

  const { error: delErr } = await admin.from("ads").delete().eq("mine_source", "spy_weekly");
  if (delErr) {
    await markState(admin, { lastError: delErr.message });
    return {
      ok: false,
      skipped: "error",
      countries,
      errors: [...errors, delErr.message],
      message: delErr.message,
    };
  }

  const payload = all.map((r) => toDbRow(r, now));
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error: insErr } = await admin.from("ads").insert(slice);
    if (insErr) {
      await markState(admin, { lastError: insErr.message });
      return {
        ok: false,
        skipped: "error",
        countries,
        errors: [...errors, insErr.message],
        message: insErr.message,
        batchId,
      };
    }
  }

  await markState(admin, { lastOk: true });
    return {
        ok: true,
        inserted: all.length,
        countries,
        errors,
        batchId,
        message: `Ingeridos ${all.length} anúncios (spy_weekly).`,
      };
}
