import { getApifyAdLibraryTokenFromEnv, isApifyOnlyMode, isCatalogVideoOnlyDefault } from "@/lib/ad-library-apify";
import { mineAdLibraryDaily, AD_LIBRARY_KEYWORDS, type MinedAdLibraryRow } from "@/lib/ad-library-miner";
import { countFeedVisibleAds } from "@/lib/feed-ads-query";
import { createAdminClient } from "@/lib/supabase/admin";

const LOCK_KEY = "ad_library";

export function getMetaAdLibraryToken(): string {
  const raw =
    process.env.META_AD_LIBRARY_ACCESS_TOKEN ??
    process.env.META_SYSTEM_USER_TOKEN ??
    process.env.META_USER_ACCESS_TOKEN ??
    "";
  return raw.replace(/^\uFEFF/, "").trim();
}

export function getApifyAdLibraryToken(): string {
  return getApifyAdLibraryTokenFromEnv();
}

export type AdLibraryIngestMode =
  | "fill_if_empty"
  | "cron_replace"
  | "feed_blocking_fill"
  /** Mesmo fluxo que feed_blocking, porém menos páginas/keywords (POST /api/catalog-fill — evita estourar tempo na Vercel Hobby). */
  | "catalog_post_fill";

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

export function dedupeMinedRowsByAdId(rows: MinedAdLibraryRow[]): MinedAdLibraryRow[] {
  const m = new Map<string, MinedAdLibraryRow>();
  for (const r of rows) {
    const prev = m.get(r.facebook_ad_id);
    if (!prev) {
      m.set(r.facebook_ad_id, { ...r });
      continue;
    }
    m.set(r.facebook_ad_id, {
      ...prev,
      appearance_count: Math.max(prev.appearance_count ?? 1, r.appearance_count ?? 1),
      views_week: Math.max(prev.views_week ?? 0, r.views_week ?? 0),
      views_day: Math.max(prev.views_day ?? 0, r.views_day ?? 0),
      active_days: Math.max(prev.active_days ?? 0, r.active_days ?? 0),
      country: (r.country && String(r.country)) || prev.country || null,
    });
  }
  return Array.from(m.values());
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

  const uniqueRows = dedupeMinedRowsByAdId(rows);

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
  const payload = uniqueRows.map((r) => ({
    ...r,
    ad_library_id: r.facebook_ad_id,
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

  return { ok: true, inserted: uniqueRows.length, errors };
}

const AD_LIBRARY_CATALOG_CAP = () =>
  Math.min(2000, Math.max(50, Number(process.env.AD_LIBRARY_CATALOG_CAP ?? "500")));

/** Remove excedente de `ad_library_daily` com pior sinal (menos presença / views). */
export async function pruneAdLibraryDailyExcess(admin: ReturnType<typeof createAdminClient>): Promise<void> {
  const cap = AD_LIBRARY_CATALOG_CAP();
  const { count, error: cErr } = await admin
    .from("ads")
    .select("id", { count: "exact", head: true })
    .eq("mine_source", "ad_library_daily");
  if (cErr || count == null || count <= cap) return;
  const excess = count - cap;
  const { data: victims, error: vErr } = await admin
    .from("ads")
    .select("id")
    .eq("mine_source", "ad_library_daily")
    .order("appearance_count", { ascending: true })
    .order("views_week", { ascending: true })
    .limit(excess);
  if (vErr || !victims?.length) return;
  const ids = victims.map((v) => v.id);
  await admin.from("ads").delete().in("id", ids);
}

/**
 * Acrescenta/atualiza lote da Ad Library sem apagar o catálogo inteiro (cron).
 * Depois poda para AD_LIBRARY_CATALOG_CAP.
 */
async function mergeAdLibraryDailyRows(
  admin: ReturnType<typeof createAdminClient>,
  rows: MinedAdLibraryRow[],
  errors: string[]
): Promise<AdLibrarySyncResult> {
  if (rows.length === 0) {
    return {
      ok: false,
      inserted: 0,
      errors,
      message: "Nenhuma linha para fundir.",
    };
  }

  const deduped = dedupeMinedRowsByAdId(rows);

  const now = new Date().toISOString();
  const libIds = Array.from(new Set(deduped.map((r) => r.facebook_ad_id)));

  const { data: existingRows, error: selErr } = await admin
    .from("ads")
    .select("id, ad_library_id, appearance_count, views_week, views_day, active_days")
    .eq("mine_source", "ad_library_daily")
    .in("ad_library_id", libIds);

  if (selErr) {
    return { ok: false, inserted: 0, errors: [...errors, selErr.message], message: selErr.message };
  }

  const existing = new Map(
    (existingRows ?? [])
      .filter((e) => e.ad_library_id != null && String(e.ad_library_id).length > 0)
      .map((e) => [String(e.ad_library_id), e])
  );
  const inserts: Record<string, unknown>[] = [];
  const updates: {
    id: string;
    patch: { appearance_count: number; views_week: number; views_day: number; active_days: number; updated_at: string };
  }[] = [];

  for (const r of deduped) {
    const aid = r.facebook_ad_id;
    const ex = existing.get(aid);
    const ac = Math.max(1, r.appearance_count ?? 1);
    if (!ex) {
      inserts.push({
        ...r,
        ad_library_id: aid,
        created_at: now,
        updated_at: now,
      });
    } else {
      updates.push({
        id: ex.id,
        patch: {
          appearance_count: Math.max(ex.appearance_count ?? 1, ac),
          views_week: Math.max(ex.views_week ?? 0, r.views_week ?? 0),
          views_day: Math.max(ex.views_day ?? 0, r.views_day ?? 0),
          active_days: Math.max(ex.active_days ?? 0, r.active_days ?? 0),
          updated_at: now,
        },
      });
    }
  }

  const chunk = 25;
  for (let i = 0; i < inserts.length; i += chunk) {
    const slice = inserts.slice(i, i + chunk);
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

  for (const u of updates) {
    const { error: upErr } = await admin.from("ads").update(u.patch).eq("id", u.id);
    if (upErr) {
      return { ok: false, inserted: 0, errors: [...errors, upErr.message], message: upErr.message };
    }
  }

  await pruneAdLibraryDailyExcess(admin);
  return { ok: true, inserted: inserts.length + updates.length, errors };
}

/**
 * Sincroniza anúncios da Meta Ad Library para o Supabase.
 * - `fill_if_empty`: só roda com DB vazio; respeita `AUTO_AD_LIBRARY_SYNC` e tabela `ingest_lock` (migration_ingest_lock.sql).
 * - `feed_blocking_fill`: DB vazio; ignora cooldown do `ingest_lock` (uso na SSR do /feed para não ficar preso em lock).
 * - `cron_replace`: funde com o catálogo `ad_library_daily` (upsert por id) e poda acima de `AD_LIBRARY_CATALOG_CAP` (padrão 500), removendo os de menor `appearance_count` / `views_week`.
 * - `catalog_post_fill`: catálogo vazio, mineração curta (env CATALOG_FILL_*) para o botão /api/catalog-fill.
 */
export async function runAdLibraryIngest(options: {
  mode: AdLibraryIngestMode;
  /** País da Ad Library (ex.: BR, US). Define `countries` + `apifyCountry` na mineração. */
  country?: string;
  /** URL Apify: `media_type=video` (padrão) ou `all`. */
  adLibraryUrlMedia?: "video" | "all";
}): Promise<AdLibrarySyncResult> {
  const { mode, country: ingestCountry, adLibraryUrlMedia } = options;
  const errors: string[] = [];
  const ic = ingestCountry?.trim().toUpperCase() ?? "";
  const countScope = ic.length >= 2 && ic.length <= 3 ? { country: ic } : undefined;

  if (
    (mode === "fill_if_empty" || mode === "feed_blocking_fill" || mode === "catalog_post_fill") &&
    process.env.AUTO_AD_LIBRARY_SYNC === "0"
  ) {
    return { ok: false, inserted: 0, skipped: "disabled", errors };
  }

  const token = getMetaAdLibraryToken();
  const apifyT = getApifyAdLibraryToken();
  if (isApifyOnlyMode()) {
    if (!apifyT) {
      return {
        ok: false,
        inserted: 0,
        skipped: "no_token",
        errors,
        message:
          "APIFY_ONLY=1: defina APIFY_TOKEN na Vercel. A Graph API da Meta não é usada (pode apagar ou ignorar META_AD_LIBRARY_ACCESS_TOKEN).",
      };
    }
  } else if (!token && !apifyT) {
    return {
      ok: false,
      inserted: 0,
      skipped: "no_token",
      errors,
      message:
        "Defina APIFY_TOKEN (recomendado) ou META_AD_LIBRARY_ACCESS_TOKEN (Graph API) na Vercel.",
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

  if (mode === "fill_if_empty" || mode === "feed_blocking_fill" || mode === "catalog_post_fill") {
    const { count: visibleCount, error: countErr } = await countFeedVisibleAds(admin, countScope);
    if (countErr) {
      return { ok: false, inserted: 0, errors: [countErr.message], message: countErr.message };
    }
    if ((visibleCount ?? 0) > 0) {
      return { ok: true, inserted: 0, skipped: "has_ads", errors };
    }

    if (mode === "fill_if_empty") {
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
  }

  const maxAds =
    mode === "catalog_post_fill"
      ? Math.min(48, Math.max(8, Number(process.env.CATALOG_FILL_MAX_ADS ?? "22")))
      : mode === "cron_replace"
        ? Math.min(500, Math.max(40, Number(process.env.META_AD_LIBRARY_MAX_ADS ?? "240")))
        : mode === "feed_blocking_fill"
          ? Math.min(96, Math.max(16, Number(process.env.FEED_BLOCKING_MAX_ADS ?? "48")))
          : Math.min(150, Math.max(20, Number(process.env.META_AD_LIBRARY_MAX_ADS ?? "100")));
  const maxPages =
    mode === "catalog_post_fill"
      ? Math.min(2, Math.max(1, Number(process.env.CATALOG_FILL_PAGES_PER_KEYWORD ?? "1")))
      : mode === "feed_blocking_fill"
        ? Math.min(4, Math.max(1, Number(process.env.FEED_BLOCKING_PAGES_PER_KEYWORD ?? "2")))
        : Math.min(8, Math.max(1, Number(process.env.META_AD_LIBRARY_PAGES_PER_KEYWORD ?? "4")));
  const keywordCount =
    mode === "catalog_post_fill"
      ? Math.min(AD_LIBRARY_KEYWORDS.length, Math.max(2, Number(process.env.CATALOG_FILL_KEYWORD_COUNT ?? "3")))
      : mode === "feed_blocking_fill"
        ? Math.min(AD_LIBRARY_KEYWORDS.length, Math.max(2, Number(process.env.FEED_BLOCKING_KEYWORD_COUNT ?? "5")))
        : Math.min(AD_LIBRARY_KEYWORDS.length, Number(process.env.META_AD_LIBRARY_KEYWORD_COUNT ?? "8"));
  const keywordsSlice = AD_LIBRARY_KEYWORDS.slice(0, keywordCount);
  const envMedia = (process.env.META_AD_LIBRARY_MEDIA_TYPE ?? "ALL").trim().toUpperCase() || "ALL";

  const apifyQuickFill =
    mode === "feed_blocking_fill" || mode === "catalog_post_fill" || mode === "fill_if_empty";

  const mineCountries = countScope ? [countScope.country] : undefined;

  let { rows, errors: mineErrors } = await mineAdLibraryDaily({
    accessToken: token,
    maxAds,
    maxPagesPerKeyword: maxPages,
    keywords: keywordsSlice,
    apifyQuickFill,
    countries: mineCountries,
    apifyCountry: countScope?.country,
    adLibraryUrlMedia,
  });
  errors.push(...mineErrors);

  if (rows.length === 0 && envMedia === "VIDEO" && !isCatalogVideoOnlyDefault()) {
    const retry = await mineAdLibraryDaily({
      accessToken: token,
      maxAds,
      maxPagesPerKeyword: maxPages,
      keywords: keywordsSlice,
      mediaType: "ALL",
      apifyQuickFill,
      countries: mineCountries,
      apifyCountry: countScope?.country,
      adLibraryUrlMedia,
    });
    errors.push("(retry com media_type=ALL)", ...retry.errors);
    rows = retry.rows;
  }

  if (rows.length === 0) {
    await relaxLockAfterFail();
    const graphHints = errors
      .filter((e) => e && !String(e).startsWith("(retry"))
      .slice(0, 5)
      .join(" | ");
    const hasApify = Boolean(getApifyAdLibraryToken());
    const fallback =
      mode === "cron_replace"
        ? "Nenhum anúncio retornado. Confira o token, permissões do app Meta e limites da Ad Library API."
        : hasApify
          ? "A mineração Apify não retornou anúncios (token/crédito Apify, ou a run excedeu o tempo no primeiro carregamento). Tente o botão no feed, aumente FEED_QUICK_WAIT_SECS na Vercel, ou chame o cron /api/cron/scheduled. Com só Apify, não use token Meta expirado — pode apagá-lo."
          : "A Meta não retornou anúncios. Na Vercel: META_AD_LIBRARY_ACCESS_TOKEN (token com acesso à Ad Library), META_APP_SECRET se o app exige appsecret_proof, e permissões/revisão do app na Meta.";
    const tokenExpiredHint =
      !hasApify &&
      graphHints &&
      /(?:^|[\s|])(?:código\s*)?190\b|Session has expired|OAuthException|access token.*expir/i.test(graphHints)
        ? " Ação: esse token já expirou na Meta (código 190). Gere um novo — de preferência long-lived ou token de sistema/usuário do app para servidor — e substitua META_AD_LIBRARY_ACCESS_TOKEN na Vercel."
        : "";
    const appsecretHint =
      graphHints &&
      /appsecret_proof|GraphMethodException/i.test(graphHints) &&
      /(?:^|[\s|])(?:código\s*)?100\b/.test(graphHints)
        ? " Ação: o App Secret não bate com o token (código 100). Copie de novo a chave secreta em Meta → Configurações → Básico (mesmo app do token) para META_APP_SECRET. Se em Avançado o app não exige “Require app secret”, apague META_APP_SECRET ou defina META_AD_LIBRARY_SKIP_APPSECRET_PROOF=1 na Vercel para não enviar proof."
        : "";
    const message = graphHints
      ? `${fallback} Detalhe da API: ${graphHints}${tokenExpiredHint}${appsecretHint}`
      : fallback;
    return {
      ok: false,
      inserted: 0,
      errors,
      message,
    };
  }

  if (mode === "cron_replace") {
    const batch = await mergeAdLibraryDailyRows(admin, rows, errors);
    if (!batch.ok) {
      await relaxLockAfterFail();
    }
    return batch;
  }

  const batch = await replaceAdLibraryDailyBatch(admin, rows, errors);
  if (!batch.ok) {
    await relaxLockAfterFail();
  } else {
    await pruneAdLibraryDailyExcess(admin);
  }
  return batch;
}

/** Atalho para disparo em background (só preenche se o feed estiver vazio). */
export async function runAdLibrarySync(): Promise<AdLibrarySyncResult> {
  return runAdLibraryIngest({ mode: "fill_if_empty" });
}
