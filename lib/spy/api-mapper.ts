import type { AdRow } from "@/types/database";

/** Resposta pública (sem campos internos do Apify). */
export type PublicSpyAd = {
  id: string;
  country: string;
  niche: string;
  pageName: string;
  adText: string | null;
  creative: string | null;
  startDate: string | null;
  daysRunning: number;
  duplicateCount: number;
  isScaled: boolean;
  isWinner: boolean;
  score: number;
  vslUrl: string | null;
  createdAt: string;
  trending?: boolean;
};

export function adRowToPublic(a: AdRow): PublicSpyAd {
  return {
    id: a.id,
    country: a.country ?? "US",
    niche: a.niche,
    pageName: (a.page_name ?? a.title) as string,
    adText: a.ad_copy ?? null,
    creative: a.creative_url ?? a.thumbnail ?? a.video_url ?? null,
    startDate: a.start_date ?? null,
    daysRunning: a.active_days ?? 0,
    duplicateCount: a.duplicate_count ?? a.appearance_count ?? 1,
    isScaled: a.is_scaled ?? false,
    isWinner: a.is_winner ?? false,
    score: Number(a.score ?? 0),
    vslUrl: a.vsl_url ?? null,
    createdAt: a.created_at,
    trending: a.trending ?? undefined,
  };
}
