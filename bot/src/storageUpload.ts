import { adminClient } from "./supabaseAdmin.js";

const BUCKET = "creatives";

export async function uploadPublicFile(path: string, body: Buffer, contentType: string) {
  const supabase = adminClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
