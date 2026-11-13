// Every id here is on Google's free tier, so a spent quota can move to the next
// one without billing. Cheapest first; an approved configured model stays first.
export const FREE_MODELS = Object.freeze([
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.8-flash'
]);
export const DEFAULT_MODEL = FREE_MODELS[0];

export function approvedModel(value) {
  return typeof value === 'string' && FREE_MODELS.includes(value.trim());
}

// An explicit but unapproved model still fails closed; only an absent value uses
// the default. The result is the ordered list of free models to try.
export function modelChain(env) {
  const configured = typeof env?.GEMINI_MODEL === 'string' ? env.GEMINI_MODEL.trim() : '';
  if (configured && !approvedModel(configured)) return [];
  const first = configured || DEFAULT_MODEL;
  return [first, ...FREE_MODELS.filter(model => model !== first)];
}

export function modelUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// Only a quota reply (429) moves to the next free model. A bad key, a refused
// request or a server error stops at the first attempt, so nothing is multiplied
// across models and no paid model is ever reached.
export async function modelRequest(env, payload, {upstream = fetch, signal} = {}) {
  const chain = modelChain(env);
  if (!chain.length) return {model: '', response: null, quotaExhausted: false};
  let last;
  for (const model of chain) {
    const response = await upstream(modelUrl(model), {
      method: 'POST',
      redirect: 'manual',
      signal,
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY},
      body: JSON.stringify(payload)
    });
    if (response.status !== 429) return {model, response, quotaExhausted: false};
    last = {model, response, quotaExhausted: true};
  }
  return last;
}
