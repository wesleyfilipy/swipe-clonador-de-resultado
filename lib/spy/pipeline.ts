import {
  daysSinceStart,
  duplicateGroupKey,
  isScaledAd,
  pickAdId,
  pickCopy,
  pickLinkOrVideo,
  pickPageName,
  pickStartIso,
  pickSnapshotUrl,
} from "@/lib/ad-library-apify";
import { classifyNicheFromAdText, type SpyNiche } from "@/lib/spy/niche-classify";

const SCALED_MIN_DAYS = 5;
const DUP_STRICT_MIN = 3;
const TRENDING_MAX_DAYS = 3;

export type SpyPipelineRow = {
  country: string;
  adLibraryId: string;
  pageName: string;
  adText: string;
  creative: string;
  startDate: string | null;
  daysRunning: number;
  duplicateCount: number;
  isScaled: boolean;
  isWinner: boolean;
  score: number;
  niche: SpyNiche;
  trending: boolean;
  vslUrl: string | null;
  videoUrl: string | null;
  thumbnail: string | null;
  landingUrl: string | null;
  spyIngestBatch: string;
  /** Exibição: compat com feed (views) */
  viewsWeek: number;
  viewsDay: number;
};

/**
 * Uma saída processada por item (não o dump cru do Apify).
 */
export function apifyItemsToPipelineRows(
  items: readonly Record<string, unknown>[],
  country: string,
  spyIngestBatch: string
): SpyPipelineRow[] {
  const byKey = new Map<string, Record<string, unknown>[]>();
  for (const it of items) {
    const k = duplicateGroupKey(it);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(it);
  }

  const seen = new Set<string>();
  const out: SpyPipelineRow[] = [];

  for (const raw of items) {
    const aid = pickAdId(raw);
    if (!aid) continue;
    const k = `${country.toUpperCase()}:${aid}`;
    if (seen.has(k)) continue;
    seen.add(k);

    const gk = duplicateGroupKey(raw);
    const group = byKey.get(gk) ?? [raw];
    const duplicateCount = group.length;
    const dupRelevant = duplicateCount > 2;
    const start = pickStartIso(raw);
    const daysRunning = daysSinceStart(start);
    const isScaled = isScaledAd(start, SCALED_MIN_DAYS);
    const isWinner = dupRelevant && isScaled;
    const score = daysRunning + duplicateCount * 2;
    const copy = pickCopy(raw);
    const niche = classifyNicheFromAdText(copy);
    const trending = daysRunning > 0 && daysRunning <= TRENDING_MAX_DAYS;

    const { video, landing, thumb } = pickLinkOrVideo(raw);
    const snap = pickSnapshotUrl(raw);
    const primaryCreative = thumb || video || (snap ? snap.slice(0, 400) : "") || "";
    const directVsl = video && /^https?:/i.test(video) ? video : null;

    const pageName = pickPageName(raw);
    const viewsWeek = Math.min(1_000_000, Math.round(1000 + score * 1_200));
    const viewsDay = Math.max(1, Math.round(viewsWeek / 7));

    out.push({
      country: country.toUpperCase(),
      adLibraryId: aid,
      pageName,
      adText: copy.slice(0, 20_000),
      creative: primaryCreative,
      startDate: start,
      daysRunning,
      duplicateCount: Math.max(1, duplicateCount),
      isScaled,
      isWinner,
      score,
      niche,
      trending: trending || (isWinner && daysRunning < 8),
      vslUrl: directVsl,
      videoUrl: video,
      thumbnail: thumb,
      landingUrl: landing,
      spyIngestBatch,
      viewsWeek,
      viewsDay,
    });
  }
  return out;
}

export { DUP_STRICT_MIN, SCALED_MIN_DAYS };
