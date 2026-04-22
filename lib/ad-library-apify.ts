/**
 * Coleta via Apify: actor curious_coder/facebook-ads-library-scraper.
 * Não exige token Meta; exige APIFY_TOKEN (ou APIFY_API_TOKEN).
 */
// Apify SDK faz require dinâmico a `proxy-agent` em `http_client.js` — o trace da Vercel/Next não a seguia. Import explícito força a cópia para /var/task.
import "proxy-agent";
import { ApifyClient } from "apify-client";
import type { MinedAdLibraryRow } from "@/lib/ad-library-miner";

function pickNicheFromText(text: string): string {
  const t = text.toLowerCase();
  if (/crypto|bitcoin|ethereum|defi|nft/.test(t)) return "crypto";
  if (/dating|love|relationship|tinder/.test(t)) return "relacionamento";
  if (/fitness|gym|muscle|weight|workout|diet|lose weight|weight loss/.test(t)) return "fitness";
  if (/money|earn|income|side hustle|online job|make money|shop|beauty|supplement/.test(t)) return "renda extra";
  if (/health|doctor|pain|supplement|natural|wellness|skincare|beauty/.test(t)) return "saúde";
  return "geral";
}

const APIFY_ACTOR = "curious_coder/facebook-ads-library-scraper";

