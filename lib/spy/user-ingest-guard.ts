/**
 * Com `SPY_BLOCK_USER_AD_INGEST=1`, o catálogo só cresce via job semanal (nunca via request do usuário).
 */
export function isUserAdIngestBlocked(): boolean {
  return process.env.SPY_BLOCK_USER_AD_INGEST === "1" || process.env.SPY_CATALOG_USER_MINING === "0";
}
