import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { data, error } = await supabase.from("favorites").select("ad_id").eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ids: (data ?? []).map((r) => r.ad_id) });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = (await req.json()) as { ad_id?: string };
  if (!body.ad_id) return NextResponse.json({ error: "ad_id obrigatório" }, { status: 400 });

  const { data: existing } = await supabase
    .from("favorites")
    .select("ad_id")
    .eq("user_id", user.id)
    .eq("ad_id", body.ad_id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("favorites").delete().eq("user_id", user.id).eq("ad_id", body.ad_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ favorited: false });
  }

  const { error } = await supabase.from("favorites").insert({ user_id: user.id, ad_id: body.ad_id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ favorited: true });
}
