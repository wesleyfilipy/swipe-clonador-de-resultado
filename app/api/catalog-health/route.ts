import { NextRequest, NextResponse } from "next/server";
import { authorizeCronSecret, cronUnauthorizedResponse } from "@/lib/cron-secret-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getApifyAdLibraryToken, getMetaAdLibraryToken } from "@/lib/ad-library-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Diagnóstico de deploy (não exponha em público). Mesma autenticação do cron: CRON_SECRET.
 * GET /api/catalog-health?secret=...  ou  Authorization: Bearer ...
 * ?probe=1 — uma mineração mínima (poucos anúncios) para ver se a Graph API responde.
 */
export async function GET(req: NextRequest) {
  if (!authorizeCronSecret(req)) {
    return cronUnauthorizedResponse();
  }

  const token = getMetaAdLibraryToken();
  const apifyToken = getApifyAdLibraryToken();
  const configured = {
    metaAdLibraryToken: Boolean(token),
    apifyAdLibraryToken: Boolean(apifyToken),
    supabaseServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL),
    nextPublicSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    autoAdLibrarySync: process.env.AUTO_AD_LIBRARY_SYNC !== "0",
    metaAppSecret: Boolean(process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET),
    cronSecret: Boolean(process.env.CRON_SECRET),
  };

  let adsRowCount: number | null = null;
  let adsCountError: string | null = null;
  try {
    const admin = createAdminClient();
    const { count, error } = await admin.from("ads").select("id", { count: "exact", head: true });
    if (error) adsCountError = error.message;
    else adsRowCount = count ?? 0;
  } catch (e) {
    adsCountError = e instanceof Error ? e.message : String(e);
  }

  let graphProbe: { ok: boolean; rowSample: number; errors: string[] } | undefined;
  if (req.nextUrl.searchParams.get("probe") === "1") {
    if (!token && !apifyToken) {
      graphProbe = {
        ok: false,
        rowSample: 0,
        errors: ["Sem APIFY_TOKEN (Apify) nem META_AD_LIBRARY_ACCESS_TOKEN / META_SYSTEM_USER_TOKEN (Graph)."],
      };
    } else {
      const { mineAdLibraryDaily } = await import("@/lib/ad-library-miner");
      const r = await mineAdLibraryDaily({
        accessToken: token,
        maxAds: 8,
        maxPagesPerKeyword: 1,
        keywords: ["fitness"],
      });
      graphProbe = { ok: r.rows.length > 0, rowSample: r.rows.length, errors: r.errors };
    }
  }

  const blockingReasons: string[] = [];
  if (!configured.metaAdLibraryToken && !configured.apifyAdLibraryToken) {
    blockingReasons.push(
      "Defina APIFY_TOKEN (mineração via Apify) ou META_AD_LIBRARY_ACCESS_TOKEN (Graph) — CRON_SECRET sozinho não busca anúncios."
    );
  }
  if (!configured.supabaseServiceRole) {
    blockingReasons.push("Defina SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL — sem isso o servidor não grava em public.ads.");
  }
  if (!configured.cronSecret) {
    blockingReasons.push("Defina CRON_SECRET para chamar /api/cron/mine-ad-library manualmente ou para o Cron da Vercel enviar Authorization: Bearer.");
  }

  return NextResponse.json({
    configured,
    adsRowCount,
    adsCountError,
    graphProbe,
    blockingReasons,
    hints: [
      "CRON_SECRET só autentica rotas; não substitui token da Meta nem grava no Supabase.",
      "Com CRON_SECRET na Vercel, o agendamento em vercel.json chama /api/cron/mine-ad-library 1x/dia enviando Authorization: Bearer automaticamente (plano Hobby: até 1 cron/dia).",
      "Para testar na hora: GET /api/cron/mine-ad-library com header Authorization: Bearer <CRON_SECRET> (não use texto de exemplo no valor da variável).",
      "Com APIFY_TOKEN a mineração usa o Apify; sem isso, a Graph API (Meta). A pasta /bot (Playwright) não roda no deploy — só npm run bot:scrape local/CI.",
      "Se adsRowCount=0 e probe=1, leia graphProbe.errors (token, appsecret_proof, permissões Ad Library).",
    ],
  });
}
