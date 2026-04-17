import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Expõe URL + anon para o browser em runtime (evita bundle sem NEXT_PUBLIC_*).
 * A chave anon é pública por design no Supabase.
 */
export async function GET() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

  if (!url || !anonKey) {
    return NextResponse.json(
      { error: "not_configured", message: "Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (ou SUPABASE_URL + SUPABASE_ANON_KEY) no servidor." },
      { status: 503 }
    );
  }

  return NextResponse.json({ url, anonKey });
}
