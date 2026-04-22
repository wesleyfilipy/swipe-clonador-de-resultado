import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { countFeedVisibleAds } from "@/lib/feed-ads-query";
import {
  acquireCatalogMiningLease,
  catalogUserMineLockParams,
  setCatalogMineLockCooldown,
} from "@/lib/catalog-user-mine-lock";
import { runAdLibraryIngest } from "@/lib/ad-library-sync";
import { isUserAdIngestBlocked } from "@/lib/spy/user-ingest-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Usuário logado: tenta mineração Ad Library quando o feed ainda não tem linhas visíveis.
 * Lock só para este POST (não compete com o waitUntil do /feed). Desligue com USER_CATALOG_FILL=0.
 */
export async function POST() {
  if (process.env.USER_CATALOG_FILL === "0") {
    return NextResponse.json({ ok: false, skipped: "disabled", message: "USER_CATALOG_FILL=0" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  if (isUserAdIngestBlocked()) {
    return NextResponse.json(
      { ok: false, skipped: "spy_catalog_only", message: "Preenchimento on-demand desligado (use o job /api/cron/spy-weekly)." },
      { status: 403 }
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  const { count, error: cErr } = await countFeedVisibleAds(admin);
  if (cErr) {
    return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json({ ok: true, skipped: "has_ads", count });
  }

  if (process.env.AUTO_AD_LIBRARY_SYNC === "0") {
    return NextResponse.json(
      {
        ok: false,
        skipped: "disabled",
        message: "AUTO_AD_LIBRARY_SYNC=0 — mineração desligada no servidor.",
      },
      { status: 503 }
    );
  }

  const { leaseSec, okCooldownSec, failCooldownSec } = catalogUserMineLockParams();

  let acquired = false;
  try {
    const acq = await acquireCatalogMiningLease(admin, leaseSec);
    if (!acq.acquired) {
      return NextResponse.json(
        { ok: false, skipped: "cooldown", retryAfterSec: acq.retryAfterSec },
        { status: 429 }
      );
    }
    acquired = true;

    const result = await runAdLibraryIngest({ mode: "catalog_post_fill" });

    if (result.skipped === "no_token") {
      await setCatalogMineLockCooldown(admin, failCooldownSec);
      return NextResponse.json(
        {
          ok: false,
          skipped: "no_token",
          message: result.message ?? "Defina META_AD_LIBRARY_ACCESS_TOKEN na hospedagem.",
          retryAfterSec: failCooldownSec,
        },
        { status: 503 }
      );
    }

    if (!result.ok) {
      await setCatalogMineLockCooldown(admin, failCooldownSec);
      return NextResponse.json(
        {
          ok: false,
          inserted: result.inserted,
          errors: result.errors,
          message: result.message,
          retryAfterSec: failCooldownSec,
        },
        { status: 502 }
      );
    }

    await setCatalogMineLockCooldown(admin, okCooldownSec);

    return NextResponse.json({
      ok: true,
      inserted: result.inserted,
      skipped: result.skipped,
      warnings: result.errors,
      nextKickAfterSec: okCooldownSec,
    });
  } catch (e) {
    if (acquired) {
      await setCatalogMineLockCooldown(admin, failCooldownSec);
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, retryAfterSec: failCooldownSec }, { status: 500 });
  }
}
