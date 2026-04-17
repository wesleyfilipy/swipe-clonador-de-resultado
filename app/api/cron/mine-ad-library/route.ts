import { NextRequest, NextResponse } from "next/server";
import { runAdLibraryIngest } from "@/lib/ad-library-sync";

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
    return NextResponse.json(
      { error: "Não autorizado. Defina CRON_SECRET e use Authorization: Bearer ou ?secret=" },
      { status: 401 }
    );
  }

  try {
    const result = await runAdLibraryIngest({ mode: "cron_replace" });

    if (result.skipped === "no_token") {
      return NextResponse.json(
        {
          error: "missing_token",
          message:
            result.message ??
            "Defina META_AD_LIBRARY_ACCESS_TOKEN (recomendado) ou META_SYSTEM_USER_TOKEN com permissão para a Ad Library API.",
        },
        { status: 500 }
      );
    }

    if (!result.ok) {
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
