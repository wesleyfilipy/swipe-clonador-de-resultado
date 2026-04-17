/**
 * Mineração via Meta Ad Library (Graph API: /ads_archive).
 * Token: app Meta com acesso à Ad Library (permissões / revisão conforme política Meta).
 * Docs: https://developers.facebook.com/docs/graph-api/reference/ads_archive/
 */

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}/ads_archive`;

export const AD_LIBRARY_KEYWORDS = [
  "lose weight",
  "make money online",
  "supplement",
  "fitness",
  "crypto",
  "health",
  "dating",
  "weight loss",
  "work from home",
  "skincare",
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
  };
}

async function fetchArchiveOnce(params: {
  accessToken: string;
  searchTerms: string;
  countries: string[];
  pageUrl?: string;
}): Promise<{ data: Record<string, unknown>[]; nextPageUrl?: string }> {
  let url: string;
  if (params.pageUrl) {
    url = params.pageUrl;
  } else {
    const u = new URL(GRAPH_BASE);
    u.searchParams.set("access_token", params.accessToken);
    u.searchParams.set("ad_reached_countries", JSON.stringify(params.countries));
    u.searchParams.set("ad_active_status", "ACTIVE");
    u.searchParams.set("ad_type", "ALL");
    u.searchParams.set("media_type", "VIDEO");
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
    url = u.toString();
  }

  const res = await fetch(url);
  const json = (await res.json()) as {
    data?: Record<string, unknown>[];
    error?: { message: string; code?: number };
    paging?: { next?: string };
  };

  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Ad Library HTTP ${res.status}`);
  }

  const nextPageUrl = typeof json.paging?.next === "string" ? json.paging.next : undefined;
  return { data: json.data ?? [], nextPageUrl };
}

/**
 * Coleta até `maxAds` anúncios únicos (vídeo ativo), priorizando volume estimado + dias ativos.
 */
export async function mineAdLibraryDaily(params: {
  accessToken: string;
  maxAds?: number;
  countries?: string[];
  keywords?: readonly string[];
  maxPagesPerKeyword?: number;
}): Promise<{ rows: MinedAdLibraryRow[]; errors: string[] }> {
  const maxAds = params.maxAds ?? 100;
  const countries = params.countries ?? ["US"];
  const keywords = params.keywords ?? AD_LIBRARY_KEYWORDS;
  const maxPages = params.maxPagesPerKeyword ?? 4;

  const byId = new Map<string, MinedAdLibraryRow>();
  const errors: string[] = [];

  for (const kw of keywords) {
    if (byId.size >= maxAds) break;
    let pageUrl: string | undefined;
    for (let page = 0; page < maxPages && byId.size < maxAds; page++) {
      try {
        const { data, nextPageUrl } = await fetchArchiveOnce({
          accessToken: params.accessToken,
          searchTerms: kw,
          countries,
          pageUrl,
        });
        for (const raw of data) {
          const row = mapRow(raw);
          if (row) byId.set(row.facebook_ad_id, row);
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

  const rows = Array.from(byId.values()).sort(
    (a, b) => b.views_week + b.active_days * 120 - (a.views_week + a.active_days * 120)
  );

  return { rows: rows.slice(0, maxAds), errors };
}
