import type { Page } from "playwright";
import { humanDelay } from "./human.js";

export type LandingCapture = {
  url: string | null;
  domain: string | null;
  html: string | null;
  vslVideoUrl: string | null;
  plainText: string;
  ok: boolean;
};

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function captureLanding(page: Page, url: string, timeoutMs = 35_000): Promise<LandingCapture> {
  const domain = hostFromUrl(url);
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const ok = res?.ok() ?? false;
    await humanDelay(400, 1200);
    const html = await page.content();
    const plainText = stripHtml(html).slice(0, 12_000);

    let vslVideoUrl: string | null = null;
    const src = await page.locator("video source").first().getAttribute("src").catch(() => null);
    const vsrc = await page.locator("video").first().getAttribute("src").catch(() => null);
    const candidate = src ?? vsrc;
    if (candidate && /^https?:/i.test(candidate)) {
      vslVideoUrl = candidate;
    } else if (candidate?.startsWith("//")) {
      vslVideoUrl = "https:" + candidate;
    }

    return { url, domain, html, vslVideoUrl, plainText, ok };
  } catch {
    return { url, domain, html: null, vslVideoUrl: null, plainText: "", ok: false };
  }
}
