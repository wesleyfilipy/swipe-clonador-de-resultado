import { requireEnv, env, KEYWORDS } from "./config.js";
import { humanDelay } from "./human.js";
import { collectAdIdsFromSearch, launchBrowser, scrapeAdDetail } from "./scrape/metaAdLibrary.js";
import type { ScrapedAd } from "./scrape/metaAdLibrary.js";
import { captureLanding } from "./landing.js";
import { upsertAdFromScrape, type DomainCounts } from "./persist.js";
import { runCleanup } from "./cleanup.js";

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function runScrape() {
  requireEnv();
  const browser = await launchBrowser();
  const context = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1360, height: 900 },
  });
  const page = await context.newPage();
  const landingPage = await context.newPage();

  const items: ScrapedAd[] = [];

  for (const kw of KEYWORDS) {
    if (items.length >= env.maxAdsPerRun) break;
    const need = Math.min(env.maxPerKeyword, env.maxAdsPerRun - items.length);
    const ids = await collectAdIdsFromSearch(page, kw, need);
    for (const id of ids) {
      if (items.length >= env.maxAdsPerRun) break;
      const scraped = await scrapeAdDetail(page, id);
      if (!scraped) continue;
      items.push(scraped);
      await humanDelay(700, 1900);
    }
    await humanDelay(1500, 3200);
  }

  const domainCounts: DomainCounts = new Map();
  let saved = 0;

  for (const scraped of items) {
    let landing = null as Awaited<ReturnType<typeof captureLanding>> | null;
    if (scraped.landingUrl) {
      landing = await captureLanding(landingPage, scraped.landingUrl);
      await humanDelay(500, 1600);
    }

    const d = landing?.domain ?? (scraped.landingUrl ? safeHost(scraped.landingUrl) : null);
    if (d) {
      domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
    }

    await upsertAdFromScrape({
      scraped,
      landing,
      domainCounts,
      runTranscribe: env.transcribe,
    });
    saved++;
  }

  await landingPage.close();
  await page.close();
  await context.close();
  await browser.close();
  console.log(`Concluído. Anúncios processados: ${saved}`);
}

async function main() {
  const cmd = process.argv[2] ?? "scrape";
  if (cmd === "cleanup") {
    requireEnv();
    const n = await runCleanup();
    console.log(`Limpeza: linhas removidas (retorno RPC): ${n}`);
  } else if (cmd === "full") {
    requireEnv();
    await runScrape();
    const n = await runCleanup();
    console.log(`Limpeza pós-coleta: ${n}`);
  } else {
    await runScrape();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
