import { NextRequest, NextResponse } from "next/server";
import { authorizeCronSecret, cronUnauthorizedResponse } from "@/lib/cron-secret-auth";
import { runAdLibraryIngest } from "@/lib/ad-library-sync";
import { runWeeklySpyIngest } from "@/lib/spy/weekly-ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Hobby: max 300s. Pro pode usar até 800s+ nos routes se precisar de mineração/spy muito longa. */
export const maxDuration = 300;

/**
 * Único job agendável no Vercel Hobby (1 cron por projeto).
 * Chama: (1) catálogo Meta/Apify legado `cron_replace`, (2) ingestão spy semanal (intervalo interno ~7d).
 * Desligue partes: CRON_DISABLE_MINE=1 ou CRON_DISABLE_SPY=1
 */
export async function GET(req: NextRequest) {
  if (!authorizeCronSecret(req)) {
    return cronUnauthorizedResponse();
  }

  const forceSpy = req.nextUrl.searchParams.get("forceSpy") === "1";

  const out: {
    mine?: Awaited<ReturnType<typeof runAdLibraryIngest>>;
    spy?: Awaited<ReturnType<typeof runWeeklySpyIngest>>;
    errors: string[];
  } = { errors: [] };

  if (process.env.CRON_DISABLE_MINE !== "1") {
    try {
      out.mine = await runAdLibraryIngest({ mode: "cron_replace" });
    } catch (e) {
      out.errors.push(`mine: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (process.env.CRON_DISABLE_SPY !== "1") {
    try {
      out.spy = await runWeeklySpyIngest({ force: forceSpy });
    } catch (e) {
      out.errors.push(`spy: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const mineFailed = out.mine != null && out.mine.ok === false && out.mine.inserted === 0;
  const spyFailed = out.spy != null && out.spy.ok === false && out.spy.skipped === "error";
  const ok = out.errors.length === 0 && !mineFailed && !spyFailed;

  return NextResponse.json(
    { ok, ...out },
    { status: ok ? 200 : 207 }
  );
}