/** URL da *pesquisa* na Ad Library (q=, search_type=…), que o actor às vezes cola em `item.url` — inútil como criativo ou landing. */
export function isAdLibraryKeywordSearchUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url.trim());
    if (!/^(www\.)?facebook\.com$/i.test(u.hostname)) return false;
    if (!u.pathname.toLowerCase().includes("/ads/library")) return false;
    if (u.searchParams.get("id") && /^\d+$/.test(String(u.searchParams.get("id")))) return false;
    if (u.searchParams.get("view_all_page_id") && u.searchParams.get("view_all_page_id")!.length > 0) {
      return false;
    }
    const st = u.searchParams.get("search_type");
    const hasQ = u.searchParams.get("q") != null && String(u.searchParams.get("q")).length > 0;
    if (st === "keyword_unordered" || st === "keyword_ordered" || st === "keyword" || hasQ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function firstCardRecord(item: Record<string, unknown>): Record<string, unknown> | null {
  const a = item.cards;
  if (Array.isArray(a) && a[0] && typeof a[0] === "object" && !Array.isArray(a[0])) {
    return a[0] as Record<string, unknown>;
  }
  const b = item.adCards;
  if (Array.isArray(b) && b[0] && typeof b[0] === "object" && !Array.isArray(b[0])) {
    return b[0] as Record<string, unknown>;
  }
  return asRecord(item.card) ?? asRecord((item as { adCard?: unknown }).adCard);
}

function firstNonSearchLanding(...cands: unknown[]): string | null {
  for (const c of cands) {
    const s = firstNonEmptyString(c);
    if (s && !isAdLibraryKeywordSearchUrl(s)) return s;
  }
  return null;
}

function adLibraryIdUrl(adArchiveId: string): string {
  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(adArchiveId)}`;
}

export function getApifyAdLibraryTokenFromEnv(): string {
  return (process.env.APIFY_TOKEN ?? process.env.APIFY_API_TOKEN ?? "").replace(/^\uFEFF/, "").trim();
}

/** Se `1`, a mineração usa **só** o Apify (nunca a Graph API da Meta), mesmo com `META_*` definido. */
export function isApifyOnlyMode(): boolean {
  return process.env.APIFY_ONLY === "1" || process.env.APIFY_ONLY === "true";
}

function firstNonEmptyString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length) return c.trim();
  }
  return "";
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

export function pickAdId(item: Record<string, unknown>): string {
  return firstNonEmptyString(
    item.adArchiveId,
    item.adArchiveID,
    item.ad_archive_id,
    item.adId,
    item.adID,
    item.id
  );
}

export function pickPageName(item: Record<string, unknown>): string {
  return firstNonEmptyString(item.pageName, item.page_name, item.advertiser) || "Anúncio";
}

export function pickCopy(item: Record<string, unknown>): string {
  const direct = firstNonEmptyString(
    item.adCopy,
    item.ad_creative_bodies,
    item.body,
    item.text,
    item.primaryText
  );
  if (direct) return direct;
  const bodies = item.adCreativeBodies;
  if (Array.isArray(bodies)) {
    return bodies
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .join("\n\n")
      .trim();
  }
  return "";
}

export function pickStartIso(item: Record<string, unknown>): string | null {
  return (
    firstNonEmptyString(
      item.startDate,
      item.start_date,
      item.adDeliveryStartTime,
      item.ad_delivery_start_time,
      item.adCreationTime,
      item.ad_creation_time
    ) || null
  );
}

export function pickLinkOrVideo(item: Record<string, unknown>): { video: string | null; landing: string | null; thumb: string | null } {
  const c = asRecord(item.creative);
  const card = firstCardRecord(item);
  const cc = card ? asRecord(card.creative) : null;
  const image =
    firstNonEmptyString(
      c?.imageUrl,
      c?.image_url,
      c?.originalImageUrl,
      c?.thumbnail,
      item.imageUrl,
      item.image_url,
      item.thumbnailUrl,
      item.thumbnail_url,
      item.image,
      item.resizedImageUrl,
      item.snapshotThumbnailUrl,
      item.snapshot_thumbnail,
      item.snapshotUrl,
      card?.imageUrl,
      card?.image_url,
      card?.thumbnail,
      card?.resizedImageUrl,
      (card as { originalImageUrl?: string })?.originalImageUrl,
      (item as { originalImageUrl?: string }).originalImageUrl,
      cc?.imageUrl,
      cc?.image_url
    ) || null;
  let video =
    firstNonEmptyString(
      c?.videoUrl,
      c?.video_url,
      item.videoUrl,
      item.video_url,
      item.video,
      item.playableUrl,
      item.playable_url,
      item.playable,
      item.videoSDUrl,
      item.videoHDUrl,
      item.video_sd_url,
      item.video_hd_url,
      item.permalink_url,
      item.permalink,
      (item as { videoUhdUrl?: string }).videoUhdUrl,
      card?.videoUrl,
      card?.video_url,
      (card as { video?: string })?.video,
      (card as { playbackUrl?: string })?.playbackUrl,
      (card as { hdUrl?: string })?.hdUrl,
      (card as { sdUrl?: string })?.sdUrl,
      cc?.videoUrl,
      cc?.video_url
    ) || null;
  if (video && isAdLibraryKeywordSearchUrl(video)) video = null;
  const link = firstNonSearchLanding(
    c?.linkUrl,
    c?.link_url,
    item.linkUrl,
    item.link_url,
    item.landingPageUrl,
    item.landing_page_url,
    item.landing,
    (item as { website?: string }).website,
    (item as { ctaUrl?: string }).ctaUrl,
    (item as { cta_url?: string }).cta_url,
    (item as { callToActionUrl?: string }).callToActionUrl,
    item.ctaUrl,
    card?.linkUrl,
    card?.link_url,
    (card as { website?: string })?.website,
    (card as { link?: string })?.link,
    item.url
  );
  return { video, landing: link, thumb: image || null };
}

export function pickSnapshotUrl(item: Record<string, unknown>): string | null {
  return firstNonEmptyString(
    item.adSnapshotUrl,
    item.ad_snapshot_url,
    item.snapshotOfAdsCreatives,
    item.snapshot_of_ads_creatives
  ) || null;
}

export function daysSinceStart(iso: string | null | undefined): number {
  if (!iso) return 1;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 1;
  return Math.max(1, Math.floor((Date.now() - t) / 86400_000));
}

/** Indicador simples: anúncio rodando há mais que N dias. */
export function isScaledAd(
  startIso: string | null,
  minDays: number
): boolean {
  if (!startIso) return false;
  const t = Date.parse(startIso);
  if (Number.isNaN(t)) return false;
  const days = (Date.now() - t) / 86_400_000;
  return days > minDays;
}

/** Chave de agrupamento: snapshot ou imagem do criativo (mesmo padrão do seu fluxo de duplicados). */
export function duplicateGroupKey(item: Record<string, unknown>): string {
  const snap = pickSnapshotUrl(item);
  if (snap) return `s:${snap}`;
  const { thumb } = pickLinkOrVideo(item);
  if (thumb) return `i:${thumb}`;
  const id = pickAdId(item);
  if (id) return `u:${id}`;
  return `h:${firstNonEmptyString(item.headline, item.title).slice(0, 200)}|${pickCopy(item).slice(0, 120)}`;
}

export function buildAdLibraryUsKeywordUrls(
  keywords: readonly string[],
  country: string
): { url: string }[] {
  const cc = (country || "US").toUpperCase();
  return keywords.map((q) => ({
    url: `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${cc}&q=${encodeURIComponent(
      q
    )}&search_type=keyword_unordered&media_type=all`,
  }));
}

function mapItemToRow(
  raw: Record<string, unknown>,
  ctx: { duplicateSize: number; winner: boolean; scaled: boolean }
): MinedAdLibraryRow | null {
  const id = pickAdId(raw);
  if (!id) return null;
  const page = pickPageName(raw);
  const copy = pickCopy(raw);
  const start = pickStartIso(raw);
  const days = daysSinceStart(start);
  let snap = pickSnapshotUrl(raw);
  if (snap && isAdLibraryKeywordSearchUrl(snap)) snap = null;
  const picked = pickLinkOrVideo(raw);
  let { video, landing, thumb } = picked;
  if (!video) {
    const d = deepFindMediaUrl(raw, isLikelyVideoCdnUrl);
    if (d) video = d;
  }
  if (!thumb) {
    const t = deepFindMediaUrl(raw, isLikelyThumbCdnUrl);
    if (t) thumb = t;
  }
  let landingHost: string | null = null;
  if (landing && !isAdLibraryKeywordSearchUrl(landing)) {
    try {
      landingHost = new URL(landing).hostname.replace(/^www\./i, "") || null;
    } catch {
      landingHost = null;
    }
  }

  const baseWeek = Math.min(500_000, days * 900 + (id.length * 17) % 4_000);
  const dupBoost = Math.min(400_000, Math.max(0, ctx.duplicateSize - 1) * 12_000);
  const scaleBoost = ctx.scaled ? 25_000 : 0;
  const winBoost = ctx.winner ? 80_000 : 0;
  const views_week = Math.min(500_000, baseWeek + dupBoost + scaleBoost + winBoost);
  const views_day = Math.max(50, Math.round(views_week / 7));

  return {
    title: page.slice(0, 240),
    niche: pickNicheFromText(`${copy} ${page}`),
    video_url: video,
    /** Nunca a URL de pesquisa (q=+keyword); se não houver criativo, fallback para a página *deste* anúncio na Ad Library. */
    vsl_url: video ?? snap ?? landing ?? adLibraryIdUrl(id),
    thumbnail: thumb,
    ad_copy: copy.slice(0, 8000) || null,
    views_day,
    views_week,
    active_days: days,
    facebook_ad_id: id,
    mine_source: "ad_library_daily",
    appearance_count: ctx.duplicateSize,
    landing_domain: landingHost,
  };
}

function defaultScaledMinDays(): number {
  const n = Number(process.env.AD_LIBRARY_SCALED_MIN_DAYS ?? "5");
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function defaultDupGroupMinSize(): number {
  const n = Number(process.env.AD_LIBRARY_DUP_GROUP_MIN ?? "3");
  return Number.isFinite(n) && n > 1 ? Math.floor(n) : 3;
}

/** Só entram no catálogo anúncios com >= N duplicatas (lote do Apify e/ou contagem reportada pela Meta, quando existir). Padrão 50. */
function defaultMinDupForCatalog(): number {
  const n = Number(process.env.AD_LIBRARY_MIN_DUP_IN_CATALOG ?? "50");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 50;
}

function catalogRequireScaledOnly(): boolean {
  const v = (process.env.AD_LIBRARY_CATALOG_REQUIRE_SCALED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function catalogRequireVideoOrThumb(): boolean {
  const v = (process.env.AD_LIBRARY_CATALOG_REQUIRE_MEDIA ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * A Meta/Apify às vezes expõe quantas entradas repetem o mesmo criativo.
 * O nosso `duplicateGroupKey` também conta linhas do dataset com o mesmo thumb/snapshot.
 */
function pickReportedLibraryDupCount(item: Record<string, unknown>): number {
  const keys = [
    "collationCount",
    "collation_count",
    "duplicateCount",
    "duplicate_count",
    "totalAdCount",
    "total_ad_count",
    "adCount",
    "ad_count",
    "numberOfAds",
    "number_of_ads",
    "adsWithSameCreative",
    "ads_with_same_creative",
    "adCardsCount",
    "ad_cards_count",
  ] as const;
  let best = 0;
  for (const k of keys) {
    const v = item[k as keyof typeof item] as unknown;
    if (typeof v === "number" && v > 0) best = Math.max(best, Math.floor(v));
    else if (typeof v === "string" && /^\d+$/.test(v)) best = Math.max(best, parseInt(v, 10));
  }
  return best;
}

const DEEP_MAX_NODES = 180;

function isLikelyVideoCdnUrl(s: string): boolean {
  if (!/^https?:\/\//i.test(s) || s.length > 4_000) return false;
  if (!/fbcdn|facebook|fbsbx/i.test(s)) return false;
  if (/search_type=keyword|\/ads\/library\?.*&q=/i.test(s)) return false;
  return (
    /\/v\/|video|\.mp4|m3u8|\.mov|\.webm|t\d+\.\d+-\d+/i.test(s) || (s.includes("fbcdn.net") && !/\.(jpe?g|png|gif|webp)(\?|$)/i.test(s))
  );
}

function isLikelyThumbCdnUrl(s: string): boolean {
  if (!/^https?:\/\//i.test(s) || s.length > 4_000) return false;
  if (!/fbcdn|scontent|facebook|fbsbx|cdninstagram/i.test(s)) return false;
  if (/search_type=keyword/i.test(s)) return false;
  return /\.(jpe?g|png|gif|webp)(\?|$)/i.test(s) || (s.includes("scontent") && /safe_image|_n\.jpg|pic\.php/i.test(s));
}

/** Campos aninhados (cards, raw, body) muitas vezes têm o URL do vídeo onde os getters diretos falham. */
function deepFindMediaUrl(
  root: unknown,
  pick: (s: string) => boolean
): string | null {
  let seen = 0;
  const visit = (x: unknown, depth: number): string | null => {
    if (seen > DEEP_MAX_NODES || depth < 0) return null;
    if (x == null) return null;
    if (typeof x === "string" && x.length > 12 && x.startsWith("http") && pick(x)) {
      return x;
    }
    if (typeof x !== "object") return null;
    if (Array.isArray(x)) {
      for (const el of x) {
        seen += 1;
        const f = visit(el, depth - 1);
        if (f) return f;
      }
      return null;
    }
    for (const v of Object.values(x as object)) {
      seen += 1;
      const f = visit(v, depth - 1);
      if (f) return f;
    }
    return null;
  };
  return visit(root, 6);
}

export async function listAllApifyDatasetItems(
  client: ApifyClient,
  datasetId: string
): Promise<Record<string, unknown>[]> {
  const limit = 1_000;
  let offset = 0;
  const out: Record<string, unknown>[] = [];
  for (;;) {
    const res = await client.dataset(datasetId).listItems({ limit, offset, clean: true });
    const batch = (res as { items?: unknown[] }).items;
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const it of batch) {
      if (it && typeof it === "object" && !Array.isArray(it)) {
        out.push(it as Record<string, unknown>);
      }
    }
    if (batch.length < limit) break;
    offset += limit;
  }
  return out;
}

export type MineFromApifyParams = {
  apifyToken: string;
  maxAds: number;
  keywords: readonly string[];
  /** Limite de resultados do actor (total da run, distribuído entre as URLs de keyword). */
  apifyCount: number;
  country: string;
  /** Sobrescreve o tempo máximo de espera da run do actor (preenchimento rápido no /feed). */
  waitSecs?: number;
  /**
   * Mínimo de duplicatas para entrar no catálogo (só o Apify, sem gravar 50+).
   * Ex.: preenchimento rápido do /feed passa 1; crons usam `AD_LIBRARY_MIN_DUP_IN_CATALOG` (padrão 50).
   */
  minDupInCatalogOverride?: number;
};

/**
 * Roda o actor e devolve itens brutos do dataset (feed semanal / pipelines custom).
 */
export async function fetchApifyAdLibraryItems(p: {
  apifyToken: string;
  country: string;
  keywords: readonly string[];
  count: number;
  waitSecs?: number;
}): Promise<{
  items: Record<string, unknown>[];
  errors: string[];
  runId: string;
  defaultDatasetId: string;
}> {
  const errors: string[] = [];
  const client = new ApifyClient({ token: p.apifyToken });
  const urls = buildAdLibraryUsKeywordUrls(p.keywords, p.country);
  if (urls.length === 0) {
    return { items: [], errors: ["Nenhuma keyword para o Apify."], runId: "", defaultDatasetId: "" };
  }
  const input: Record<string, string | number | { url: string }[]> = {
    urls,
    count: p.count,
    "scrapePageAds.activeStatus": "all",
    "scrapePageAds.sortBy": (process.env.APIFY_AD_LIBRARY_SORT_BY ?? "impressions_desc").trim() || "impressions_desc",
  };
  const defaultWait = Math.min(86_400, Math.max(120, Number(process.env.APIFY_RUN_WAIT_SECS ?? "3600")));
  const callOpts = { waitSecs: p.waitSecs ?? defaultWait } as { waitSecs: number };
  let run: { defaultDatasetId?: string; id: string; status: string };
  try {
    run = (await client.actor(APIFY_ACTOR).call(input, callOpts)) as {
      defaultDatasetId?: string;
      id: string;
      status: string;
    };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return { items: [], errors, runId: "", defaultDatasetId: "" };
  }
  if (!run.defaultDatasetId) {
    errors.push("Run do Apify sem defaultDatasetId.");
    return { items: [], errors, runId: run.id, defaultDatasetId: "" };
  }
  let items: Record<string, unknown>[];
  try {
    items = await listAllApifyDatasetItems(client, run.defaultDatasetId);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return { items: [], errors, runId: run.id, defaultDatasetId: run.defaultDatasetId };
  }
  return { items, errors, runId: run.id, defaultDatasetId: run.defaultDatasetId };
}

/**
 * 1) Agrupa duplicados por snapshot/imagem; grupos "fortes" têm tamanho >= AD_LIBRARY_DUP_GROUP_MIN.
 * 2) Marca escalados: start + dias > AD_LIBRARY_SCALED_MIN_DAYS.
 * 3) Prioriza "vencedores" = mesma linha de raciocínio (duplicado forte ∩ escalado), sem descartar o resto (até maxAds).
 */
export async function mineFromApify(
  p: MineFromApifyParams
): Promise<{ rows: MinedAdLibraryRow[]; errors: string[] }> {
  const minDup = defaultDupGroupMinSize();
  const minDays = defaultScaledMinDays();
  const minCat =
    p.minDupInCatalogOverride != null
      ? Math.max(1, Math.floor(p.minDupInCatalogOverride))
      : defaultMinDupForCatalog();
  const requireScaled = catalogRequireScaledOnly();
  const requireMedia = catalogRequireVideoOrThumb();
  const { items, errors } = await fetchApifyAdLibraryItems({
    apifyToken: p.apifyToken,
    country: p.country,
    keywords: p.keywords,
    count: p.apifyCount,
    waitSecs: p.waitSecs,
  });
  if (items.length === 0) {
    return { rows: [], errors: errors.length ? errors : [] };
  }

  const byKey = new Map<string, Record<string, unknown>[]>();
  for (const it of items) {
    const k = duplicateGroupKey(it);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(it);
  }

  const rows: MinedAdLibraryRow[] = [];
  const seenId = new Set<string>();

  const orderedItems = items.slice().sort((a, b) => {
    const gka = duplicateGroupKey(a);
    const gkb = duplicateGroupKey(b);
    const ga = (byKey.get(gka) ?? []).length;
    const gb = (byKey.get(gkb) ?? []).length;
    const sa = isStrongDupBySize(ga, minDup) ? 1 : 0;
    const sb = isStrongDupBySize(gb, minDup) ? 1 : 0;
    if (sb !== sa) return sb - sa;
    if (gb !== ga) return gb - ga;
    const dsa = pickStartIso(a);
    const dsb = pickStartIso(b);
    return daysSinceStart(dsb) - daysSinceStart(dsa);
  });

  for (const raw of orderedItems) {
    if (rows.length >= p.maxAds) break;
    const id = pickAdId(raw);
    if (!id || seenId.has(id)) continue;
    const k = duplicateGroupKey(raw);
    const group = byKey.get(k) ?? [raw];
    const dupSize = group.length;
    const reported = pickReportedLibraryDupCount(raw);
    const effectiveDups = Math.max(dupSize, reported);
    if (effectiveDups < minCat) {
      continue;
    }
    const start = pickStartIso(raw);
    const scaled = isScaledAd(start, minDays);
    if (requireScaled && !scaled) {
      continue;
    }
    const strong = isStrongDupBySize(dupSize, minDup);
    const winner = strong && scaled;
    const row = mapItemToRow(raw, { duplicateSize: effectiveDups, winner, scaled });
    if (!row) continue;
    if (requireMedia && !row.video_url && !row.thumbnail) {
      continue;
    }
    seenId.add(id);
    rows.push(row);
  }

  return { rows, errors };
}

function isStrongDupBySize(n: number, minDup: number): boolean {
  return n >= minDup;
}
