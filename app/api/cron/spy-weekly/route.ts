import { NextRequest, NextResponse } from "next/server";
import { authorizeCronSecret, cronUnauthorizedResponse } from "@/lib/cron-secret-auth";
import { runWeeklySpyIngest } from "@/lib/spy/weekly-ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Ingestão semanal (única rotina que chama o Apify para o catálogo spy).
 * Configurar na Vercel: CRON_SECRET + APIFY_TOKEN + aplicação da migration_spy_weekly_ads.sql.
 * Não chame isto a partir de requests de usuário.
 */
export async function GET(req: NextRequest) {
  if (!authorizeCronSecret(req)) {
    return cronUnauthorizedResponse();
  }

  const force = req.nextUrl.searchParams.get("force") === "1";

  try {
    const result = await runWeeklySpyIngest({ force });

    if (result.skipped === "no_token") {
      return NextResponse.json(
        { ok: false, error: "missing_token", message: result.message },
        { status: 500 }
      );
    }
    if (result.skipped === "disabled") {
      return NextResponse.json({ ok: false, skipped: result.skipped, message: result.message }, { status: 503 });
    }
    if (result.skipped === "interval") {
      return NextResponse.json({ ok: true, skipped: "interval", message: result.message, errors: result.errors });
    }
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.message,
          countries: result.countries,
          errors: result.errors,
          batchId: result.batchId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      inserted: result.inserted,
      countries: result.countries,
      batchId: result.batchId,
      warnings: result.errors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
