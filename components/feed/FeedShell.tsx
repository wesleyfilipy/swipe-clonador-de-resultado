"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBrowserSupabase } from "@/components/supabase/BrowserSupabaseProvider";
import { toMediaProxyUrl } from "@/lib/media";
import type { AdRow, SortMode } from "@/types/database";
import { AdSlide } from "./AdSlide";

const NICHES = [
  "todos",
  "fitness",
  "beauty",
  "crypto",
  "make money",
  "ecommerce",
  "supplement",
  "other",
  "renda extra",
  "saúde",
  "relacionamento",
  "geral",
] as const;

type Props = {
  email: string;
  /** Pré-carregados no servidor (entrada instantânea quando há dados no Supabase). */
  initialAds?: AdRow[];
  initialHasMore?: boolean;
};

export function FeedShell({ email, initialAds = [], initialHasMore = true }: Props) {
  const { supabase, error: configError, ready } = useBrowserSupabase();
  const scrollRef = useRef<HTMLDivElement>(null);
  const beltRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(initialAds.length);
  const didSkipHydratedFetch = useRef(false);

  const [ads, setAds] = useState<AdRow[]>(initialAds);
  const [loading, setLoading] = useState(initialAds.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [niche, setNiche] = useState<string>("todos");
  const [sort, setSort] = useState<SortMode>("scaled");
  const [vslLayout, setVslLayout] = useState<"split" | "modal">("split");
  const [active, setActive] = useState(0);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Após várias tentativas sem anúncios: mostra painel acionável em vez de “preparando” eterno. */
  const [catalogTimedOut, setCatalogTimedOut] = useState(false);
  const [pollNonce, setPollNonce] = useState(0);
  const [catalogKickBusy, setCatalogKickBusy] = useState(false);
  const lastHistory = useRef<string | null>(null);
  /** Evita vários GET /api/ads ao mesmo tempo (Realtime, foco da aba, botão). */
  const catalogFetchInFlight = useRef(false);
  const lastVisibilityRefetchAt = useRef(0);
  /** Debounce do botão de buscar anúncios (evita vários POST / 429). */
  const lastManualCatalogKickAt = useRef(0);

  const fetchPage = useCallback(async (reset: boolean, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (reset) {
      if (!silent) setLoading(true);
      offsetRef.current = 0;
    } else {
      setLoadingMore(true);
    }

    const params = new URLSearchParams({
      niche,
      sort,
      offset: String(offsetRef.current),
      limit: "8",
    });
    const res = await fetch(`/api/ads?${params.toString()}`, { credentials: "include" });
    const json = await res.json();
    if (reset) {
      if (!silent) setLoading(false);
    } else {
      setLoadingMore(false);
    }

    if (!res.ok) {
      setLoadError(typeof json.error === "string" ? json.error : "Erro ao carregar anúncios.");
      return;
    }
    setLoadError(null);

    setHasMore(Boolean(json.hasMore));
    const rows = (json.ads as AdRow[]) ?? [];

    if (reset) {
      setAds(rows);
    } else {
      setAds((prev) => [...prev, ...rows]);
    }
    offsetRef.current += rows.length;
  }, [niche, sort]);

  useEffect(() => {
    if (ads.length > 0) {
      setCatalogTimedOut(false);
    }
  }, [ads.length]);

  const kickCatalogFill = useCallback(async () => {
    if (catalogFetchInFlight.current) return;
    const now = Date.now();
    if (now - lastManualCatalogKickAt.current < 3500) return;
    lastManualCatalogKickAt.current = now;

    catalogFetchInFlight.current = true;
    setCatalogKickBusy(true);
    try {
      let res: Response;
      try {
        res = await fetch("/api/catalog-fill", { method: "POST", credentials: "include" });
      } catch {
        setLoadError("Sem conexão ou o servidor encerrou antes da resposta (timeout). Tente de novo em instantes.");
        return;
      }

      const raw = await res.text();
      let j: Record<string, unknown> = {};
      if (raw) {
        try {
          j = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          /* HTML da Vercel em 504 etc. */
        }
      }

      await fetchPage(true, { silent: true });
      queueMicrotask(() => {
        if (res.ok) return;
        if (res.status === 401) {
          setLoadError("Sessão expirada. Entre de novo.");
          return;
        }
        if (res.status === 429) {
          const s = typeof j.retryAfterSec === "number" ? j.retryAfterSec : 60;
          setLoadError(`Aguarde ~${s}s antes de tentar de novo (limite do servidor).`);
          return;
        }
        if (res.status === 504 || res.status === 408) {
          setLoadError(
            "O servidor demorou demais (timeout na hospedagem). O botão usa uma mineração mais curta; tente outra vez ou use um plano Vercel com limite maior."
          );
          return;
        }
        if (res.status === 503) {
          setLoadError(
            typeof j.message === "string"
              ? j.message
              : "Servidor sem APIFY_TOKEN/token de mineração ou mineração desligada (AUTO_AD_LIBRARY_SYNC=0)."
          );
          return;
        }
        if (res.status === 502) {
          const errs = Array.isArray(j.errors)
            ? (j.errors as unknown[]).map((x) => String(x)).filter(Boolean).slice(0, 5)
            : [];
          const head = typeof j.message === "string" ? j.message : "Erro ao popular o catálogo (502).";
          const tail = errs.length ? `\n\n${errs.join("\n")}` : "";
          setLoadError(`${head}${tail}`);
          return;
        }
        const err0 = Array.isArray(j.errors) && j.errors[0] ? String(j.errors[0]) : "";
        setLoadError(
          typeof j.message === "string"
            ? j.message
            : err0 || "Erro ao falar com o servidor. Tente de novo."
        );
      });
    } finally {
      catalogFetchInFlight.current = false;
      setCatalogKickBusy(false);
    }
  }, [fetchPage]);

  /** Quando o servidor gravar novos anúncios no Supabase, atualiza a lista (Realtime na tabela `ads`). */
  useEffect(() => {
    if (!supabase || niche !== "todos" || ads.length > 0) return;
    const channel = supabase
      .channel("feed-ads-inserts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ads" },
        () => {
          if (catalogFetchInFlight.current) return;
          catalogFetchInFlight.current = true;
          void fetchPage(true).finally(() => {
            catalogFetchInFlight.current = false;
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, niche, ads.length, fetchPage]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible" || ads.length > 0 || niche !== "todos") return;
      const now = Date.now();
      if (now - lastVisibilityRefetchAt.current < 45_000) return;
      lastVisibilityRefetchAt.current = now;
      if (catalogFetchInFlight.current) return;
      catalogFetchInFlight.current = true;
      void fetchPage(true).finally(() => {
        catalogFetchInFlight.current = false;
      });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [ads.length, niche, fetchPage]);

  /**
   * Catálogo ainda vazio após a primeira carga: consulta o Supabase de novo a cada poucos segundos
   * até aparecer conteúdo (mineração em background no servidor, cron, ou Realtime se estiver ativo).
   */
  useEffect(() => {
    if (ads.length > 0 || niche !== "todos" || sort !== "scaled") return;
    if (loading) return;

    const intervalMs = 3200;
    const maxTicks = 50;

    let ticks = 0;
    const id = setInterval(() => {
      ticks += 1;
      if (ticks > maxTicks) {
        clearInterval(id);
        setCatalogTimedOut(true);
        return;
      }
      if (catalogFetchInFlight.current) return;
      catalogFetchInFlight.current = true;
      void fetchPage(true, { silent: true }).finally(() => {
        catalogFetchInFlight.current = false;
      });
    }, intervalMs);

    return () => clearInterval(id);
  }, [ads.length, loading, niche, sort, fetchPage, pollNonce]);

  useEffect(() => {
    const serverDefault = niche === "todos" && sort === "scaled";
    if (!didSkipHydratedFetch.current && initialAds.length > 0 && serverDefault) {
      didSkipHydratedFetch.current = true;
      return;
    }
    didSkipHydratedFetch.current = true;
    void fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialAds é snapshot do servidor na hidratação
  }, [fetchPage, niche, sort]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setActive(0);
    lastHistory.current = null;
  }, [niche, sort]);

  useEffect(() => {
    fetch("/api/favorites", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => setFavorites(new Set(j.ids as string[])))
      .catch(() => {});
  }, []);

  const scrollToIndex = useCallback((i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const h = el.clientHeight;
    const idx = Math.max(0, Math.min(i, ads.length - 1));
    el.scrollTo({ top: idx * h, behavior: "smooth" });
    setActive(idx);
  }, [ads.length]);

  useEffect(() => {
    const strip = beltRef.current;
    if (!strip || ads.length === 0) return;
    const btn = strip.querySelector(`[data-thumb-idx="${active}"]`);
    btn?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active, ads.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const h = el.clientHeight || 1;
    const idx = Math.min(ads.length - 1, Math.max(0, Math.round(el.scrollTop / h)));
    setActive(idx);

    const nearEnd = ads.length > 0 && idx >= ads.length - 2;
    if (nearEnd && hasMore && !loading && !loadingMore) {
      void fetchPage(false);
    }
  };

  useEffect(() => {
    const ad = ads[active];
    if (!ad) return;
    if (lastHistory.current === ad.id) return;
    lastHistory.current = ad.id;
    void fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ad_id: ad.id }),
    });
  }, [active, ads]);

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    window.location.href = "/";
  }

  async function toggleFavorite(id: string) {
    const res = await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ad_id: id }),
    });
    const j = await res.json();
    setFavorites((prev) => {
      const n = new Set(prev);
      if (j.favorited) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  if (!ready) {
    return (
      <div className="h-dvh flex items-center justify-center text-sm text-zinc-400">Conectando ao Supabase…</div>
    );
  }

  if (configError || !supabase) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center gap-3 px-6 text-center text-sm text-amber-200">
        <p className="whitespace-pre-line">{configError ?? "Cliente Supabase indisponível."}</p>
        <p className="text-zinc-500 text-xs">Confira .env.local ou variáveis no painel de deploy.</p>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-gradient-to-b from-zinc-950 via-[#0a0a0f] to-black text-zinc-100">
      <header className="shrink-0 z-40 border-b border-white/5 bg-zinc-950/85 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
        <div className="max-w-6xl mx-auto px-3 pt-2 flex items-center justify-between gap-2">
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0">
            Início
          </Link>
          <span className="text-[10px] font-semibold tracking-wide text-indigo-300/90 uppercase text-center truncate px-1">
            ESPIÃO NUTRA
          </span>
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            <span className="text-[11px] text-zinc-500 truncate max-w-[120px]">{email}</span>
            <button type="button" onClick={logout} className="text-[11px] text-zinc-400 hover:text-white">
              Sair
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-3 py-2 flex flex-col gap-2">
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {NICHES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNiche(n)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] border transition ${
                  niche === n
                    ? "border-indigo-400/80 bg-indigo-500/25 text-indigo-50 shadow-[0_0_20px_rgba(99,102,241,0.2)]"
                    : "border-zinc-700/80 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center justify-between">
            <div className="flex gap-2 flex-wrap">
              {(
                [
                  ["scaled", "Mais escalados"],
                  ["score", "Score (spy)"],
                  ["recent", "Recentes"],
                  ["active", "Mais tempo ativo"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(k)}
                  className={`text-[11px] rounded-md px-2.5 py-1 transition ${
                    sort === k ? "bg-white text-black font-medium" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setVslLayout((v) => (v === "split" ? "modal" : "split"))}
              className="text-[11px] text-indigo-300 hover:text-indigo-200 shrink-0"
            >
              VSL: {vslLayout === "split" ? "split" : "modal"}
            </button>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1 border-t border-white/5">
            <p className="text-[10px] text-zinc-500 leading-snug">
              <strong className="text-zinc-400">Nichos:</strong> a mineração muitas vezes grava tudo em <span className="text-zinc-300">geral</span>{" "}
              — usa <span className="text-zinc-300">todos</span> ou <span className="text-zinc-300">geral</span> se um filtro
              específico (ex. fitness) vier vazio.
            </p>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  if (catalogFetchInFlight.current) return;
                  catalogFetchInFlight.current = true;
                  void fetchPage(true).finally(() => {
                    catalogFetchInFlight.current = false;
                  });
                }}
                className="rounded-lg border border-zinc-600 hover:border-zinc-500 px-3 py-1.5 text-[11px] text-zinc-200 disabled:opacity-50"
              >
                {loading ? "…" : "Atualizar feed"}
              </button>
              <button
                type="button"
                disabled={catalogKickBusy}
                onClick={() => {
                  setCatalogTimedOut(false);
                  setPollNonce((n) => n + 1);
                  void kickCatalogFill();
                }}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1.5 text-[11px] font-medium text-white"
              >
                {catalogKickBusy ? "A buscar…" : "Buscar novos (minera)"}
              </button>
            </div>
          </div>
        </div>
      </header>

      {ads.length > 0 && (
        <div className="shrink-0 border-b border-white/5 bg-black/40">
          <div className="max-w-6xl mx-auto px-3 pt-2 pb-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Esteira — toque para assistir / baixar</p>
          </div>
          <div
            ref={beltRef}
            className="max-w-6xl mx-auto flex gap-2.5 overflow-x-auto no-scrollbar px-3 pb-3 pt-1 snap-x snap-mandatory scroll-smooth"
          >
            {ads.map((ad, i) => {
              const poster = toMediaProxyUrl(ad.thumbnail) ?? ad.thumbnail ?? undefined;
              return (
                <button
                  key={ad.id}
                  type="button"
                  data-thumb-idx={i}
                  onClick={() => scrollToIndex(i)}
                  className={`snap-start shrink-0 w-[4.75rem] text-left transition ${
                    i === active
                      ? "ring-2 ring-indigo-400 ring-offset-2 ring-offset-zinc-950 rounded-xl"
                      : "opacity-80 hover:opacity-100 rounded-xl"
                  }`}
                >
                  <div className="aspect-[9/16] rounded-lg overflow-hidden bg-zinc-800 border border-white/10 shadow-lg">
                    {poster ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={poster} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-indigo-900/50 to-zinc-900 flex items-center justify-center text-[10px] text-zinc-500 px-1 text-center">
                        {ad.niche}
                      </div>
                    )}
                  </div>
                  <span className="mt-1 block line-clamp-2 text-[9px] leading-tight text-zinc-400 px-0.5">
                    {ad.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 max-w-6xl mx-auto w-full border-x border-white/5">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="feed-scroll flex-1 min-h-0 overflow-y-scroll snap-y snap-mandatory overscroll-y-contain scroll-smooth no-scrollbar"
        >
          {loading && ads.length === 0 && (
            <div className="min-h-[min(480px,70dvh)] flex flex-col items-center justify-center gap-4 px-6 text-zinc-400">
              <div
                className="h-10 w-10 border-2 border-indigo-500/25 border-t-indigo-400 rounded-full animate-spin"
                aria-hidden
              />
              <p className="text-sm">A carregar o catálogo…</p>
            </div>
          )}
          {ads.map((ad, i) => (
            <div key={ad.id} className="snap-start snap-always shrink-0 h-full w-full box-border">
              <AdSlide
                ad={ad}
                active={i === active}
                preload={i === active + 1}
                favorited={favorites.has(ad.id)}
                vslLayout={vslLayout}
                onFavorite={() => void toggleFavorite(ad.id)}
              />
            </div>
          ))}
          {(loadingMore || (loading && ads.length > 0)) && (
            <div className="h-24 flex items-center justify-center text-xs text-zinc-500">Carregando…</div>
          )}
          {loadError && !(ads.length === 0 && niche === "todos") && (
            <div className="h-32 flex items-center justify-center text-sm text-red-400 px-6 text-center whitespace-pre-line">
              {loadError}
            </div>
          )}
          {!loading && ads.length === 0 && niche === "todos" && (
            <div className="min-h-full flex flex-col items-center justify-center gap-4 text-sm text-zinc-400 px-6 text-center py-12">
              <div className="space-y-4 max-w-md">
                {loadError && (
                  <p className="text-sm text-red-400/90 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2 whitespace-pre-line text-left">
                    {loadError}
                  </p>
                )}
                {!catalogTimedOut ? (
                    <>
                      <p className="font-semibold text-lg text-zinc-100">Buscando anúncios…</p>
                      <p className="text-sm text-zinc-400 leading-relaxed">
                        O servidor consulta o Supabase e, se o catálogo estiver vazio, <strong className="text-zinc-300">dispara a
                        mineração</strong> (Apify, se tiver <code className="text-xs">APIFY_TOKEN</code> na Vercel). Esta tela{" "}
                        <strong className="text-zinc-300">atualiza sozinha</strong> — pode levar até um minuto na primeira vez.
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        Ao abrir o feed o servidor já tenta em segundo plano. O botão abaixo força outra tentativa (com intervalo, para
                        não estourar limite do servidor/Apify).
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-lg text-amber-100/95">Ainda sem anúncios no feed</p>
                      <p className="text-sm text-zinc-400 leading-relaxed">
                        Costuma faltar <strong className="text-zinc-300">APIFY_TOKEN</strong> (ou token inválido), ou o plano/limite
                        do Apify. Confira o cron{" "}
                        <code className="text-xs text-zinc-500">/api/cron/scheduled</code> (e variáveis na Vercel) para o catálogo
                        encher em background.
                      </p>
                    </>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2 justify-center pt-1">
                    <button
                      type="button"
                      disabled={catalogKickBusy}
                      onClick={() => {
                        setCatalogTimedOut(false);
                        setPollNonce((n) => n + 1);
                        void kickCatalogFill();
                      }}
                      title="Aguarde alguns segundos entre um clique e outro"
                      className="rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2.5 text-sm font-medium text-white transition"
                    >
                      {catalogKickBusy ? "Buscando…" : "Buscar anúncios agora"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (catalogFetchInFlight.current) return;
                        catalogFetchInFlight.current = true;
                        void fetchPage(true).finally(() => {
                          catalogFetchInFlight.current = false;
                        });
                      }}
                      className="rounded-full border border-zinc-600 hover:border-zinc-500 px-5 py-2.5 text-sm text-zinc-200 transition"
                    >
                      Só atualizar lista
                    </button>
                  </div>
              </div>
            </div>
          )}
          {!loading && !loadError && ads.length === 0 && niche !== "todos" && (
            <div className="min-h-[min(420px,65dvh)] flex flex-col items-center justify-center gap-4 text-sm text-zinc-400 px-6 text-center py-12">
              <div className="space-y-3 max-w-sm">
                <p className="font-medium text-zinc-200">Nenhum anúncio com este nicho exato</p>
                <p className="text-sm text-zinc-500">
                  Os anúncios minados costumam ficar com etiqueta <strong className="text-zinc-300">geral</strong> ou outra. Experimenta
                  &quot;geral&quot; ou &quot;todos&quot;.
                </p>
                <div className="flex flex-col sm:flex-row gap-2 justify-center">
                  <button
                    type="button"
                    onClick={() => setNiche("todos")}
                    className="rounded-full bg-zinc-700 hover:bg-zinc-600 px-5 py-2 text-sm text-white transition"
                  >
                    Ver todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setNiche("geral")}
                    className="rounded-full border border-zinc-600 hover:border-zinc-500 px-5 py-2 text-sm text-zinc-200 transition"
                  >
                    Nicho: geral
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
