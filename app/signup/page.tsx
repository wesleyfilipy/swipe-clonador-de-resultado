"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useBrowserSupabase } from "@/components/supabase/BrowserSupabaseProvider";

export default function SignupPage() {
  const router = useRouter();
  const { supabase, error: configError, ready } = useBrowserSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError("Aguarde o carregamento ou verifique a configuração do Supabase.");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    const redirect =
      typeof window !== "undefined" ? `${window.location.origin}/feed` : undefined;
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: redirect ? { emailRedirectTo: redirect } : undefined,
    });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (data.user && !data.session) {
      setSuccess(
        "Conta criada. Abra o e-mail que enviamos e clique no link de confirmação; depois volte aqui em Entrar. Verifique também o spam."
      );
      return;
    }
    router.push("/feed");
    router.refresh();
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 bg-surface-950">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-zinc-800 bg-surface-900 p-8 shadow-xl">
        <div>
          <h1 className="text-2xl font-semibold">Criar conta</h1>
          <p className="text-sm text-zinc-400 mt-1">Plano mensal R$20 para feed ilimitado.</p>
        </div>
        {configError && (
          <p className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            {configError}
          </p>
        )}
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-zinc-500">E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-surface-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-surface-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && (
            <p className="text-sm text-emerald-400 leading-relaxed border border-emerald-500/30 rounded-lg px-3 py-2 bg-emerald-500/5">
              {success}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || !ready || !supabase || Boolean(success)}
            className="w-full rounded-lg bg-indigo-500 py-2.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {!ready ? "Conectando…" : loading ? "Criando…" : success ? "Cadastro enviado" : "Cadastrar"}
          </button>
        </form>
        <p className="text-center text-sm text-zinc-500">
          Já tem conta?{" "}
          <Link href="/login" className="text-indigo-400 hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
