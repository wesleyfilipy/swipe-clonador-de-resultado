"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Ctx = {
  supabase: SupabaseClient | null;
  error: string | null;
  ready: boolean;
};

const SupabaseBrowserContext = createContext<Ctx | null>(null);

export function BrowserSupabaseProvider({ children }: { children: React.ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const inlineUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const inlineKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (inlineUrl && inlineKey) {
        if (!cancelled) {
          setSupabase(createBrowserClient(inlineUrl, inlineKey));
          setError(null);
          setReady(true);
        }
        return;
      }

      const res = await fetch("/api/supabase-public", { cache: "no-store" });
      const j = (await res.json()) as { url?: string; anonKey?: string; message?: string };
      if (cancelled) return;
      if (!res.ok || !j.url || !j.anonKey) {
        setSupabase(null);
        setError(j.message ?? "Supabase não configurado no servidor.");
        setReady(true);
        return;
      }
      setSupabase(createBrowserClient(j.url, j.anonKey));
      setError(null);
      setReady(true);
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({ supabase, error, ready }), [supabase, error, ready]);

  return <SupabaseBrowserContext.Provider value={value}>{children}</SupabaseBrowserContext.Provider>;
}

export function useBrowserSupabase(): Ctx {
  const ctx = useContext(SupabaseBrowserContext);
  if (!ctx) {
    throw new Error("useBrowserSupabase deve ficar dentro de BrowserSupabaseProvider");
  }
  return ctx;
}
