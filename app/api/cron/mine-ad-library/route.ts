import { NextRequest, NextResponse } from "next/server";
import { runAdLibraryIngest } from "@/lib/ad-library-sync";
import { authorizeCronSecret, cronUnauthorizedResponse } from "@/lib/cron-secret-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Ajuste no plano Vercel se o job estourar tempo (mineração + várias keywords). */
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (!authorizeCronSecret(req)) {
    return cronUnauthorizedResponse();
  }

  try {
    const result = await runAdLibraryIngest({ mode: "cron_replace" });

    if (result.skipped === "no_token") {
      return NextResponse.json(
        {
          error: "missing_token",
          message:
            result.message ??
            "Defina APIFY_TOKEN (Apify) ou META_AD_LIBRARY_ACCESS_TOKEN (Graph API).",
        },
        { status: 500 }
      );
    }

    if (!result.ok) {
      console.error("[cron mine-ad-library]", {
        ok: result.ok,
        inserted: result.inserted,
        skipped: result.skipped,
        message: result.message,
        errors: result.errors.slice(0, 8),
      });
      if (result.partialChunkIndex !== undefined) {
        return NextResponse.json(
          { error: result.message ?? "insert failed", partial: result.partialChunkIndex },
          { status: 500 }
        );
      }
      return NextResponse.json({
        ok: false,
        inserted: 0,
        errors: result.errors,
        message: result.message,
      });
    }

    return NextResponse.json({
      ok: true,
      inserted: result.inserted,
      warnings: result.errors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
