// A text-model call spends the owner's free quota. One settings row per Istanbul
// day caps it, so a shared link or a retry loop cannot burn the whole day before
// the owner notices.
const DEFAULT_CAP = 300, MIN_CAP = 20, MAX_CAP = 5000;
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function parts(now) {
  const out = {};
  for (const part of formatter.formatToParts(now)) out[part.type] = part.value;
  return out;
}

export function dayKey(now = new Date()) {
  const p = parts(now);
  return `model_calls_${p.year}-${p.month}-${p.day}`;
}

export function dailyCap(env) {
  const raw = Number(env?.DAILY_MODEL_LIMIT);
  return Number.isInteger(raw) && raw >= MIN_CAP && raw <= MAX_CAP ? raw : DEFAULT_CAP;
}

export function secondsUntilMidnight(now = new Date()) {
  const p = parts(now);
  const elapsed = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
  return Math.max(1, 86400 - elapsed);
}

export async function dailyUsage(env, now = new Date()) {
  const day = dayKey(now), cap = dailyCap(env);
  if (!env?.MEMORY_DB) return {used: 0, cap, day};
  try {
    const row = await env.MEMORY_DB.prepare('SELECT value FROM atlas_settings WHERE key=?').bind(day).first();
    return {used: Math.max(0, Number(row?.value) || 0), cap, day};
  } catch {
    return {used: 0, cap, day};
  }
}

// Atomic: the counter only increments while it is below the cap, so concurrent
// requests cannot overshoot it. A missing settings table never blocks chat.
export async function consumeModelCall(env, now = new Date()) {
  const day = dayKey(now), cap = dailyCap(env);
  if (!env?.MEMORY_DB) return {ok: true, used: null, cap, day, retryAfter: null};
  try {
    const result = await env.MEMORY_DB.prepare(
      "INSERT INTO atlas_settings(key,value,updated_at) VALUES(?, '1', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT), updated_at=excluded.updated_at " +
      'WHERE CAST(value AS INTEGER) < ?'
    ).bind(day, now.toISOString(), cap).run();
    if (result?.meta?.changes) return {ok: true, used: null, cap, day, retryAfter: null};
    const row = await env.MEMORY_DB.prepare('SELECT value FROM atlas_settings WHERE key=?').bind(day).first();
    return {ok: false, used: Number(row?.value) || cap, cap, day, retryAfter: secondsUntilMidnight(now)};
  } catch {
    return {ok: true, used: null, cap, day, retryAfter: null};
  }
}
