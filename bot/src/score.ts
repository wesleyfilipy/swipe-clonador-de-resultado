export type AdStatus = "scaled" | "testing" | "weak";

export function daysBetween(start: Date, end = new Date()) {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

/** score = (dias_ativo * 2) + (frequencia * 3) — frequência limitada para estabilidade */
export function computeScore(daysActive: number, domainFrequency: number) {
  const freq = Math.min(40, Math.max(1, domainFrequency));
  return daysActive * 2 + freq * 3;
}

export function classifyStatus(score: number): AdStatus {
  if (score > 15) return "scaled";
  if (score >= 8) return "testing";
  return "weak";
}
