import {
  adLibraryIdUrl,
  fetchApifyAdLibraryItems,
  getApifyAdLibraryTokenFromEnv,
  isApifyOnlyMode,
  minedRowFromApifyItem,
  pickAdId,
} from "@/lib/ad-library-apify";
import { fetchAdArchiveObjectFromGraph, mapRow } from "@/lib/ad-library-miner";
import { mirrorAdCreativeToStorage } from "@/lib/mirror-creative-to-storage";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdRow } from "@/types/database";

export type ResolveCreativeResult =
  | { ad: AdRow; mirrored: boolean; source: "graph" | "apify" }
  | { error: string; detail?: string };

function metaAdLibraryToken(): string {
  return (process.env.META_AD_LIBRARY_ACCESS_TOKEN ?? "").replace(/^\uFEFF/, "").trim();
}

function pickMediaPatch(mined: { video_url: string | null; vsl_url: string | null; thumbnail: string | null; landing_domain?: string | null }, row: AdRow): Partial<AdRow> {
  const out: Partial<AdRow> = {
    video_url: mined.video_url,
    vsl_url: mined.vsl_url ?? row.vsl_url,
    updated_at: new Date().toISOString(),
  };
  if (mined.thumbnail) {
    out.thumbnail = mined.thumbnail;
  }
  if (mined.landing_domain) {
    out.landing_domain = mined.landing_domain;
  }
  return out;
}

export async function resolveAdCreativeInCatalog(adId: string): Promise<ResolveCreativeResult> {
  const admin = createAdminClient();
  const { data: ad, error: sel } = await admin.from("ads").select("*").eq("id", adId).maybeSingle();
  if (sel) {
    return { error: "Erro a ler o anúncio", detail: sel.message };
  }
  if (!ad) {
    return { error: "Anúncio não encontrado" };
  }
  const row = ad as AdRow;
  if (row.mine_source === "instant_demo") {
    return { error: "Não aplicável" };
  }

  const uid = (row.facebook_ad_id || row.ad_library_id || "").trim();
  if (!/^\d+$/.test(uid)) {
    return { error: "Falta facebook_ad_id (só dígitos) para procurar o vídeo na Ad Library" };
  }

  const country =
    (row.country || process.env.APIFY_AD_LIBRARY_COUNTRY || "US").toString().trim().toUpperCase() || "US";
  const countries = [country];

  let patch: Partial<AdRow> = {};
  let source: "graph" | "apify" = "graph";
  let graphErr: string | null = null;

  const graphTok = metaAdLibraryToken();
  if (graphTok && !isApifyOnlyMode()) {
    const g = await fetchAdArchiveObjectFromGraph(uid, graphTok, countries);
    graphErr = g.error;
    if (g.data) {
      const m = mapRow(g.data, country);
      if (m?.video_url) {
        patch = pickMediaPatch(m, row);
        source = "graph";
      }
    }
  }

  if (!patch.video_url) {
    const apify = getApifyAdLibraryTokenFromEnv();
    if (!apify) {
      const detail = !graphTok
        ? "Defina META_AD_LIBRARY_ACCESS_TOKEN ou (em APIFY_ONLY) APIFY_TOKEN na Vercel."
        : isApifyOnlyMode()
          ? graphErr || "Graph não devolveu vídeo; confirme APIFY_TOKEN e APIFY_ONLY."
          : graphErr
            ? `Graph: ${graphErr}. Sem APIFY_TOKEN não há fallback.`
            : "A Graph não devolveu vídeo para este ID. Adicione APIFY_TOKEN para re-scraping da página do anúncio.";
      return { error: "Não foi possível obter URL de vídeo", detail };
    }

    const waitSecs = Math.min(300, Math.max(45, Number(process.env.RESOLVE_CREATIVE_APIFY_WAIT_SECS ?? "120")));
    const { items, errors: apifyErrors } = await fetchApifyAdLibraryItems({
      apifyToken: apify,
      country,
      libraryPageUrls: [adLibraryIdUrl(uid)],
      count: 25,
      waitSecs,
      adLibraryUrlMedia: "video",
    });

    let best: ReturnType<typeof minedRowFromApifyItem> = null;
    for (const it of items) {
      if (pickAdId(it) === uid) {
        const r = minedRowFromApifyItem(it, country);
        if (r?.video_url) {
          best = r;
          break;
        }
      }
    }
    if (!best?.video_url) {
      for (const it of items) {
        const r = minedRowFromApifyItem(it, country);
        if (r?.video_url) {
          best = r;
          break;
        }
      }
    }

    if (!best?.video_url) {
      const bits = [graphErr, ...apifyErrors].filter(Boolean).join(" · ");
      return {
        error: "Não foi possível obter URL de vídeo",
        detail: bits || "O Apify não devolveu ficheiro de vídeo para esta página.",
      };
    }

    patch = pickMediaPatch(best, row);
    source = "apify";
  }

  const { error: upErr } = await admin.from("ads").update(patch).eq("id", adId);
  if (upErr) {
    return { error: "Falha ao gravar no catálogo", detail: upErr.message };
  }

  let mirrored = false;
  if (patch.video_url) {
    const m = await mirrorAdCreativeToStorage(adId);
    mirrored = m.ok;
  }

  const { data: fresh, error: reSel } = await admin.from("ads").select("*").eq("id", adId).maybeSingle();
  if (reSel || !fresh) {
    return { error: "Gravou mas falhou a releitura", detail: reSel?.message };
  }

  return { ad: fresh as AdRow, mirrored, source };
}
