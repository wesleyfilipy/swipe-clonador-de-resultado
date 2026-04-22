import type { Browser, Page } from "playwright";
import { AD_LIBRARY_ACTIVE, AD_LIBRARY_COUNTRY, env } from "../config.js";
import { humanDelay, microDelay } from "../human.js";

export type ScrapedAd = {
  adLibraryId: string;
  title: string;
  pageName: string;
  adCopy: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  startDate: string | null;
  landingUrl: string | null;
};

function librarySearchUrl(keyword: string) {
  const q = encodeURIComponent(keyword);
  return `https://www.facebook.com/ads/library/?active_status=${AD_LIBRARY_ACTIVE}&ad_type=all&country=${AD_LIBRARY_COUNTRY}&media_type=all&q=${q}`;
}

function libraryAdUrl(id: string) {
  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
}

function extractIdsFromHref(href: string): string | null {
  try {
    const u = new URL(href, "https://www.facebook.com");
    const id = u.searchParams.get("id");
    if (id && /^\d+$/.test(id)) return id;
    const arch = u.searchParams.get("ad_archive_id");
    if (arch && /^\d+$/.test(arch)) return arch;
  } catch {
    /* ignore */
  }
  const m = href.match(/[?&]id=(\d{6,20})/);
  if (m) return m[1];
  const m2 = href.match(/ad_archive_id=(\d{6,20})/);
  return m2 ? m2[1] : null;
}

export async function collectAdIdsFromSearch(page: Page, keyword: string, limit: number): Promise<string[]> {
  await page.goto(librarySearchUrl(keyword), { waitUntil: "domcontentloaded", timeout: 90_000 });
  await humanDelay(1200, 2800);

  const seen = new Set<string>();
  for (let i = 0; i < env.scrollRounds && seen.size < limit; i++) {
    await page.mouse.wheel(0, 900 + Math.floor(Math.random() * 900));
    await microDelay();

    const hrefs = await page
      .$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")).filter(Boolean) as string[])
      .catch(() => [] as string[]);

    for (const h of hrefs) {
      const id = extractIdsFromHref(h);
      if (id) seen.add(id);
      if (seen.size >= limit) break;
    }
    await humanDelay(500, 1400);
  }
  return Array.from(seen).slice(0, limit);
}

async function pickExternalCta(page: Page): Promise<string | null> {
  const hrefs = await page
    .$$eval("a[href]", (as) =>
      as
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => /^https?:\/\//i.test(h))
        .filter(
          (h) =>
            !/facebook\.com|fbcdn\.net|instagram\.com|meta\.com|whatsapp\.com/i.test(h)
        )
    )
    .catch(() => [] as string[]);

  const uniq: string[] = [];
  const doms = new Set<string>();
  for (const h of hrefs) {
    try {
      const host = new URL(h).hostname;
      if (doms.has(host)) continue;
      doms.add(host);
      uniq.push(h);
      if (uniq.length >= 6) break;
    } catch {
      /* skip */
    }
  }
  return uniq[0] ?? null;
}

async function readVideoSrc(page: Page): Promise<string | null> {
  const v = page.locator("video").first();
  const src = (await v.getAttribute("src").catch(() => null)) ?? (await v.locator("source").first().getAttribute("src").catch(() => null));
  if (src && /^https?:/i.test(src)) return src;
  if (src?.startsWith("//")) return "https:" + src;
  return null;
}

async function readOgImage(page: Page): Promise<string | null> {
  return page.locator('meta[property="og:image"]').getAttribute("content").catch(() => null);
}

function parseStartDateFromText(text: string): string | null {
  const m = text.match(/Started running on\s+([^\n]+)/i);
  if (!m) return null;
  const d = Date.parse(m[1]);
  if (Number.isNaN(d)) return null;
  return new Date(d).toISOString();
}

export async function scrapeAdDetail(page: Page, adLibraryId: string): Promise<ScrapedAd | null> {
  try {
    await page.goto(libraryAdUrl(adLibraryId), { waitUntil: "domcontentloaded", timeout: 75_000 });
    await humanDelay(800, 2000);
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const videoUrl = await readVideoSrc(page);
    const thumbnailUrl = await readOgImage(page);
    const landingUrl = await pickExternalCta(page);
    const startDate = parseStartDateFromText(bodyText);

    const pageName =
      (await page.locator("h1").first().innerText().catch(() => "")) ||
      (await page.locator("h2").first().innerText().catch(() => "")) ||
      "Página do anunciante";

    const title = pageName.slice(0, 200);
    const adCopy = bodyText.replace(/\s+/g, " ").trim().slice(0, 8000);

    return {
      adLibraryId,
      title,
      pageName: pageName.slice(0, 400),
      adCopy,
      videoUrl,
      thumbnailUrl,
      startDate,
      landingUrl,
    };
  } catch {
    return null;
  }
}

export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  const proxy = env.proxyServer
    ? { server: env.proxyServer }
    : undefined;

  return chromium.launch({
    headless: !env.headful,
    proxy,
    args: ["--disable-blink-features=AutomationControlled"],
  });
}
