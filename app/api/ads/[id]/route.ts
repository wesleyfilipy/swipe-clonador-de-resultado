import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adRowToPublic } from "@/lib/spy/api-mapper";
import type { AdRow } from "@/types/database";

/**
 * Detalhe de um anúncio (catálogo processado). Não dispara mineração.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const asPublic = searchParams.get("format") === "public";

  const { data, error } = await supabase.from("ads").select("*").eq("id", id).maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }
  const row = data as AdRow;
  if (row.mine_source === "instant_demo") {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  if (asPublic) {
    return NextResponse.json({ ad: adRowToPublic(row) });
  }
  return NextResponse.json({ ad: data });
}
