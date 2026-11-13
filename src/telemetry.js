// Per-isolate counters. They reset on a cold start, which is fine for a
// free-tier signal: the point is to see quota answers and failures as they
// happen, not to keep a durable ledger.
const models = new Map();
let requests = 0, quota = 0, failures = 0, lastAt = null;

function bucket(model) {
  const key = typeof model === 'string' && model ? model : 'unknown';
  if (!models.has(key)) models.set(key, {calls: 0, quota: 0, failures: 0});
  return models.get(key);
}
function touch() { lastAt = new Date().toISOString(); }

export function noteModelCall(model) { requests += 1; bucket(model).calls += 1; touch(); }
export function noteModelQuota(model) { quota += 1; bucket(model).quota += 1; touch(); }
export function noteModelFailure(model) { failures += 1; bucket(model).failures += 1; touch(); }

export function telemetrySnapshot() {
  return {
    requests,
    quota,
    failures,
    lastAt,
    models: Object.fromEntries([...models.entries()].sort(([a], [b]) => a.localeCompare(b)))
  };
}

export function resetTelemetry() { models.clear(); requests = 0; quota = 0; failures = 0; lastAt = null; }
