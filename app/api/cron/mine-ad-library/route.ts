import { NextRequest, NextResponse } from "next/server";
import { mineAdLibraryDaily, AD_LIBRARY_KEYWORDS } from "@/lib/ad-library-miner";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Ajuste no plano Vercel se o job estourar tempo (mineração + várias keywords). */
export const maxDuration = 120;

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Não autorizado. Defina CRON_SECRET e use Authorization: Bearer ou ?secret=" }, { status: 401 });
  }

  const token =
    process.env.META_AD_LIBRARY_ACCESS_TOKEN ??
    process.env.META_SYSTEM_USER_TOKEN ??
    process.env.META_USER_ACCESS_TOKEN ??
    "";

  if (!token) {
    return NextResponse.json(
      {
        error: "missing_token",
        message:
          "Defina META_AD_LIBRARY_ACCESS_TOKEN (recomendado) ou META_SYSTEM_USER_TOKEN com permissão para a Ad Library API.",
      },
      { status: 500 }
    );
  }

  const maxAds = Math.min(150, Math.max(20, Number(process.env.META_AD_LIBRARY_MAX_ADS ?? "100")));
  const maxPages = Math.min(8, Math.max(1, Number(process.env.META_AD_LIBRARY_PAGES_PER_KEYWORD ?? "4")));
  const keywordCount = Math.min(AD_LIBRARY_KEYWORDS.length, Number(process.env.META_AD_LIBRARY_KEYWORD_COUNT ?? "8"));

  try {
    const { rows, errors } = await mineAdLibraryDaily({
      accessToken: token,
      maxAds,
      maxPagesPerKeyword: maxPages,
      keywords: AD_LIBRARY_KEYWORDS.slice(0, keywordCount),
    });

    if (rows.length === 0) {
      return NextResponse.json({
        ok: false,
        inserted: 0,
        errors,
        message:
          "Nenhum anúncio retornado. Confira o token, permissões do app Meta e limites da Ad Library API (erros acima).",
      });
    }

    const admin = createAdminClient();
    const { error: delErr } = await admin.from("ads").delete().eq("mine_source", "ad_library_daily");
    if (delErr) {
      return NextResponse.json(
        {
          error: delErr.message,
          hint: "Rode no Supabase o SQL: supabase/migration_mine_source.sql (coluna mine_source).",
        },
        { status: 500 }
      );
    }

    const now = new Date().toISOString();
    const payload = rows.map((r) => ({
      ...r,
      created_at: now,
      updated_at: now,
    }));

    const chunk = 30;
    for (let i = 0; i < payload.length; i += chunk) {
      const slice = payload.slice(i, i + chunk);
      const { error: insErr } = await admin.from("ads").insert(slice);
      if (insErr) {
        return NextResponse.json({ error: insErr.message, partial: i }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      inserted: rows.length,
      warnings: errors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
