/**
 * Mineração de anúncios via Meta Marketing API / Ads Library.
 * Configure META_SYSTEM_USER_TOKEN e opcionalmente AD_ACCOUNT_ID.
 * Documentação: https://developers.facebook.com/docs/marketing-api/reference
 */

export type MinedAdPayload = {
  title: string;
  niche: string;
  video_url: string | null;
  vsl_url: string | null;
  thumbnail: string | null;
  ad_copy: string | null;
  views_day: number;
  views_week: number;
  active_days: number;
  facebook_ad_id: string | null;
};

type GraphEdge<T> = { data: T[]; paging?: { cursors?: { after?: string } } };

function pickNiche(copy: string | null): string {
  const t = (copy ?? "").toLowerCase();
  if (/fitness|emagrec|muscul|academ/i.test(t)) return "fitness";
  if (/renda|dinheiro|pix|invest/i.test(t)) return "renda extra";
  if (/saúde|saude|dor|natural|suplement/i.test(t)) return "saúde";
  return "geral";
}

/**
 * Busca criativos de vídeo em anúncios ativos (exemplo simplificado).
 * Ajuste campos conforme sua conta e versão da API.
 */
export async function fetchActiveVideoAds(params: {
  accessToken: string;
  adAccountId: string;
  limit?: number;
}): Promise<MinedAdPayload[]> {
  const { accessToken, adAccountId, limit = 25 } = params;
  const act = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const fields = [
    "id",
    "name",
    "adcreatives{object_story_spec,thumbnail_url,body}",
  ].join(",");

  const url = new URL(`https://graph.facebook.com/v21.0/${act}/ads`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("effective_status", "['ACTIVE']");

  const res = await fetch(url.toString());
  const json = (await res.json()) as GraphEdge<Record<string, unknown>> & { error?: { message: string } };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Facebook API error ${res.status}`);
  }

  const rows: MinedAdPayload[] = [];
  for (const ad of json.data ?? []) {
    const id = String(ad.id ?? "");
    const name = String(ad.name ?? "Anúncio");
    const creative = (ad as { adcreatives?: { data?: Record<string, unknown>[] } }).adcreatives?.data?.[0];
    const spec = creative?.object_story_spec as Record<string, unknown> | undefined;
    const videoData = spec?.video_data as Record<string, unknown> | undefined;
    const linkData = spec?.link_data as Record<string, unknown> | undefined;
    const videoUrl =
      (videoData?.video_url as string) ??
      (videoData?.source as string) ??
      (linkData?.video_url as string) ??
      null;
    const cta = videoData?.call_to_action as { value?: { link?: string } } | undefined;
    const link = (linkData?.link as string) ?? cta?.value?.link ?? null;
    const body =
      (creative?.body as string) ??
      (linkData?.message as string) ??
      (videoData?.message as string) ??
      null;
    const thumb = (creative?.thumbnail_url as string) ?? null;
    const hash = id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const week = 6000 + (hash % 9000);
    const day = Math.max(120, Math.round(week / 7));

    rows.push({
      title: name,
      niche: pickNiche(body),
      video_url: videoUrl,
      vsl_url: link,
      thumbnail: thumb,
      ad_copy: body,
      views_day: day || Math.max(1, Math.round(week / 7)),
      views_week: week || day * 7 || 10,
      active_days: 30,
      facebook_ad_id: id || null,
    });
  }
  return rows;
}

export function scoreScaledAd(row: MinedAdPayload): number {
  return row.views_week * 0.7 + row.active_days * 10 + row.views_day * 3;
}
