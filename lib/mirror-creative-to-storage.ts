import { createAdminClient } from "@/lib/supabase/admin";
import { canProxyInBrowser, FACEBOOK_LIKE_REFERER } from "@/lib/media";
import { publicUrlForStoragePath, creativesBucketName } from "@/lib/creative-urls";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function maxMirrorBytes(): number {
  const n = Number(process.env.CREATIVE_CACHE_MAX_BYTES ?? 35 * 1024 * 1024);
  return Number.isFinite(n) && n > 0 ? Math.min(80 * 1024 * 1024, Math.floor(n)) : 35 * 1024 * 1024;
}

function minDupForCache(): number {
  const n = Number(process.env.CREATIVE_CACHE_MIN_APPEARANCE ?? "50");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 50;
}

async function fetchRemote(
  url: string
): Promise<{ data: ArrayBuffer; contentType: string; ok: true } | { error: string; ok: false }> {
  const metaLike = canProxyInBrowser(url);
  const res = await fetch(url, {
    redirect: "follow",
    headers: metaLike
      ? {
          Referer: FACEBOOK_LIKE_REFERER,
          "User-Agent": UA,
          Accept: "*/*",
        }
      : { "User-Agent": UA, Accept: "*/*" },
  });
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status} ao buscar` };
  }
  const len = res.headers.get("content-length");
  if (len && Number(len) > maxMirrorBytes()) {
    return { ok: false, error: "Ficheiro demasiado grande" };
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxMirrorBytes()) {
    return { ok: false, error: "Ficheiro demasiado grande após download" };
  }
  return {
    ok: true,
    data: buf,
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}

type AdPatch = { id: string; video_url: string | null; thumbnail: string | null; ad_library_id: string | null; facebook_ad_id: string | null };

function storageKeyBase(ad: AdPatch): string {
  const raw = ad.ad_library_id || ad.facebook_ad_id || ad.id;
  return String(raw).replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 120) || "ad";
}

/**
 * Faz download do vídeo (e thumbnail opcional) e grava no bucket Storage; atualiza `ads`.
 */
export async function mirrorAdCreativeToStorage(
  adId: string
): Promise<{ ok: true; videoPath: string; thumbPath: string | null; publicVideoUrl: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const bucket = creativesBucketName();

  const { data: ad, error: selErr } = await admin
    .from("ads")
    .select("id, video_url, thumbnail, ad_library_id, facebook_ad_id, video_storage_path, thumbnail_storage_path")
    .eq("id", adId)
    .maybeSingle();
  if (selErr) return { ok: false, error: selErr.message };
  if (!ad || !ad.video_url) {
    return { ok: false, error: "Anúncio sem video_url" };
  }
  if (ad.video_storage_path) {
    return {
      ok: true,
      videoPath: ad.video_storage_path,
      thumbPath: ad.thumbnail_storage_path ?? null,
      publicVideoUrl: publicUrlForStoragePath(ad.video_storage_path) ?? "",
    };
  }

  const base = storageKeyBase(ad);
  const videoPath = `${base}/creative.mp4`;
  const vRes = await fetchRemote(ad.video_url);
  if (!vRes.ok) {
    return { ok: false, error: vRes.error };
  }
  const videoType =
    vRes.contentType.startsWith("video/") || vRes.contentType.includes("mp4")
      ? "video/mp4"
      : "video/mp4";

  const { error: upV } = await admin.storage
    .from(bucket)
    .upload(videoPath, vRes.data, { contentType: videoType, upsert: true });
  if (upV) {
    return { ok: false, error: upV.message };
  }

  let thumbPath: string | null = null;
  if (ad.thumbnail) {
    const tRes = await fetchRemote(ad.thumbnail);
    if (tRes.ok) {
      const ext =
        tRes.contentType.includes("png") || ad.thumbnail.toLowerCase().includes(".png")
          ? "png"
          : tRes.contentType.includes("webp")
            ? "webp"
            : "jpg";
      thumbPath = `${base}/thumb.${ext}`;
      const ct =
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const { error: upT } = await admin.storage
        .from(bucket)
        .upload(thumbPath, tRes.data, { contentType: ct, upsert: true });
      if (upT) {
        thumbPath = null;
      }
    }
  }

  const now = new Date().toISOString();
  const { error: uErr } = await admin
    .from("ads")
    .update({
      video_storage_path: videoPath,
      thumbnail_storage_path: thumbPath,
      updated_at: now,
    })
    .eq("id", adId);
  if (uErr) {
    return { ok: false, error: uErr.message };
  }

  const publicVideoUrl = publicUrlForStoragePath(videoPath) ?? "";
  return { ok: true, videoPath, thumbPath, publicVideoUrl };
}

export async function listAdsNeedingCache(limit: number): Promise<string[]> {
  const min = minDupForCache();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ads")
    .select("id")
    .not("video_url", "is", null)
    .is("video_storage_path", null)
    .gte("appearance_count", min)
    .order("views_week", { ascending: false })
    .limit(Math.min(20, Math.max(1, limit)));
  if (error || !data) return [];
  return data.map((r) => r.id);
}
