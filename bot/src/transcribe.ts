import OpenAI from "openai";
import { adminClient } from "./supabaseAdmin.js";
import { env } from "./config.js";

const MAX_BYTES = 24 * 1024 * 1024;

export async function transcribeRemoteVideo(params: {
  videoUrl: string;
  internalAdId: string;
  type: "creative" | "vsl";
}) {
  if (!env.openaiKey) return null;
  const res = await fetch(params.videoUrl);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) return null;

  const client = new OpenAI({ apiKey: env.openaiKey });
  const file = new File([buf], "clip.mp4", { type: "video/mp4" });
  const tr = await client.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "pt",
  });

  const supabase = adminClient();
  await supabase.from("transcriptions").upsert(
    { ad_id: params.internalAdId, type: params.type, text: tr.text },
    { onConflict: "ad_id,type" }
  );
  return tr.text;
}
