import type { AdRow } from "@/types/database";
import { toMediaProxyUrl } from "@/lib/media";

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
 */
export function getCreativeVideoSrc(ad: Pick<AdRow, "video_storage_path" | "video_url">): string | null {
  if (ad.video_storage_path) {
    const u = publicUrlForStoragePath(ad.video_storage_path);
    if (u) return u;
  }
  const proxied = toMediaProxyUrl(ad.video_url) ?? ad.video_url;
  return proxied && proxied.length > 0 ? proxied : null;
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
export function hasCreativoFile(ad: Pick<AdRow, "video_storage_path" | "video_url">): boolean {
  if (ad.video_storage_path) return true;
  return Boolean(ad.video_url && ad.video_url.length > 0);
}
