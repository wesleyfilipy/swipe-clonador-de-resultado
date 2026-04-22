import { NextResponse } from "next/server";
import { resolveAdCreativeInCatalog } from "@/lib/resolve-ad-creative";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

/**
 * Tenta rebuscar o vídeo do criativo (Graph e/ou Apify na página do anúncio) e atualizar o registo;
 * em seguida tenta copiar o ficheiro para o bucket Storage.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
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

  const result = await resolveAdCreativeInCatalog(id);
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: result.error === "Não foi possível obter URL de vídeo" ? 422 : 400 }
    );
  }

  return NextResponse.json({
    ad: result.ad,
    mirrored: result.mirrored,
    source: result.source,
  });
}
