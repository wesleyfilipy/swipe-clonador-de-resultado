/**
 * Mineração da Ad Library: **prioridade 1) Apify** (`APIFY_TOKEN`) → actor facebook-ads-library-scraper;
 * **2)** Graph API `/ads_archive` (META_AD_LIBRARY_ACCESS_TOKEN) se `APIFY_ONLY` não for 1.
 * Docs Graph: https://developers.facebook.com/docs/graph-api/reference/ads_archive/
 */

import crypto from "node:crypto";

import { getApifyAdLibraryTokenFromEnv, isApifyOnlyMode, mineFromApify } from "@/lib/ad-library-apify";

const GRAPH_VERSION = "v21.0";

/**
 * Se o app tiver "Require app secret" no painel Meta, envie `appsecret_proof`.
 * `META_AD_LIBRARY_SKIP_APPSECRET_PROOF=1` força não enviar (útil se a Meta não exige proof mas o secret no env estava errado).
 */
function withAppSecretProof(url: string, accessToken: string): string {
  if (process.env.META_AD_LIBRARY_SKIP_APPSECRET_PROOF === "1") {
    return url;
  }
  const appSecret = (process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET ?? "").trim();
  if (!appSecret) return url;
  const token = accessToken.replace(/^\uFEFF/, "").trim();
  const proof = crypto.createHmac("sha256", appSecret).update(token).digest("hex");
  const u = new URL(url);
  u.searchParams.set("appsecret_proof", proof);
  return u.toString();
}
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}/ads_archive`;

/** Keywords padrão (EUA) — busca só por keyword, sem misturar URL de página. Complemente via env se precisar. */
export const AD_LIBRARY_KEYWORDS = [
  "shop",
  "fitness",
  "beauty",
  "make money",
  "crypto",
  "weight loss",
  "supplement",
] as const;

export type MinedAdLibraryRow = {
  title: string;
  niche: string;
  video_url: string | null;
  vsl_url: string | null;
  thumbnail: string | null;
  ad_copy: string | null;
  views_day: number;
  views_week: number;
  active_days: number;
  facebook_ad_id: string;
  mine_source: "ad_library_daily";
  /** Quantas buscas/keywords encontraram o mesmo id (proxy de “mais duplicado”). */
  appearance_count: number;
  /** Host extraído do link de destino, quando existir. */
  landing_domain?: string | null;
};

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 1;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 1;
  return Math.max(1, Math.floor((Date.now() - t) / (86400 * 1000)));
}

function pickNiche(text: string): string {
  const t = text.toLowerCase();
  if (/crypto|bitcoin|ethereum|defi|nft/.test(t)) return "crypto";
  if (/dating|love|relationship|tinder/.test(t)) return "relacionamento";
  if (/fitness|gym|muscle|weight|workout|diet|lose weight/.test(t)) return "fitness";
  if (/money|earn|income|side hustle|online job|make money/.test(t)) return "renda extra";
  if (/health|doctor|pain|supplement|natural|wellness|skincare/.test(t)) return "saúde";
  return "geral";
}

function extractBodies(raw: Record<string, unknown>): string {
  const b = raw.ad_creative_bodies;
  if (Array.isArray(b)) return b.filter((x): x is string => typeof x === "string").join("\n\n").trim();
  if (typeof b === "string") return b;
  return "";
}

function extractVideoUrl(raw: Record<string, unknown>): string | null {
  const v = raw.ad_creative_videos;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0]) {
    const o = v[0] as Record<string, unknown>;
    for (const k of ["video_sd_url", "video_hd_url", "video_url", "url"]) {
      const u = o[k];
      if (typeof u === "string" && /^https?:\/\//i.test(u)) return u;
    }
  }
  const link = raw.ad_creative_link_urls;
  if (Array.isArray(link) && typeof link[0] === "string" && /^https?:\/\//i.test(link[0])) {
    return link[0];
  }
  return null;
}

function mapRow(raw: Record<string, unknown>): MinedAdLibraryRow | null {
  const id = raw.id != null ? String(raw.id) : "";
  if (!id) return null;
  const page = String(raw.page_name ?? "Anúncio Meta");
  const copy = extractBodies(raw);
  const snapshot = typeof raw.ad_snapshot_url === "string" ? raw.ad_snapshot_url : null;
  const video = extractVideoUrl(raw);
  const start = (raw.ad_delivery_start_time ?? raw.ad_creation_time) as string | undefined;
  const days = daysSince(start);
  const views_week = Math.min(500_000, days * 900 + (id.length * 17) % 4000);
  const views_day = Math.max(50, Math.round(views_week / 7));

  return {
    title: page.slice(0, 240),
    niche: pickNiche(`${copy} ${page}`),
    video_url: video,
    vsl_url: video ?? snapshot,
    thumbnail: null,
    ad_copy: copy.slice(0, 8000) || null,
    views_day,
    views_week,
    active_days: days,
    facebook_ad_id: id,
    mine_source: "ad_library_daily",
    appearance_count: 1,
  };
}

async function fetchArchiveOnce(params: {
  accessToken: string;
  searchTerms: string;
  countries: string[];
  pageUrl?: string;
  /** ALL costuma retornar mais linhas que VIDEO sozinho. */
  mediaType: string;
}): Promise<{ data: Record<string, unknown>[]; nextPageUrl?: string }> {
  let url: string;
  if (params.pageUrl) {
    url = withAppSecretProof(params.pageUrl, params.accessToken);
  } else {
    const u = new URL(GRAPH_BASE);
    u.searchParams.set("access_token", params.accessToken);
    u.searchParams.set("ad_reached_countries", JSON.stringify(params.countries));
    u.searchParams.set("ad_active_status", "ACTIVE");
    u.searchParams.set("ad_type", "ALL");
    const mediaType = params.mediaType.trim() || "ALL";
    u.searchParams.set("media_type", mediaType);
    u.searchParams.set("search_terms", params.searchTerms.slice(0, 100));
    u.searchParams.set(
      "fields",
      [
        "id",
        "page_name",
        "ad_snapshot_url",
        "ad_creative_bodies",
        "ad_creative_videos",
        "ad_creative_link_urls",
        "ad_creation_time",
        "ad_delivery_start_time",
        "ad_delivery_stop_time",
        "publisher_platforms",
      ].join(",")
    );
    u.searchParams.set("limit", "50");
    url = withAppSecretProof(u.toString(), params.accessToken);
  }

  const res = await fetch(url);
  const json = (await res.json()) as {
    data?: Record<string, unknown>[];
    error?: { message: string; code?: number; type?: string };
    paging?: { next?: string };
  };

  if (!res.ok || json.error) {
    const er = json.error;
    const parts = [
      er?.message ?? `Ad Library HTTP ${res.status}`,
      er?.code != null ? `código ${er.code}` : "",
      er?.type ? `(${er.type})` : "",
    ].filter(Boolean);
    throw new Error(parts.join(" · "));
  }

  const nextPageUrl = typeof json.paging?.next === "string" ? json.paging.next : undefined;
  return { data: json.data ?? [], nextPageUrl };
}

function resolveMediaType(explicit?: string): string {
  const e = explicit?.trim();
  if (e) return e;
  const fromEnv = (process.env.META_AD_LIBRARY_MEDIA_TYPE ?? "ALL").trim();
  return fromEnv || "ALL";
}

/**
 * Coleta até `maxAds` anúncios únicos (ativos), priorizando volume estimado + dias ativos.
 */
function defaultAdLibraryCountries(): string[] {
  const raw = process.env.META_AD_LIBRARY_COUNTRIES?.trim();
  if (raw) {
    return raw
      .split(/[\s,]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
  }
  return ["US"];
}

/**
 * Se `APIFY_TOKEN` (ou `APIFY_API_TOKEN`) estiver definido, usa o actor
 * `curious_coder/facebook-ads-library-scraper` com URLs só de keyword (default país US em `APIFY_AD_LIBRARY_COUNTRY`).
 * Caso contrário, usa a Graph API (token Meta em `accessToken`).
 */
export async function mineAdLibraryDaily(params: {
  accessToken?: string;
  maxAds?: number;
  countries?: string[];
  keywords?: readonly string[];
  maxPagesPerKeyword?: number;
  /** Sobrescreve META_AD_LIBRARY_MEDIA_TYPE (ex.: retry com ALL). */
  mediaType?: string;
  /**
   * Apify: run menor e `waitSecs` curto para caber no `waitUntil` + `maxDuration` do /feed na Vercel
   * (run grande = timeout e 0 anúncios no Supabase).
   */
  apifyQuickFill?: boolean;
}): Promise<{ rows: MinedAdLibraryRow[]; errors: string[] }> {
  const maxAds = params.maxAds ?? 100;
  const countries = params.countries ?? defaultAdLibraryCountries();
  const keywords = params.keywords ?? AD_LIBRARY_KEYWORDS;
  const maxPages = params.maxPagesPerKeyword ?? 4;
  const mediaType = resolveMediaType(params.mediaType);

  if (isApifyOnlyMode() && !getApifyAdLibraryTokenFromEnv()) {
    return {
      rows: [],
      errors: [
        "APIFY_ONLY=1: defina APIFY_TOKEN na Vercel. A Graph API da Meta não é usada neste modo.",
      ],
    };
  }

  const apify = getApifyAdLibraryTokenFromEnv();
  if (apify) {
    const countryFromEnv = (process.env.APIFY_AD_LIBRARY_COUNTRY ?? "").trim().toUpperCase();
    const country =
      countryFromEnv || (countries[0] ? String(countries[0]).toUpperCase() : "") || "US";
    const kwForRun = params.apifyQuickFill
      ? keywords.slice(0, Math.min(3, Math.max(1, keywords.length)))
      : keywords;

    if (params.apifyQuickFill) {
      const qc = Number(process.env.FEED_QUICK_APIFY_COUNT ?? "64");
      const apifyCount = Math.min(200, Math.max(24, Number.isFinite(qc) && qc > 0 ? Math.floor(qc) : 64));
      const ws = Math.min(110, Math.max(50, Number(process.env.FEED_QUICK_WAIT_SECS ?? "95")));
      const qMin = Number(process.env.FEED_QUICK_MIN_DUP_IN_CATALOG ?? "1");
      const minDupInCatalogOverride = Number.isFinite(qMin) && qMin >= 1 ? Math.floor(qMin) : 1;
      return mineFromApify({
        apifyToken: apify,
        maxAds,
        keywords: kwForRun,
        apifyCount,
        country: country || "US",
        waitSecs: ws,
        minDupInCatalogOverride,
      });
    }

    const rawCount = process.env.APIFY_AD_LIBRARY_COUNT?.trim();
    const n = rawCount != null && rawCount !== "" ? Number(rawCount) : NaN;
    const fromEnv = Number.isFinite(n) && n > 0 ? Math.min(2000, Math.floor(n)) : null;
    const autoScale = Math.min(2000, Math.max(50, maxAds * 3));
    const apifyCount = fromEnv ?? autoScale;
    return mineFromApify({
      apifyToken: apify,
      maxAds,
      keywords: kwForRun,
      apifyCount,
      country: country || "US",
    });
  }

  const accessToken = (params.accessToken ?? "").replace(/^\uFEFF/, "").trim();
  if (!accessToken) {
    return {
      rows: [],
      errors: ["Defina APIFY_TOKEN (Apify) ou META_AD_LIBRARY_ACCESS_TOKEN (Graph API)."],
    };
  }

  const byId = new Map<string, MinedAdLibraryRow>();
  /** Quantas keywords/páginas distintas trouxeram o mesmo id (proxy de “mais escalado” / mais presença). */
  const presenceHits = new Map<string, number>();
  const errors: string[] = [];

  for (const kw of keywords) {
    if (byId.size >= maxAds) break;
    let pageUrl: string | undefined;
    for (let page = 0; page < maxPages && byId.size < maxAds; page++) {
      try {
        const { data, nextPageUrl } = await fetchArchiveOnce({
          accessToken,
          searchTerms: kw,
          countries,
          pageUrl,
          mediaType,
        });
        for (const raw of data) {
          const row = mapRow(raw);
          if (row) {
            presenceHits.set(row.facebook_ad_id, (presenceHits.get(row.facebook_ad_id) ?? 0) + 1);
            byId.set(row.facebook_ad_id, row);
          }
          if (byId.size >= maxAds) break;
        }
        pageUrl = nextPageUrl;
        if (!pageUrl || !data.length) break;
        await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 450)));
      } catch (e) {
        errors.push(`${kw}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }
  }

  const rows = Array.from(byId.values())
    .map((r) => {
      const hits = presenceHits.get(r.facebook_ad_id) ?? 1;
      const dupBoost = Math.min(400_000, Math.max(0, hits - 1) * 12_000);
      return {
        ...r,
        views_week: Math.min(500_000, r.views_week + dupBoost),
        appearance_count: hits,
      };
    })
    .sort((a, b) => b.views_week + b.active_days * 120 - (a.views_week + a.active_days * 120));

  return { rows: rows.slice(0, maxAds), errors };
}
