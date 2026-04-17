/**
 * Popula anúncios de exemplo para desenvolvimento.
 * Uso: defina SUPABASE_SERVICE_ROLE_KEY e NEXT_PUBLIC_SUPABASE_URL no ambiente e rode `npm run seed`
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const samples = [
  {
    title: "VSL Fitness — protocolo 21 dias",
    niche: "fitness",
    video_url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    vsl_url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    thumbnail: null as string | null,
    ad_copy: "Descubra o método que está bombando nas academias. Oferta por tempo limitado.",
    views_day: 4200,
    views_week: 28000,
    active_days: 45,
    facebook_ad_id: "demo-1",
  },
  {
    title: "Renda extra com IA",
    niche: "renda extra",
    video_url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    vsl_url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    thumbnail: null,
    ad_copy: "Monetize seu tempo livre com automações simples. Clique e veja o passo a passo.",
    views_day: 9100,
    views_week: 62000,
    active_days: 72,
    facebook_ad_id: "demo-2",
  },
  {
    title: "Suplemento natural",
    niche: "saúde",
    video_url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    vsl_url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    thumbnail: null,
    ad_copy: "Ingredientes naturais, resultados em semanas. Estoque limitado.",
    views_day: 3000,
    views_week: 19000,
    active_days: 28,
    facebook_ad_id: "demo-3",
  },
];

async function main() {
  const { error } = await admin.from("ads").insert(samples);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`Inseridos ${samples.length} anúncios de exemplo.`);
}

main();
