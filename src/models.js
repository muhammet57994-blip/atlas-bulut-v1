import {retry, isTransientNetworkError, breaker} from './resilience.js';
import {noteModelCall, noteModelQuota, noteModelFailure} from './telemetry.js';
import {checkModelBudget, recordModelCall} from './request-budget.js';

export const BUDGET_MESSAGE = 'Efendim, bugünkü ücretsiz model sınırına ulaştık. Gece yarısı sıfırlanır; kayıtlar, notlar ve yerel komutlar çalışmaya devam eder.';

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
// across models and no paid model is ever reached. Transient network errors are
// retried once with backoff before giving up, and a tripped circuit breaker
// fails fast instead of hammering an unreachable provider.
export async function modelRequest(env, payload, {upstream = fetch, signal} = {}) {
  const chain = modelChain(env);
  if (!chain.length) return {model: '', response: null, quotaExhausted: false, circuitOpen: false};
  const cb = breaker('gemini', {threshold: 5, resetMs: 30000});
  if (cb.isOpen) return {model: '', response: null, quotaExhausted: false, circuitOpen: true};
  // One gate for every model-calling route: chat, research, planning, Instagram
  // analysis and the visual assistant all pass through here.
  // No database means no budget to enforce, and skipping the await keeps the
  // provider call synchronous for callers that rely on that ordering.
  const budget = env?.MEMORY_DB ? await checkModelBudget(env) : {allowed: true, retryAfter: null, cap: null};
  if (!budget.allowed) {
    const response = new Response(JSON.stringify({error: BUDGET_MESSAGE}), {
      status: 429,
      headers: {'Content-Type': 'application/json; charset=utf-8', 'Retry-After': String(budget.retryAfter)}
    });
    return {model: '', response, quotaExhausted: false, circuitOpen: false, budgetExhausted: true, retryAfter: budget.retryAfter, cap: budget.cap};
  }
  try {
    let last, lastModel = '';
    for (const model of chain) {
      lastModel = model;
      noteModelCall(model);
      const response = await retry(
        () => upstream(modelUrl(model), {
          method: 'POST',
          redirect: 'manual',
          signal,
          headers: {'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY},
          body: JSON.stringify(payload)
        }),
        {attempts: 2, baseDelay: 100}
      );
      if (response.status !== 429) {
        if (!response.ok) noteModelFailure(model);
        // Only a completed call spends the day's allowance.
        else await recordModelCall(env);
        cb.recordSuccess();
        return {model, response, quotaExhausted: false, circuitOpen: false};
      }
      noteModelQuota(model);
      last = {model, response, quotaExhausted: true, circuitOpen: false};
    }
    cb.recordSuccess();
    return last;
  } catch (error) {
    // A timeout or a refused request is not an outage; only transient network
    // failures count towards opening the breaker.
    if (isTransientNetworkError(error)) { cb.recordFailure(); noteModelFailure(lastModel); }
    throw error;
  }
}
