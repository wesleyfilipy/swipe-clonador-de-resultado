export const SPY_DEFAULT_COUNTRIES = ["US", "BR", "CA", "UK"] as const;
export const SPY_DEFAULT_KEYWORDS = [
  "fitness",
  "beauty",
  "crypto",
  "make money",
  "ecommerce",
  "supplement",
] as const;

export function getSpyCountries(): string[] {
  const raw = process.env.SPY_COUNTRIES?.trim();
  if (raw) {
    return raw
      .split(/[\s,]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
  }
  return [...SPY_DEFAULT_COUNTRIES];
}

export function getSpyKeywords(): string[] {
  const raw = process.env.SPY_KEYWORDS?.trim();
  if (raw) {
    return raw
      .split(/[\s,]+/)
      .map((k) => k.trim())
      .filter(Boolean);
  }
  return [...SPY_DEFAULT_KEYWORDS];
}

/** ~1000–2000 anúncios coletados por país na run (total do Apify, distribuído entre keywords). */
export function getSpyAdsPerCountry(): number {
  const n = Number(process.env.SPY_ADS_PER_COUNTRY ?? "1500");
  if (!Number.isFinite(n)) return 1500;
  return Math.min(2000, Math.max(500, Math.floor(n)));
}

export function getSpyMinIntervalHours(): number {
  const n = Number(process.env.SPY_MIN_INTERVAL_HOURS ?? "168");
  if (!Number.isFinite(n) || n < 1) return 168;
  return n;
}

export function getSpyVslMaxEnrichments(): number {
  const n = Number(process.env.SPY_VSL_MAX_ENRICH ?? "250");
  if (!Number.isFinite(n) || n < 0) return 250;
  return Math.min(2_000, n);
}
