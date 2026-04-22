import type { AdRow } from "@/types/database";
import { isDirectVideoUrl, toMediaProxyUrl } from "@/lib/media";

/** Nome lógico do bucket (Documentação Supabase → Storage; criar com migration_storage_creatives.sql). */
export function creativesBucketName(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_CREATIVES_BUCKET ?? "creatives").replace(/\/+/g, "");
}

/**
 * URL pública de um object key no Storage (bucket público de leitura).
 * Não requer o SDK no cliente.
 */
export function publicUrlForStoragePath(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!base) return null;
  const b = creativesBucketName();
  const segs = relativePath.split("/").map((s) => encodeURIComponent(s));
  return `${base}/storage/v1/object/public/${b}/${segs.join("/")}`;
}

/**
 * Vídeo do criativo: prioriza ficheiro já espelhado no Storage (reprodução e download sem depender de fbcdn).
 * Se `video_url` veio vazio da mineração mas `vsl_url` é um MP4/cdn, usa VSL (evita painel vazio injustificado).
 */
export function getCreativeVideoSrc(
  ad: Pick<AdRow, "video_storage_path" | "video_url" | "vsl_url">
): string | null {
  if (ad.video_storage_path) {
    const u = publicUrlForStoragePath(ad.video_storage_path);
    if (u) return u;
  }
  const proxied = toMediaProxyUrl(ad.video_url) ?? ad.video_url;
  if (proxied && proxied.length > 0) return proxied;
  if (ad.vsl_url && isDirectVideoUrl(ad.vsl_url)) {
    return toMediaProxyUrl(ad.vsl_url) ?? ad.vsl_url;
  }
  return null;
}

export function getCreativeThumbSrc(
  ad: Pick<AdRow, "thumbnail_storage_path" | "thumbnail">
): string | null {
  if (ad.thumbnail_storage_path) {
    const u = publicUrlForStoragePath(ad.thumbnail_storage_path);
    if (u) return u;
  }
  const p = toMediaProxyUrl(ad.thumbnail) ?? ad.thumbnail;
  return p && p.length > 0 ? p : null;
}

/** Há ficheiro para player ou para download. */
export function hasCreativoFile(
  ad: Pick<AdRow, "video_storage_path" | "video_url" | "vsl_url">
): boolean {
  if (ad.video_storage_path) return true;
  if (ad.video_url && ad.video_url.length > 0) return true;
  return Boolean(ad.vsl_url && isDirectVideoUrl(ad.vsl_url));
}

/** URL “real” (Storage ou origin) para o endpoint /api/download (sem path do proxy). */
export function getCreativoDownloadSourceUrl(
  ad: Pick<AdRow, "video_storage_path" | "video_url" | "vsl_url">
): string | null {
  const st = publicUrlForStoragePath(ad.video_storage_path);
  if (st) return st;
  if (ad.video_url && ad.video_url.length > 0) return ad.video_url;
  if (ad.vsl_url && isDirectVideoUrl(ad.vsl_url)) return ad.vsl_url;
  return null;
}

/** VSL em split em baixo: esconde se o único vídeo disponível é o mesmo `vsl_url` já mostrado em cima. */
export function hideDuplicateVslSplit(
  ad: Pick<AdRow, "video_storage_path" | "video_url" | "vsl_url">
): boolean {
  const hasDedicatedCreative = Boolean(
    ad.video_storage_path || (ad.video_url && ad.video_url.length > 0)
  );
  return !hasDedicatedCreative && Boolean(ad.vsl_url && isDirectVideoUrl(ad.vsl_url));
}
