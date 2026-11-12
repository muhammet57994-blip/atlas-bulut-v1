const STYLES = new Set(['brief', 'balanced', 'detailed']);
const FOCUSES = new Set(['general', 'creator', 'technical']);

export function normalizePreferences(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...(STYLES.has(input.responseStyle) ? {responseStyle: input.responseStyle} : {}),
    focus: FOCUSES.has(input.focus) ? input.focus : 'general'
  };
}

export function responseProfile(value, latest = '') {
  const prefs = normalizePreferences(value);
  const text = typeof latest === 'string' ? latest.toLocaleLowerCase('tr-TR') : '';
  const wantsDetail = /detay|ayrınt|ayrint|adım\s*adım|adim\s*adim|step[ -]by[ -]step|in detail|detailed/.test(text);
  const style = wantsDetail ? 'detailed' : prefs.responseStyle;
  const instruction = [
    'Kullanıcıya Efendim diye hitap et; hitabı her cümlede tekrarlama.',
    style === 'detailed'
      ? 'İstenen açıklamayı yeterli ayrıntı ve gerektiğinde örneklerle tamamla; gereksiz tekrar yapma.'
      : style === 'balanced'
        ? 'Doğrudan yanıt ver ve anlaşılması için gereken kısa açıklamayı ekle; gereksiz ayrıntıdan kaçın.'
        : 'Genellikle doğal 1–3 kısa cümleyle doğrudan yanıt ver; önemli bilgiyi kısalık uğruna atlama.',
    prefs.focus === 'creator'
      ? 'İçerik üretimiyle ilgili yanıtlarda hedef kitle, ana fikir ve uygulanabilir taslakları anlaşılır biçimde öne çıkar.'
      : prefs.focus === 'technical'
        ? 'Teknik konularda sade dil kullan; gerekli terimleri açıkla ve uygulanabilir adımları netleştir.'
        : 'Gündelik, anlaşılır Türkçe kullan.'
  ].join(' ');
  return {instruction, maxOutputTokens: style === 'detailed' ? 2048 : style === 'brief' ? 768 : 1024};
}

// Retain only the digest in the gate: never keep credentials or raw prompts as keys.
export async function requestFingerprint(env, messages, memory, prefs) {
  const input = JSON.stringify([
    env.SESSION_SECRET, env.ATLAS_ACCESS_PASSWORD, env.GEMINI_API_KEY, env.GEMINI_MODEL,
    messages, memory, normalizePreferences(prefs)
  ]);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

// This is isolate-local concurrent request coalescing, not a response cache.
// Work must return a reusable result object/string, never a consumed Response body.
export function createRequestGate({now = Date.now} = {}) {
  const pending = new Map();
  return {
    get size() { return pending.size; },
    run(key, work) {
      if (pending.has(key)) return pending.get(key).promise;
      if (pending.size >= 16) {
        const error = new Error('Efendim, şu anda çok sayıda istek işleniyor. Biraz sonra tekrar deneyin.');
        error.code = 'ATLAS_BUSY';
        return Promise.reject(error);
      }
      const entry = {startedAt: now()};
      entry.promise = Promise.resolve().then(work).finally(() => pending.delete(key));
      pending.set(key, entry);
      return entry.promise;
    }
  };
}

// A retry suggestion, not a claim about the provider's daily or per-minute quota.
export function quotaHint(headers) {
  const raw = headers?.get?.('Retry-After');
  const seconds = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return {retryRecommendation: Number.isFinite(seconds) ? Math.max(1, Math.min(3600, seconds)) : 60};
}
