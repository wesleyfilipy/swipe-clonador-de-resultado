export type SpyNiche =
  | "fitness"
  | "beauty"
  | "crypto"
  | "make money"
  | "ecommerce"
  | "supplement"
  | "other";

/**
 * Regras de produto: classifica a partir do texto (não de keyword de busca).
 */
export function classifyNicheFromAdText(text: string): SpyNiche {
  const t = text.toLowerCase();
  if (/\b(fitness|gym|workout|muscle|diet|weight|protein|yoga|cardio)\b/.test(t)) return "fitness";
  if (/\b(crypto|bitcoin|ethereum|defi|nft|blockchain|trading|token)\b/.test(t)) return "crypto";
  if (/\b(beauty|skincare|makeup|cosmetic|serum|make up|glow|lash)\b/.test(t)) return "beauty";
  if (/\b(supplement|supplements|vitamin|collagen|omega|magnesium|probiotic|capsule)\b/.test(t)) {
    return "supplement";
  }
  if (/\b(ecommerce|e-commerce|dropship|shopify|amazon fba|online store|sell online|retail|dropshipping)\b/.test(
    t
  )) {
    return "ecommerce";
  }
  if (/\b(make money|earn money|passive income|side hustle|money online|financial freedom|income|profit)\b/.test(
    t
  )) {
    return "make money";
  }
  return "other";
}
