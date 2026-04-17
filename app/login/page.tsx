"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useBrowserSupabase } from "@/components/supabase/BrowserSupabaseProvider";

export default function LoginPage() {
  const router = useRouter();
  const { supabase, error: configError, ready } = useBrowserSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendOk, setResendOk] = useState<string | null>(null);

  function isEmailNotConfirmed(err: { message?: string; code?: string }) {
    const m = (err.message ?? "").toLowerCase();
    return err.code === "email_not_confirmed" || m.includes("email not confirmed") || m.includes("not confirmed");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError("Aguarde o carregamento ou verifique a configuração do Supabase.");
      return;
    }
    setLoading(true);
    setError(null);
    setNeedsEmailConfirmation(false);
    setResendOk(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (err) {
      if (isEmailNotConfirmed(err)) {
        setNeedsEmailConfirmation(true);
        setError(
          "Este e-mail ainda não foi confirmado. Abra o link que o Supabase enviou (caixa de entrada e spam). Se não achar, use “Reenviar confirmação” abaixo."
        );
        return;
      }
      setError(err.message);
      return;
    }
    router.push("/feed");
    router.refresh();
  }

  async function resendConfirmation() {
    if (!supabase || !email.trim()) {
      setError("Informe o e-mail acima.");
      return;
    }
    setResendLoading(true);
    setResendOk(null);
    setError(null);
    const { error: err } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: {
        emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/feed` : undefined,
      },
    });
    setResendLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setResendOk("E-mail de confirmação enviado. Verifique a caixa de entrada e o spam.");
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 bg-surface-950">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-zinc-800 bg-surface-900 p-8 shadow-xl">
        <div>
          <h1 className="text-2xl font-semibold">Entrar</h1>
          <p className="text-sm text-zinc-400 mt-1">Acesse o feed completo com assinatura ativa.</p>
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-surface-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {resendOk && <p className="text-sm text-emerald-400">{resendOk}</p>}
          <button
            type="submit"
            disabled={loading || !ready || !supabase}
            className="w-full rounded-lg bg-indigo-500 py-2.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {!ready ? "Conectando…" : loading ? "Entrando…" : "Entrar"}
          </button>
          {needsEmailConfirmation && (
            <div className="space-y-2 rounded-lg border border-zinc-700 bg-surface-950/80 p-3">
              <button
                type="button"
                onClick={() => void resendConfirmation()}
                disabled={resendLoading || !supabase}
                className="w-full rounded-lg border border-indigo-500/50 bg-indigo-500/10 py-2 text-sm font-medium text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50"
              >
                {resendLoading ? "Enviando…" : "Reenviar e-mail de confirmação"}
              </button>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Em desenvolvimento, no Supabase: Authentication → Providers → Email → desative “Confirm email”
                para entrar sem confirmar.
              </p>
            </div>
          )}
        </form>
        <p className="text-center text-sm text-zinc-500">
          Não tem conta?{" "}
          <Link href="/signup" className="text-indigo-400 hover:underline">
            Cadastre-se
          </Link>
        </p>
      </div>
    </div>
  );
}
