// Small, dependency-free resilience primitives for transient failures.
// State is per-isolate, which is the only scope Cloudflare Workers give us;
// a cold start resets the breakers, which is the safe default.

export function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function errorText(error) {
  if (!error) return '';
  return (typeof error.message === 'string' ? error.message : String(error)) + ' ' + (typeof error.code === 'string' ? error.code : '');
}

export function isTransientNetworkError(error) {
  const text = errorText(error);
  if (!text || /abort/iu.test(text)) return false;
  return /fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network/iu.test(text);
}

export function isTransientD1Error(error) {
  const text = errorText(error);
  if (!text || /no such (table|column|function)|constraint failed|syntax error|SQLITE_CONSTRAINT/iu.test(text)) return false;
  return /network|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|SQLITE_BUSY|database is locked|temporarily unavailable|fetch failed/iu.test(text);
}

// Retries only when the error is transient. A returned value (including an HTTP
// error response) is passed straight through, so provider status handling stays
// in the caller.
export async function retry(fn, { attempts = 2, baseDelay = 100, factor = 3, shouldRetryError = isTransientNetworkError } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1 || !shouldRetryError(error)) throw error;
      await sleep(baseDelay * Math.pow(factor, i));
    }
  }
}

export class CircuitBreaker {
  constructor({ name = 'default', threshold = 5, resetMs = 30000 } = {}) {
    this.name = name;
    this.threshold = threshold;
    this.resetMs = resetMs;
    this.failures = 0;
    this.openedAt = 0;
  }
  get isOpen() {
    if (this.failures < this.threshold) return false;
    if (Date.now() - this.openedAt >= this.resetMs) {
      this.recordSuccess();
      return false;
    }
    return true;
  }
  recordSuccess() { this.failures = 0; this.openedAt = 0; }
  recordFailure() {
    this.failures += 1;
    if (this.failures >= this.threshold && !this.openedAt) this.openedAt = Date.now();
  }
}

// Wraps a D1 database so prepared statements keep their shape but gain a single
// retry on transient failures and a shared circuit breaker. Non-transient errors
// (schema, constraints) propagate immediately and never trip the breaker.
const RAW = Symbol('atlas.raw-statement');

export function resilientDb(db, { name = 'd1', attempts = 2, baseDelay = 50 } = {}) {
  if (!db || typeof db.prepare !== 'function') return db;
  const cb = breaker(name, { threshold: 8, resetMs: 30000 });
  const guarded = run => {
    if (cb.isOpen) {
      const error = new Error(`circuit open: ${name}`);
      error.code = 'CIRCUIT_OPEN';
      // Reject like D1 does; a synchronous throw would escape promise chains.
      return Promise.reject(error);
    }
    return retry(run, { attempts, baseDelay, shouldRetryError: isTransientD1Error })
      .then(result => { cb.recordSuccess(); return result; })
      .catch(error => { if (isTransientD1Error(error)) cb.recordFailure(); throw error; });
  };
  const statement = (sql, bound = []) => {
    const build = () => {
      const prepared = db.prepare(sql);
      return bound.length ? prepared.bind(...bound) : prepared;
    };
    const exec = (method, args) => guarded(() => build()[method](...args));
    return {
      bind: (...args) => statement(sql, args),
      first: (...args) => exec('first', args),
      all: (...args) => exec('all', args),
      run: (...args) => exec('run', args),
      [RAW]: build
    };
  };
  const wrapped = {prepare: sql => statement(sql)};
  // D1 batch() takes prepared statements; rebuild the real ones and retry the group.
  if (typeof db.batch === 'function') {
    wrapped.batch = statements => guarded(() => db.batch(statements.map(item => item?.[RAW] ? item[RAW]() : item)));
  }
  return wrapped;
}

// Module-level breakers shared within an isolate.
const breakers = new Map();
export function breaker(name, options) {
  if (!breakers.has(name)) breakers.set(name, new CircuitBreaker({ name, ...options }));
  return breakers.get(name);
}