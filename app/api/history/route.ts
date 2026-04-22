import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = (await req.json()) as { ad_id?: string };
  if (!body.ad_id) return NextResponse.json({ error: "ad_id obrigatório" }, { status: 400 });

  const { error } = await supabase.from("watch_history").insert({ user_id: user.id, ad_id: body.ad_id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
