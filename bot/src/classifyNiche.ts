import OpenAI from "openai";
import { env } from "./config.js";

const ALLOWED = [
  "fitness",
  "renda extra",
  "saúde",
  "relacionamento",
  "crypto",
  "geral",
] as const;

export type Niche = (typeof ALLOWED)[number];

export async function classifyNiche(input: { adCopy: string; landingText: string }): Promise<Niche> {
  if (!env.openaiKey) return heuristicNiche(input.adCopy + " " + input.landingText);

  const client = new OpenAI({ apiKey: env.openaiKey });
  const text = `Classifique o nicho do anúncio em UMA palavra-chave da lista: fitness, renda extra, saúde, relacionamento, crypto, geral.
Use apenas um desses valores exatos (minúsculas, com acento em saúde).

COPY:
${input.adCopy.slice(0, 4000)}

TEXTO DA LANDING (trecho):
${input.landingText.slice(0, 6000)}
`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [
      { role: "system", content: "Responda somente com uma palavra da lista permitida." },
      { role: "user", content: text },
    ],
  });

  const raw = (res.choices[0]?.message?.content ?? "geral").trim().toLowerCase();
  const hit = ALLOWED.find((a) => raw.includes(a));
  return hit ?? heuristicNiche(input.adCopy + " " + input.landingText);
}

function heuristicNiche(blob: string): Niche {
  const t = blob.toLowerCase();
  if (/crypto|bitcoin|ethereum|defi|nft/.test(t)) return "crypto";
  if (/dating|tinder|relationship|love|marriage/.test(t)) return "relacionamento";
  if (/supplement|health|doctor|pain|natural|wellness|clinic/.test(t)) return "saúde";
  if (/money|income|earn|side hustle|passive|online job|cash/.test(t)) return "renda extra";
  if (/fitness|gym|muscle|weight|workout|diet|lose weight/.test(t)) return "fitness";
  return "geral";
}
