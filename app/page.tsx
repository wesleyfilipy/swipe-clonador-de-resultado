import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 bg-gradient-to-b from-surface-900 to-surface-950">
      <div className="max-w-lg text-center space-y-6">
        <p className="text-xs uppercase tracking-[0.25em] text-indigo-300/90">ESPIÃO NUTRA · Facebook Ads · VSL</p>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
          Anúncios escalados em modo{" "}
          <span className="text-indigo-400">swipe</span>
        </h1>
        <p className="text-zinc-400 text-sm sm:text-base leading-relaxed">
          Criativo em vídeo com autoplay, VSL embutida na tela, transcrições Whisper, favoritos e download
          sem sair da plataforma.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          {user ? (
            <Link
              href="/feed"
              className="rounded-full bg-indigo-500 hover:bg-indigo-400 px-8 py-3 text-sm font-medium text-white transition"
            >
              Abrir feed
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full bg-indigo-500 hover:bg-indigo-400 px-8 py-3 text-sm font-medium text-white transition"
              >
                Entrar
              </Link>
              <Link
                href="/signup"
                className="rounded-full border border-zinc-700 hover:border-zinc-500 px-8 py-3 text-sm font-medium text-zinc-200 transition"
              >
                Criar conta
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
