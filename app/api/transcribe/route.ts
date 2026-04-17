import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDirectVideoUrl } from "@/lib/media";

const MAX_WHISPER_BYTES = 24 * 1024 * 1024;

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "OPENAI_API_KEY não configurada" }, { status: 500 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = (await req.json()) as { ad_id?: string; type?: "creative" | "vsl" };
  if (!body.ad_id || !body.type) {
    return NextResponse.json({ error: "ad_id e type são obrigatórios" }, { status: 400 });
  }

  const { data: ad, error: adErr } = await supabase.from("ads").select("*").eq("id", body.ad_id).single();
  if (adErr || !ad) return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });

  const url = body.type === "creative" ? ad.video_url : ad.vsl_url;
  if (!isDirectVideoUrl(url)) {
    return NextResponse.json(
      {
        error:
          body.type === "vsl"
            ? "VSL não é URL de vídeo direto. Faça upload manual ou use página com player de vídeo público."
            : "Criativo sem URL de vídeo direto para transcrever.",
      },
      { status: 400 }
    );
  }

  const media = await fetch(url as string);
  if (!media.ok || !media.body) {
    return NextResponse.json({ error: "Não foi possível baixar o vídeo" }, { status: 502 });
  }

  const buf = Buffer.from(await media.arrayBuffer());
  if (buf.byteLength > MAX_WHISPER_BYTES) {
    return NextResponse.json({ error: "Vídeo acima do limite do Whisper (24MB)" }, { status: 413 });
  }

  const openai = new OpenAI({ apiKey: key });
  const file = new File([buf], "creative.mp4", { type: "video/mp4" });
  const tr = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "pt",
  });

  const admin = createAdminClient();
  const { error: insErr } = await admin.from("transcriptions").upsert(
    {
      ad_id: body.ad_id,
      type: body.type,
      text: tr.text,
    },
    { onConflict: "ad_id,type" }
  );

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ text: tr.text });
}
