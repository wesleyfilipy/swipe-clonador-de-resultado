import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const adId = new URL(req.url).searchParams.get("ad_id");
  if (!adId) return NextResponse.json({ error: "ad_id obrigatório" }, { status: 400 });

  const { data, error } = await supabase.from("transcriptions").select("*").eq("ad_id", adId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
