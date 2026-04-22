/** Usado no proxy / fetch: muitas CDNs da Meta exigem referência à própria Meta. */
export const FACEBOOK_LIKE_REFERER = "https://www.facebook.com/";

export function isDirectVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (/\.(mp4|webm|mov|m4v|m3u8)(\?|$)/i.test(u) || u.includes("video/mp4")) return true;
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes("fbcdn.net") && !/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(u)) return true;
  } catch {
    /* empty */
  }
  return false;
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

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Fbcdn, facebook.com, Instagram CDN — bloqueiam <video>/<img> direto noutro site sem Referer. */
export function canProxyInBrowser(url: string | null | undefined): boolean {
  if (!url) return false;
  const h = hostnameOf(url);
  if (!h) return false;
  if (h.includes("fbcdn.net") || h.endsWith(".fbcdn.net")) return true;
  if (h === "l.facebook.com" || h.endsWith(".facebook.com")) return true;
  if (h.endsWith(".fbsbx.com") || h.includes("fbsbx.com")) return true;
  if (h.endsWith(".instagram.com") || h.includes("cdninstagram")) return true;
  return false;
}

export function toMediaProxyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!canProxyInBrowser(url)) return url;
  return `/api/media-proxy?url=${encodeURIComponent(url)}`;
}

/** Facebook, Instagram, etc. enviam X-Frame-Options: o iframe fica vazio. */
export function isEmbeddableInIframe(url: string | null | undefined): boolean {
  if (!isLikelyEmbeddablePage(url)) return false;
  const h = hostnameOf(url!);
  if (h.endsWith("facebook.com") || h === "l.facebook.com" || h.includes("fbsbx.com")) return false;
  if (h.endsWith("instagram.com") || h.includes("cdninstagram")) return false;
  if (h === "m.facebook.com" || h === "www.facebook.com") return false;
  if (h.endsWith("google.com") && (url!.includes("/ads/") || url!.includes("doubleclick"))) return false;
  return true;
}

export function safeHttpUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}
