import { NextRequest, NextResponse } from "next/server";
import { listAdsNeedingCache, mirrorAdCreativeToStorage } from "@/lib/mirror-creative-to-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Secreto: mesmo CRON_SECRET que os outros crons. Query: `?limit=3`
 */
export async function GET(req: NextRequest) {
  if (process.env.CREATIVE_CACHE_ENABLED === "0") {
    return NextResponse.json({ ok: false, skipped: "CREATIVE_CACHE_ENABLED=0" }, { status: 403 });
  }
  const secret = req.nextUrl.searchParams.get("secret") ?? "";
  const expected = (process.env.CRON_SECRET ?? "").trim();
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const limit = Math.min(5, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "2") || 2));
  const ids = await listAdsNeedingCache(limit);
  const results: { adId: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    const r = await mirrorAdCreativeToStorage(id);
    results.push(r.ok ? { adId: id, ok: true } : { adId: id, ok: false, error: r.error });
  }
  return NextResponse.json({ ok: true, count: results.length, results });
}
