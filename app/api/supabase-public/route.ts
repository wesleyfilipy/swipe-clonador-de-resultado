import path from "path";
import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isSupabaseEnvKey(key: string) {
  return (
    key === "NEXT_PUBLIC_SUPABASE_URL" ||
    key === "NEXT_PUBLIC_SUPABASE_ANON_KEY" ||
    key === "SUPABASE_URL" ||
    key === "SUPABASE_ANON_KEY" ||
    key === "SUPABASE_SERVICE_ROLE_KEY"
  );
}

/** Garante leitura do .env.local em alguns ambientes (ex.: next start) onde o carregamento falhou. */
function tryLoadDotenvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && isSupabaseEnvKey(key)) {
      process.env[key] = val;
    }
  }
}

/**
 * Expõe URL + anon para o browser em runtime (evita bundle sem NEXT_PUBLIC_*).
 * A chave anon é pública por design no Supabase.
 */
export async function GET() {
  tryLoadDotenvLocal();

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

  if (!url || !anonKey) {
    const hints = [
      "Na raiz do projeto, crie o arquivo .env.local com NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (copie de Supabase → Project Settings → API). Reinicie npm run dev.",
      "No Vercel (ou outro host): Settings → Environment Variables → adicione as mesmas variáveis para Production e Preview → faça Redeploy.",
      "Opcional no servidor: SUPABASE_URL + SUPABASE_ANON_KEY (mesmos valores) se não quiser usar o prefixo NEXT_PUBLIC_ na API.",
    ];
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "O servidor não encontrou URL nem chave anon do Supabase. Configure as variáveis de ambiente (veja dicas abaixo).",
        hints,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ url, anonKey });
}
