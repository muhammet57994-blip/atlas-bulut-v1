// A text-model call spends the owner's free quota. One settings row per Istanbul
// day caps it, so a shared link or a retry loop cannot burn the whole day before
// the owner notices.
//
// The counter is written only after the provider returns a successful (non-429)
// response: a refused request, a 5xx, a timeout or a full quota chain costs
// nothing. The gate is a read, so two requests that start together can both pass
// it; the overshoot is bounded by the number of in-flight calls (a handful), which
// is the price of never charging for a call that did not complete.
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

// Read-only gate. A missing settings table never blocks chat.
export async function checkModelBudget(env, now = new Date()) {
  const {used, cap, day} = await dailyUsage(env, now);
  if (used < cap) return {allowed: true, used, cap, day, retryAfter: null};
  return {allowed: false, used, cap, day, retryAfter: secondsUntilMidnight(now)};
}

// Called once a model response has actually arrived with a success status.
export async function recordModelCall(env, now = new Date()) {
  if (!env?.MEMORY_DB) return false;
  const day = dayKey(now);
  try {
    await env.MEMORY_DB.prepare(
      "INSERT INTO atlas_settings(key,value,updated_at) VALUES(?, '1', ?) " +
      'ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT), updated_at=excluded.updated_at'
    ).bind(day, now.toISOString()).run();
    return true;
  } catch {
    return false;
  }
}
