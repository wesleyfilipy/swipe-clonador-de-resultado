import { adminClient } from "./supabaseAdmin.js";
import { classifyNiche } from "./classifyNiche.js";
import type { LandingCapture } from "./landing.js";
import { computeScore, classifyStatus, daysBetween } from "./score.js";
import type { ScrapedAd } from "./scrape/metaAdLibrary.js";
import { uploadPublicFile } from "./storageUpload.js";
import { transcribeRemoteVideo } from "./transcribe.js";
import { env } from "./config.js";
import { humanDelay } from "./human.js";

export type DomainCounts = Map<string, number>;

async function downloadBuf(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function maybeTranscribe(internalId: string, creativeUrl: string | null, vslVideoUrl: string | null) {
  if (creativeUrl && /^https?:/i.test(creativeUrl)) {
    await transcribeRemoteVideo({ videoUrl: creativeUrl, internalAdId: internalId, type: "creative" }).catch(() => null);
  }
  if (vslVideoUrl && /^https?:/i.test(vslVideoUrl)) {
    await transcribeRemoteVideo({ videoUrl: vslVideoUrl, internalAdId: internalId, type: "vsl" }).catch(() => null);
  }
}

export async function upsertAdFromScrape(params: {
  scraped: ScrapedAd;
  landing: LandingCapture | null;
  domainCounts: DomainCounts;
  runTranscribe: boolean;
}) {
  const { scraped, landing, domainCounts, runTranscribe } = params;
  const supabase = adminClient();

  const domain =
    landing?.domain ??
    (scraped.landingUrl ? safeHost(scraped.landingUrl) : null) ??
    (scraped.videoUrl ? safeHost(scraped.videoUrl) : null);

  const freqBase = domain ? domainCounts.get(domain) ?? 1 : 1;
  const start = scraped.startDate ? new Date(scraped.startDate) : new Date();
  const daysActive = daysBetween(start);

  let vslHtmlPath: string | null = null;
  let publicVideoUrl: string | null = scraped.videoUrl;
  let publicThumbUrl: string | null = scraped.thumbnailUrl;
  const vslVideoForTranscribe = landing?.vslVideoUrl ?? null;

  if (scraped.videoUrl) {
    const buf = await downloadBuf(scraped.videoUrl);
    if (buf && buf.byteLength > 10_000 && buf.byteLength < 120 * 1024 * 1024) {
      const path = `${scraped.adLibraryId}/creative.mp4`;
      try {
        publicVideoUrl = await uploadPublicFile(path, buf, "video/mp4");
      } catch {
        /* mantém URL original */
      }
    }
  }

  if (scraped.thumbnailUrl) {
    const buf = await downloadBuf(scraped.thumbnailUrl);
    if (buf && buf.byteLength > 200 && buf.byteLength < 15 * 1024 * 1024) {
      const path = `${scraped.adLibraryId}/thumb.jpg`;
      try {
        publicThumbUrl = await uploadPublicFile(path, buf, "image/jpeg");
      } catch {
        /* ignore */
      }
    }
  }

  if (landing?.html && landing.ok) {
    const path = `${scraped.adLibraryId}/landing.html`;
    try {
      await uploadPublicFile(path, Buffer.from(landing.html, "utf-8"), "text/html; charset=utf-8");
      vslHtmlPath = path;
    } catch {
      vslHtmlPath = null;
    }
  }

  const niche = await classifyNiche({
    adCopy: scraped.adCopy,
    landingText: landing?.plainText ?? "",
  });

  const vslUrl = landing?.url ?? scraped.landingUrl;
  const landingOk = landing ? landing.ok : Boolean(scraped.landingUrl);

  const { data: existing, error: selErr } = await supabase
    .from("ads")
    .select("id,appearance_count")
    .eq("ad_library_id", scraped.adLibraryId)
    .maybeSingle();

  if (selErr) throw selErr;

  const nextAppear = (existing?.appearance_count ?? 0) + 1;
  const freqForScore = existing?.id ? Math.max(freqBase, nextAppear) : Math.max(1, freqBase);
  const score = computeScore(daysActive, freqForScore);
  const status = classifyStatus(score);

  const row = {
    ad_library_id: scraped.adLibraryId,
    facebook_ad_id: scraped.adLibraryId,
    title: scraped.title || scraped.pageName || "Anúncio",
    page_name: scraped.pageName,
    niche,
    video_url: publicVideoUrl,
    vsl_url: vslUrl,
    thumbnail: publicThumbUrl,
    ad_copy: scraped.adCopy,
    start_date: scraped.startDate,
    score,
    status,
    last_seen_at: new Date().toISOString(),
    landing_domain: domain,
    domain_frequency: freqBase,
    landing_ok: landingOk,
    vsl_html_path: vslHtmlPath,
    video_storage_path: publicVideoUrl?.includes("/creatives/") ? `${scraped.adLibraryId}/creative.mp4` : null,
    thumbnail_storage_path: publicThumbUrl?.includes("/creatives/") ? `${scraped.adLibraryId}/thumb.jpg` : null,
    views_day: Math.max(50, Math.round(score * 40)),
    views_week: Math.max(300, Math.round(score * 220)),
    active_days: daysActive,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await supabase
      .from("ads")
      .update({
        ...row,
        appearance_count: nextAppear,
      })
      .eq("id", existing.id);
    if (error) throw error;

    if (runTranscribe && env.openaiKey) {
      await maybeTranscribe(existing.id, publicVideoUrl, vslVideoForTranscribe);
    }
    return existing.id;
  }

  const insertRow = {
    ...row,
    appearance_count: 1,
    created_at: new Date().toISOString(),
  };

  const { data: inserted, error } = await supabase.from("ads").insert(insertRow).select("id").single();
  if (error) throw error;

  if (runTranscribe && env.openaiKey && inserted?.id) {
    await maybeTranscribe(inserted.id, publicVideoUrl, vslVideoForTranscribe);
  }

  await humanDelay(200, 600);
  return inserted?.id ?? null;
}
