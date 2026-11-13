// TTL sweeper. Free-tier D1 has no scheduled vacuum and the history tables are
// capped, but a full cap turns into hard mutation failures ("history full"), so
// expired one-time state and old receipts are removed on a schedule instead.
const DAY_MS = 86400000;

export const RETENTION = Object.freeze({
  oauthGraceMs: 3600000,
  receiptsMs: 30 * DAY_MS,
  historyMs: 90 * DAY_MS,
  snapshotsMs: 180 * DAY_MS,
  replanReceiptsMs: 180 * DAY_MS
});

const RETENTION_JOBS = [
  ['oauthState', 'DELETE FROM atlas_instagram_oauth WHERE expires_at < ?'],
  ['offlineReceipts', 'DELETE FROM atlas_offline_receipts WHERE created_at < ?'],
  ['multiReceipts', 'DELETE FROM atlas_multi_receipts WHERE created_at < ?'],
  ['budgetOperations', 'DELETE FROM atlas_budget_operations WHERE created_at < ?'],
  ['billOperations', 'DELETE FROM atlas_bill_operations WHERE created_at < ?'],
  ['waitingOperations', 'DELETE FROM atlas_waiting_operations WHERE created_at < ?'],
  // A row still referenced as the undo target is kept, so the self-reference
  // never breaks the delete.
  ['recordHistory', 'DELETE FROM atlas_record_changes WHERE created_at < ? AND id NOT IN (SELECT undo_of FROM atlas_record_changes WHERE undo_of IS NOT NULL)'],
  ['listHistory', 'DELETE FROM atlas_list_changes WHERE created_at < ? AND id NOT IN (SELECT undo_of FROM atlas_list_changes WHERE undo_of IS NOT NULL)'],
  ['snapshots', 'DELETE FROM atlas_instagram_snapshots WHERE captured_at < ?'],
  ['replanReceipts', 'DELETE FROM atlas_replan_receipts WHERE created_at < ?']
];

function cutoff(now, ageMs) {
  return new Date(now.getTime() - ageMs).toISOString();
}

export async function sweepExpired(env, now = new Date()) {
  if (!env?.MEMORY_DB || !Number.isFinite(now.getTime())) return {deleted: {}, skipped: ['MEMORY_DB']};
  const values = {
    oauthState: Math.floor((now.getTime() - RETENTION.oauthGraceMs) / 1000),
    offlineReceipts: cutoff(now, RETENTION.receiptsMs),
    multiReceipts: cutoff(now, RETENTION.receiptsMs),
    budgetOperations: cutoff(now, RETENTION.receiptsMs),
    billOperations: cutoff(now, RETENTION.receiptsMs),
    waitingOperations: cutoff(now, RETENTION.receiptsMs),
    recordHistory: cutoff(now, RETENTION.historyMs),
    listHistory: cutoff(now, RETENTION.historyMs),
    snapshots: cutoff(now, RETENTION.snapshotsMs),
    replanReceipts: cutoff(now, RETENTION.replanReceiptsMs)
  };
  const deleted = {}, skipped = [];
  for (const [name, sql] of RETENTION_JOBS) {
    try {
      const result = await env.MEMORY_DB.prepare(sql).bind(values[name]).run();
      deleted[name] = Number(result?.meta?.changes ?? 0);
    } catch {
      // A missing table or a still-immutable row must never break the sweep.
      skipped.push(name);
    }
  }
  return {deleted, skipped};
}

// Opportunistic sweep for the paths that already touch D1, so cleanup still
// happens on deployments where the cron trigger is not configured.
let lastSweep = 0;
export async function maybeSweep(env, now = new Date(), intervalMs = 6 * 3600000) {
  if (Date.now() - lastSweep < intervalMs) return null;
  lastSweep = Date.now();
  return sweepExpired(env, now);
}

export function resetSweepThrottle() { lastSweep = 0; }
