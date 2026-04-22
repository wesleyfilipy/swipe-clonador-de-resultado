export function isDirectVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return /\.(mp4|webm|mov|m4v|m3u8)(\?|$)/i.test(u) || u.includes("video/mp4");
}

export function isLikelyEmbeddablePage(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
