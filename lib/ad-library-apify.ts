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
  const image =
    firstNonEmptyString(
      c?.imageUrl,
      c?.image_url,
      c?.originalImageUrl,
      item.imageUrl,
      item.image_url,
      item.thumbnailUrl,
      item.thumbnail_url
    ) || null;
  const video = firstNonEmptyString(
    c?.videoUrl,
    c?.video_url,
    item.videoUrl,
    item.video_url,
    item.video
  ) || null;
  const link =
    firstNonEmptyString(
      c?.linkUrl,
      c?.link_url,
      item.linkUrl,
      item.link_url,
      item.landingPageUrl,
      item.ctaUrl,
      item.url
    ) || null;
  return { video, landing: link, thumb: image };
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
  const snap = pickSnapshotUrl(raw);
  const { video, landing, thumb } = pickLinkOrVideo(raw);

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
    vsl_url: video ?? snap ?? landing,
    thumbnail: thumb,
    ad_copy: copy.slice(0, 8000) || null,
    views_day,
    views_week,
    active_days: days,
    facebook_ad_id: id,
    mine_source: "ad_library_daily",
    appearance_count: ctx.duplicateSize,
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
    const start = pickStartIso(raw);
    const scaled = isScaledAd(start, minDays);
    const strong = isStrongDupBySize(dupSize, minDup);
    const winner = strong && scaled;
    const row = mapItemToRow(raw, { duplicateSize: dupSize, winner, scaled });
    if (row) {
      seenId.add(id);
      rows.push(row);
    }
  }

  return { rows, errors };
}

function isStrongDupBySize(n: number, minDup: number): boolean {
  return n >= minDup;
}
