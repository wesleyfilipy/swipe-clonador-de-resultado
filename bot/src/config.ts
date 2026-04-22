import "dotenv/config";

export const KEYWORDS = [
  "lose weight",
  "make money online",
  "supplement",
  "fitness",
  "crypto",
  "health",
  "dating",
] as const;

export const AD_LIBRARY_COUNTRY = "US";
export const AD_LIBRARY_ACTIVE = "active";

export const env = {
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  headful: process.env.BOT_HEADFUL === "1" || process.env.BOT_HEADFUL === "true",
  maxAdsPerRun: Number(process.env.BOT_MAX_ADS ?? "400"),
  maxPerKeyword: Number(process.env.BOT_MAX_PER_KEYWORD ?? "120"),
  scrollRounds: Number(process.env.BOT_SCROLL_ROUNDS ?? "35"),
  proxyServer: process.env.BOT_PROXY_SERVER ?? "",
  transcribe: process.env.BOT_TRANSCRIBE === "1" || process.env.BOT_TRANSCRIBE === "true",
};

export function requireEnv() {
  if (!env.supabaseUrl || !env.supabaseServiceKey) {
    throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
  }
}
