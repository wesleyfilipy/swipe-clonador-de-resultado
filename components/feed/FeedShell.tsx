"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBrowserSupabase } from "@/components/supabase/BrowserSupabaseProvider";
import type { AdRow, SortMode } from "@/types/database";
import { FREE_AD_LIMIT } from "@/lib/constants";
import { AdSlide } from "./AdSlide";

const NICHES = ["todos", "fitness", "renda extra", "saúde", "relacionamento", "crypto", "geral"] as const;

type Props = {
  email: string;
  initialSubscriber: boolean;
};

export function FeedShell({ email, initialSubscriber }: Props) {
  const { supabase, error: configError, ready } = useBrowserSupabase();
  const scrollRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const [ads, setAds] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [subscriber, setSubscriber] = useState(initialSubscriber);
  const [niche, setNiche] = useState<string>("todos");
  const [sort, setSort] = useState<SortMode>("scaled");
  const [vslLayout, setVslLayout] = useState<"split" | "modal">("split");
  const [active, setActive] = useState(0);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const lastHistory = useRef<string | null>(null);

  const fetchPage = useCallback(async (reset: boolean) => {
    if (reset) {
      setLoading(true);
      offsetRef.current = 0;
    } else {
      setLoadingMore(true);
    }

    const params = new URLSearchParams({
      niche,
      sort,
      offset: String(offsetRef.current),
      limit: "6",
    });
    const res = await fetch(`/api/ads?${params.toString()}`, { credentials: "include" });
    const json = await res.json();
    if (reset) setLoading(false);
    else setLoadingMore(false);

    if (!res.ok) return;

    setSubscriber(Boolean(json.subscriber));
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
    void fetchPage(true);
  }, [fetchPage]);

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

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.min(ads.length - 1, Math.max(0, Math.round(el.scrollTop / el.clientHeight)));
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

  async function checkout() {
    const res = await fetch("/api/stripe/checkout", { method: "POST", credentials: "include" });
    const j = await res.json();
    if (j.url) window.location.href = j.url as string;
  }

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

  const upgradeBanner = useMemo(
    () =>
      !subscriber ? (
        <div className="mx-3 mt-2 mb-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100 flex flex-wrap items-center gap-2 justify-between">
          <span>
            Plano free: até {FREE_AD_LIMIT} anúncios. Assine por R$20/mês para scroll ilimitado.
          </span>
          <button
            type="button"
            onClick={checkout}
            className="rounded-full bg-amber-400 text-black px-3 py-1 text-[11px] font-semibold"
          >
            Assinar
          </button>
        </div>
      ) : null,
    [subscriber]
  );

  if (!ready) {
    return (
      <div className="h-dvh flex items-center justify-center text-sm text-zinc-400">Conectando ao Supabase…</div>
    );
  }

  if (configError || !supabase) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center gap-3 px-6 text-center text-sm text-amber-200">
        <p>{configError ?? "Cliente Supabase indisponível."}</p>
        <p className="text-zinc-500 text-xs">Confira .env.local ou variáveis no painel de deploy.</p>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-surface-950 text-zinc-100">
      <header className="shrink-0 z-40 border-b border-zinc-800 bg-surface-950/95 backdrop-blur">
        <div className="max-w-md mx-auto px-3 pt-2 flex items-center justify-between gap-2">
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
            Início
          </Link>
          <span className="text-[11px] text-zinc-500 truncate max-w-[40%]">{email}</span>
          <button type="button" onClick={logout} className="text-[11px] text-zinc-400 hover:text-white">
            Sair
          </button>
        </div>
        {upgradeBanner}
        <div className="max-w-md mx-auto px-3 py-2 flex flex-col gap-2">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {NICHES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNiche(n)}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-[11px] border ${
                  niche === n
                    ? "border-indigo-400 bg-indigo-500/20 text-indigo-100"
                    : "border-zinc-700 text-zinc-400"
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
                  ["recent", "Recentes"],
                  ["active", "Mais tempo ativo"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(k)}
                  className={`text-[11px] rounded-md px-2 py-1 ${
                    sort === k ? "bg-zinc-100 text-black" : "text-zinc-400 hover:text-white"
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
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="feed-scroll flex-1 no-scrollbar max-w-md mx-auto w-full border-x border-zinc-900/60"
      >
        {ads.map((ad, i) => (
          <AdSlide
            key={ad.id}
            ad={ad}
            active={i === active}
            preload={i === active + 1}
            favorited={favorites.has(ad.id)}
            vslLayout={vslLayout}
            onFavorite={() => void toggleFavorite(ad.id)}
          />
        ))}
        {(loading || loadingMore) && (
          <div className="h-20 flex items-center justify-center text-xs text-zinc-500">Carregando…</div>
        )}
        {!loading && ads.length === 0 && (
          <div className="h-[50dvh] flex items-center justify-center text-sm text-zinc-500 px-6 text-center">
            Nenhum anúncio. Rode o SQL em `supabase/schema.sql`, depois `npm run seed` ou a mineração Meta.
          </div>
        )}
      </div>
    </div>
  );
}
