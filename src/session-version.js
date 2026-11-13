// The epoch is read at most once a minute per isolate. Without a database (or on
// an older schema) it stays 0, which keeps local tests and pre-migration deploys
// working exactly as before.
const CACHE_MS = 60000;
let cache = {key: '', value: 0, at: 0};

export async function sessionEpoch(env, now = Date.now()) {
  if (!env?.MEMORY_DB) return 0;
  const key = typeof env.ATLAS_ACCESS_PASSWORD === 'string' ? env.ATLAS_ACCESS_PASSWORD : '';
  if (cache.key === key && now - cache.at < CACHE_MS) return cache.value;
  try {
    const row = await env.MEMORY_DB.prepare("SELECT value FROM atlas_settings WHERE key='session_epoch'").first();
    const value = Number(row?.value) || 0;
    cache = {key, value, at: now};
    return value;
  } catch {
    // Missing table on an old schema is not an error: nothing has been revoked.
    return 0;
  }
}

export async function bumpSessionEpoch(env, now = Date.now()) {
  if (!env?.MEMORY_DB) throw new Error('session store unavailable');
  // Strictly increase, so a bump inside the same millisecond as a login still
  // invalidates the cookie that was just minted.
  const value = Math.max(now, (await sessionEpoch(env, now)) + 1);
  await env.MEMORY_DB
    .prepare("INSERT INTO atlas_settings(key,value,updated_at) VALUES('session_epoch',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .bind(String(value), new Date(now).toISOString())
    .run();
  cache = {key: typeof env.ATLAS_ACCESS_PASSWORD === 'string' ? env.ATLAS_ACCESS_PASSWORD : '', value, at: now};
  return value;
}

export function resetSessionEpochCache() { cache = {key: '', value: 0, at: 0}; }
