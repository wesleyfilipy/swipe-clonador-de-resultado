import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchActiveVideoAds, scoreScaledAd } from "@/lib/facebook-miner";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const cron = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!cron || auth !== cron) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const token = process.env.META_SYSTEM_USER_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID;
  if (!token || !account) {
    return NextResponse.json({ error: "META_SYSTEM_USER_TOKEN ou META_AD_ACCOUNT_ID ausente" }, { status: 500 });
  }

  let body: { limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* optional body */
  }

  const mined = await fetchActiveVideoAds({
    accessToken: token,
    adAccountId: account,
    limit: body.limit ?? 40,
  });

  mined.sort((a, b) => scoreScaledAd(b) - scoreScaledAd(a));

  const admin = createAdminClient();
  const rows = mined.map((m) => ({
    title: m.title,
    niche: m.niche,
    video_url: m.video_url,
    vsl_url: m.vsl_url,
    thumbnail: m.thumbnail,
    ad_copy: m.ad_copy,
    views_day: m.views_day,
    views_week: m.views_week,
    active_days: m.active_days,
    facebook_ad_id: m.facebook_ad_id,
  }));

  const { data, error } = await admin.from("ads").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ inserted: data?.length ?? 0 });
}
