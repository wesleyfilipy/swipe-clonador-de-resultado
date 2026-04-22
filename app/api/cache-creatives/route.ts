import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listAdsNeedingCache, mirrorAdCreativeToStorage } from "@/lib/mirror-creative-to-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Faz download dos vídeos (fbcdn → Supabase Storage) e actualiza `video_storage_path` / `thumbnail_storage_path`.
 * Body JSON: `{ "adId"?: "uuid", "limit"?: 2 }` — sem adId, processa até `limit` anúncios com appearance_count ≥ CREATIVE_CACHE_MIN_APPEARANCE (50).
 */
export async function POST(req: Request) {
  if (process.env.CREATIVE_CACHE_ENABLED === "0") {
    return NextResponse.json({ ok: false, error: "CREATIVE_CACHE_ENABLED=0" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  let adId: string | undefined;
  let limit = 2;
  try {
    const j = (await req.json().catch(() => ({}))) as { adId?: string; limit?: number };
    if (typeof j.adId === "string" && j.adId.length > 0) adId = j.adId;
    if (typeof j.limit === "number" && j.limit >= 1 && j.limit <= 8) limit = j.limit;
  } catch {
    /* body opcional */
  }

  const results: { adId: string; ok: boolean; error?: string; videoPath?: string }[] = [];

  if (adId) {
    const r = await mirrorAdCreativeToStorage(adId);
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: r.error, adId }, { status: 502 });
    }
    results.push({ adId, ok: true, videoPath: r.videoPath });
    return NextResponse.json({ ok: true, results });
  }

  const ids = await listAdsNeedingCache(limit);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, message: "Nenhum anúncio elegível (já em cache ou sem vídeo/duplicatas).", results: [] });
  }

  for (const id of ids) {
    const r = await mirrorAdCreativeToStorage(id);
    if (r.ok) {
      results.push({ adId: id, ok: true, videoPath: r.videoPath });
    } else {
      results.push({ adId: id, ok: false, error: r.error });
    }
  }

  return NextResponse.json({ ok: true, results });
}
