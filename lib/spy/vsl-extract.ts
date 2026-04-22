const FETCH_TIMEOUT_MS = 12_000;
const YT = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)[^"'\\s)]+/i;
const VIM = /https?:\/\/(?:player\.)?vimeo\.com\/video\/[0-9]+/i;
const VIM2 = /https?:\/\/vimeo\.com\/[0-9]+/i;
const VSRC = /<source[^>]+src=["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)/i;
const VIDEO = /<video[^>]+src=["'](https?:\/\/[^"']+)/i;
const IFR = /<iframe[^>]+src=["'](https?:\/\/[^"']+)/i;

function firstMatchFromHtml(html: string): string | null {
  for (const re of [YT, VIM, VIM2, IFR, VIDEO, VSRC]) {
    const m = html.match(re);
    if (m?.[0]) {
      const u = m[0].replace(/&amp;/g, "&");
      if (u.startsWith("http")) return u;
    }
  }
  return null;
}

/**
 * Só anúncios vencedores: busca a landing, extrai o primeiro sinal de VSL (YouTube, Vimeo, <video> ou iframe).
 */
export async function extractVslFromLandingPage(landingUrl: string | null | undefined): Promise<string | null> {
  if (!landingUrl || !/^https?:\/\//i.test(landingUrl.trim())) return null;
  const url = landingUrl.trim();
  const c = new AbortController();
  const to = setTimeout(() => c.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: c.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; WinningAdsSpy/1.0; +https://www.example.com) AppleWebKit/537.36 (KHTML, like Gecko)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return firstMatchFromHtml(html);
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

export async function enrichVslBatch(
  items: { landing: string | null; enrich: (v: string | null) => void }[],
  concurrency: number
): Promise<void> {
  const c = Math.max(1, Math.min(8, concurrency));
  for (let i = 0; i < items.length; i += c) {
    const slice = items.slice(i, i + c);
    await Promise.all(
      slice.map(async (t) => {
        const v = await extractVslFromLandingPage(t.landing);
        t.enrich(v);
      })
    );
  }
}
