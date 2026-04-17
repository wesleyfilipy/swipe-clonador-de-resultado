import { mineAdLibraryDaily, AD_LIBRARY_KEYWORDS, type MinedAdLibraryRow } from "@/lib/ad-library-miner";
import { createAdminClient } from "@/lib/supabase/admin";

const LOCK_KEY = "ad_library";

export function getMetaAdLibraryToken(): string {
  return (
    process.env.META_AD_LIBRARY_ACCESS_TOKEN ??
    process.env.META_SYSTEM_USER_TOKEN ??
    process.env.META_USER_ACCESS_TOKEN ??
    ""
  );
}

export type AdLibraryIngestMode = "fill_if_empty" | "cron_replace";

export type AdLibrarySyncResult = {
  ok: boolean;
  inserted: number;
  skipped?: "no_token" | "disabled" | "has_ads" | "cooldown" | "lock_error";
  errors: string[];
  message?: string;
  /** Índice do primeiro chunk que falhou no insert (só cron / depuração). */
  partialChunkIndex?: number;
};

function isMissingRelation(err: { message?: string } | null): boolean {
  const m = (err?.message ?? "").toLowerCase();
  return m.includes("ingest_lock") && (m.includes("does not exist") || m.includes("schema cache"));
}

async function replaceAdLibraryDailyBatch(
  admin: ReturnType<typeof createAdminClient>,
  rows: MinedAdLibraryRow[],
  errors: string[]
): Promise<AdLibrarySyncResult> {
  if (rows.length === 0) {
    return {
      ok: false,
      inserted: 0,
      errors,
      message:
        "A Meta não retornou anúncios (token/permissões Ad Library). Confira o app na Meta e META_AD_LIBRARY_ACCESS_TOKEN na Vercel.",
    };
  }

  const { error: delErr } = await admin.from("ads").delete().eq("mine_source", "ad_library_daily");
  if (delErr) {
    return {
      ok: false,
      inserted: 0,
      errors: [...errors, delErr.message],
      message: delErr.message.includes("column")
        ? "Rode migration_mine_source.sql (coluna mine_source)."
        : delErr.message,
    };
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
      return {
        ok: false,
        inserted: 0,
        errors: [...errors, insErr.message],
        message: insErr.message,
        partialChunkIndex: i,
      };
    }
  }

  return { ok: true, inserted: rows.length, errors };
}

/**
 * Sincroniza anúncios da Meta Ad Library para o Supabase.
 * - `fill_if_empty`: só roda com DB vazio; respeita `AUTO_AD_LIBRARY_SYNC` e tabela `ingest_lock` (migration_ingest_lock.sql).
 * - `cron_replace`: substitui o lote `ad_library_daily` sempre (uso do cron Vercel).
 */
export async function runAdLibraryIngest(options: { mode: AdLibraryIngestMode }): Promise<AdLibrarySyncResult> {
  const { mode } = options;
  const errors: string[] = [];

  if (mode === "fill_if_empty" && process.env.AUTO_AD_LIBRARY_SYNC === "0") {
    return { ok: false, inserted: 0, skipped: "disabled", errors };
  }

  const token = getMetaAdLibraryToken();
  if (!token) {
    return {
      ok: false,
      inserted: 0,
      skipped: "no_token",
      errors,
      message:
        "Defina META_AD_LIBRARY_ACCESS_TOKEN (ou token Meta equivalente) na Vercel.",
    };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    return {
      ok: false,
      inserted: 0,
      errors: [e instanceof Error ? e.message : String(e)],
      message: "Supabase service role ausente.",
    };
  }

  let lockEnabled = false;
  const cooldownOkMin = Math.min(120, Math.max(10, Number(process.env.AUTO_AD_LIBRARY_COOLDOWN_MIN ?? "45")));
  const cooldownFailMin = Math.min(60, Math.max(5, Number(process.env.AUTO_AD_LIBRARY_FAIL_COOLDOWN_MIN ?? "12")));
  const reserveCooldown = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

  const relaxLockAfterFail = async () => {
    if (!lockEnabled) return;
    await admin.from("ingest_lock").upsert(
      { key: LOCK_KEY, cooldown_until: reserveCooldown(cooldownFailMin) },
      { onConflict: "key" }
    );
  };

  if (mode === "fill_if_empty") {
    const { count: totalAds, error: countErr } = await admin.from("ads").select("id", { count: "exact", head: true });
    if (countErr) {
      return { ok: false, inserted: 0, errors: [countErr.message], message: countErr.message };
    }
    if ((totalAds ?? 0) > 0) {
      return { ok: true, inserted: 0, skipped: "has_ads", errors };
    }

    const { data: lockRow, error: lockReadErr } = await admin.from("ingest_lock").select("cooldown_until").eq("key", LOCK_KEY).maybeSingle();

    if (lockReadErr) {
      if (isMissingRelation(lockReadErr)) {
        lockEnabled = false;
      } else {
        return { ok: false, inserted: 0, skipped: "lock_error", errors: [lockReadErr.message], message: lockReadErr.message };
      }
    } else {
      lockEnabled = true;
    }

    if (lockEnabled && lockRow?.cooldown_until) {
      const until = new Date(lockRow.cooldown_until).getTime();
      if (until > Date.now()) {
        return { ok: false, inserted: 0, skipped: "cooldown", errors };
      }
    }

    if (lockEnabled) {
      const { error: lockWriteErr } = await admin.from("ingest_lock").upsert(
        { key: LOCK_KEY, cooldown_until: reserveCooldown(cooldownOkMin) },
        { onConflict: "key" }
      );
      if (lockWriteErr) {
        return { ok: false, inserted: 0, skipped: "lock_error", errors: [lockWriteErr.message], message: lockWriteErr.message };
      }
    }
  }

  const maxAds = Math.min(150, Math.max(20, Number(process.env.META_AD_LIBRARY_MAX_ADS ?? "100")));
  const maxPages = Math.min(8, Math.max(1, Number(process.env.META_AD_LIBRARY_PAGES_PER_KEYWORD ?? "4")));
  const keywordCount = Math.min(AD_LIBRARY_KEYWORDS.length, Number(process.env.META_AD_LIBRARY_KEYWORD_COUNT ?? "8"));

  const { rows, errors: mineErrors } = await mineAdLibraryDaily({
    accessToken: token,
    maxAds,
    maxPagesPerKeyword: maxPages,
    keywords: AD_LIBRARY_KEYWORDS.slice(0, keywordCount),
  });
  errors.push(...mineErrors);

  if (rows.length === 0) {
    await relaxLockAfterFail();
    return {
      ok: false,
      inserted: 0,
      errors,
      message:
        mode === "cron_replace"
          ? "Nenhum anúncio retornado. Confira o token, permissões do app Meta e limites da Ad Library API (erros acima)."
          : "A Meta não retornou anúncios (token/permissões Ad Library). Confira o app na Meta e META_AD_LIBRARY_ACCESS_TOKEN na Vercel.",
    };
  }

  const batch = await replaceAdLibraryDailyBatch(admin, rows, errors);
  if (!batch.ok) {
    await relaxLockAfterFail();
  }
  return batch;
}

/** Atalho para disparo em background (só preenche se o feed estiver vazio). */
export async function runAdLibrarySync(): Promise<AdLibrarySyncResult> {
  return runAdLibraryIngest({ mode: "fill_if_empty" });
}
