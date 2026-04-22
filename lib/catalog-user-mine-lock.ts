import type { SupabaseClient } from "@supabase/supabase-js";

/** Só POST /api/catalog-fill (evita cliques duplicados). O waitUntil do /feed não usa este lock. */
export const CATALOG_USER_MINE_LOCK_KEY = "catalog_user_fill";

function isMissingIngestLockTable(err: { message?: string; code?: string } | null): boolean {
  const m = (err?.message ?? "").toLowerCase();
  return m.includes("ingest_lock") && (m.includes("does not exist") || m.includes("schema cache"));
}

export function catalogUserMineLockParams() {
  return {
    leaseSec: Math.min(150, Math.max(40, Number(process.env.CATALOG_USER_FILL_LEASE_SEC ?? "72"))),
    okCooldownSec: Math.min(600, Math.max(20, Number(process.env.CATALOG_USER_FILL_COOLDOWN_SEC ?? "40"))),
    failCooldownSec: Math.min(120, Math.max(8, Number(process.env.CATALOG_USER_FILL_FAIL_COOLDOWN_SEC ?? "15"))),
  };
}

export async function setCatalogMineLockCooldown(admin: SupabaseClient, seconds: number): Promise<void> {
  const until = new Date(Date.now() + seconds * 1000).toISOString();
  const { error } = await admin
    .from("ingest_lock")
    .upsert({ key: CATALOG_USER_MINE_LOCK_KEY, cooldown_until: until }, { onConflict: "key" });
  if (error && !isMissingIngestLockTable(error)) {
    console.error("[catalog-user-mine-lock] upsert", error.message);
  }
}

/**
 * Um único “slot” global para mineração feed_blocking (evita waitUntil + POST ao mesmo tempo).
 */
export async function acquireCatalogMiningLease(
  admin: SupabaseClient,
  leaseSec: number
): Promise<{ acquired: true } | { acquired: false; retryAfterSec: number }> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const leaseEnd = new Date(now + leaseSec * 1000).toISOString();

  const { data: existing, error: selErr } = await admin
    .from("ingest_lock")
    .select("cooldown_until")
    .eq("key", CATALOG_USER_MINE_LOCK_KEY)
    .maybeSingle();

  if (selErr && isMissingIngestLockTable(selErr)) {
    return { acquired: true };
  }
  if (selErr) {
    throw new Error(selErr.message);
  }

  if (existing?.cooldown_until) {
    const until = new Date(existing.cooldown_until).getTime();
    if (until > now) {
      return { acquired: false, retryAfterSec: Math.ceil((until - now) / 1000) };
    }
  }

  const { data: updated, error: updErr } = await admin
    .from("ingest_lock")
    .update({ cooldown_until: leaseEnd })
    .eq("key", CATALOG_USER_MINE_LOCK_KEY)
    .lt("cooldown_until", nowIso)
    .select("key");

  if (updErr && isMissingIngestLockTable(updErr)) {
    return { acquired: true };
  }
  if (updErr) {
    throw new Error(updErr.message);
  }

  if (updated && updated.length > 0) {
    return { acquired: true };
  }

  const { error: insErr } = await admin.from("ingest_lock").insert({
    key: CATALOG_USER_MINE_LOCK_KEY,
    cooldown_until: leaseEnd,
  });

  if (!insErr) {
    return { acquired: true };
  }
  if (isMissingIngestLockTable(insErr)) {
    return { acquired: true };
  }

  const dup =
    insErr.code === "23505" ||
    insErr.message.toLowerCase().includes("duplicate") ||
    insErr.message.toLowerCase().includes("unique");

  if (dup) {
    const { data: r2 } = await admin
      .from("ingest_lock")
      .select("cooldown_until")
      .eq("key", CATALOG_USER_MINE_LOCK_KEY)
      .maybeSingle();
    const u = r2?.cooldown_until ? Math.ceil((new Date(r2.cooldown_until).getTime() - Date.now()) / 1000) : leaseSec;
    return { acquired: false, retryAfterSec: Math.max(5, u) };
  }

  throw new Error(insErr.message);
}
