import {
  adLibraryIdUrl,
  fetchApifyAdLibraryItems,
  getApifyAdLibraryTokenFromEnv,
  isApifyOnlyMode,
  minedRowFromApifyItemWithResolve,
  pickAdId,
} from "@/lib/ad-library-apify";
import { fetchAdArchiveObjectFromGraph, mapRow, type MinedAdLibraryRow } from "@/lib/ad-library-miner";
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

function pickBestMinedFromApifyItems(
  items: Record<string, unknown>[],
  uid: string,
  country: string
): MinedAdLibraryRow | null {
  for (const it of items) {
    if (pickAdId(it) === uid) {
      const r = minedRowFromApifyItemWithResolve(it, country);
      if (r?.video_url) return r;
    }
  }
  for (const it of items) {
    const r = minedRowFromApifyItemWithResolve(it, country);
    if (r?.video_url) return r;
  }
  return null;
}

function mergeByAdId(
  a: Record<string, unknown>[],
  b: Record<string, unknown>[]
): Record<string, unknown>[] {
  const m = new Map<string, Record<string, unknown>>();
  for (const it of [...a, ...b]) {
    const id = pickAdId(it) || `__idx_${m.size}`;
    m.set(id, it);
  }
  return Array.from(m.values());
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
    const onePass = (process.env.RESOLVE_CREATIVE_APIFY_ONE_PASS ?? "").trim() === "1";

    let acc: Record<string, unknown>[] = [];
    const apifyErrorList: string[] = [];
    const passes: { url: string; media: "video" | "all" }[] = onePass
      ? [{ url: adLibraryIdUrl(uid, { country, mediaType: "all" }), media: "all" }]
      : [
          { url: adLibraryIdUrl(uid, { country, mediaType: "all" }), media: "all" },
          { url: adLibraryIdUrl(uid, { country, mediaType: "video" }), media: "video" },
        ];

    let best: MinedAdLibraryRow | null = null;
    for (const p of passes) {
      if (best?.video_url) break;
      const { items, errors: e } = await fetchApifyAdLibraryItems({
        apifyToken: apify,
        country,
        libraryPageUrls: [p.url],
        count: 50,
        waitSecs,
        adLibraryUrlMedia: p.media,
      });
      apifyErrorList.push(...e);
      acc = mergeByAdId(acc, items);
      best = pickBestMinedFromApifyItems(acc, uid, country);
    }

    if (!best?.video_url) {
      const bits = [graphErr, ...apifyErrorList].filter(Boolean).join(" · ");
      const n = acc.length;
      return {
        error: "Não foi possível obter URL de vídeo",
        detail:
          bits ||
          (n === 0
            ? "O Apify devolveu 0 linhas (a run pode ter acabado cedo: aumenta RESOLVE_CREATIVE_APIFY_WAIT_SECS, ex. 180–300) ou a página exige outro país — confirma o país do anúncio e APIFY_AD_LIBRARY_COUNTRY."
            : `Foram processadas ${n} entradas do Apify, mas nenhum URL de vídeo (anúncio pode ser imagem, ou a Meta não expõe MP4 neste nó). ${bits ? "" : "Verifica a run no painel do Apify."}`),
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
