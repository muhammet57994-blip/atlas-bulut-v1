// Small, dependency-free resilience primitives for transient failures.
// State is per-isolate, which is the only scope Cloudflare Workers give us;
// a cold start resets the breakers, which is the safe default.

export function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export function isTransientNetworkError(error) {
  if (!error) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : String(error);
  return /fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(message + ' ' + code) &&
    !/abort/i.test(message + ' ' + code);
}

export async function retry(fn, { attempts = 2, baseDelay = 100, factor = 3, shouldRetry = null, shouldRetryError = isTransientNetworkError } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await fn();
      if (shouldRetry && shouldRetry(result) === true) {
        last = result;
        if (i < attempts - 1) await sleep(baseDelay * Math.pow(factor, i));
        continue;
      }
      return result;
    } catch (error) {
      last = error;
      if (i === attempts - 1 || !shouldRetryError(error)) throw error;
      await sleep(baseDelay * Math.pow(factor, i));
    }
  }
  if (last instanceof Error) throw last;
  return last;
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
      this.failures = 0;
      this.openedAt = 0;
      return false;
    }
    return true;
  }
  recordSuccess() { this.failures = 0; this.openedAt = 0; }
  recordFailure() {
    this.failures += 1;
    if (this.failures >= this.threshold && !this.openedAt) this.openedAt = Date.now();
  }
  async execute(fn) {
    if (this.isOpen) {
      const err = new Error(`circuit open: ${this.name}`);
      err.code = 'CIRCUIT_OPEN';
      err.status = 503;
      throw err;
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}

export function isTransientD1Error(error) {
  if (!error) return false;
  const text = (typeof error.message === 'string' ? error.message : String(error)) + ' ' + (typeof error.code === 'string' ? error.code : '');
  if (/no such (table|column|function)|constraint failed|syntax error|SQLITE_CONSTRAINT/iu.test(text)) return false;
  return /network|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|SQLITE_BUSY|database is locked|temporarily unavailable|fetch failed|D1_ERROR:.*(?:busy|timed out)/iu.test(text);
}

// Wraps a D1 database so prepared statements keep their shape but gain a single
// retry on transient failures and a shared circuit breaker. Non-transient errors
// (schema, constraints) propagate immediately and never trip the breaker.
export function resilientDb(db, { name = 'd1', attempts = 2, baseDelay = 50 } = {}) {
  if (!db || typeof db.prepare !== 'function') return db;
  const cb = breaker(name, { threshold: 8, resetMs: 30000 });
  const statement = (sql) => {
    let bound = [];
    const target = () => {
      const stmt = db.prepare(sql);
      return bound.length ? stmt.bind(...bound) : stmt;
    };
    const exec = (method, args) => {
      if (cb.isOpen) {
        const error = new Error(`circuit open: ${name}`);
        error.code = 'CIRCUIT_OPEN';
        throw error;
      }
      return retry(() => target()[method](...args), {attempts, baseDelay, factor: 3, shouldRetryError: isTransientD1Error})
        .then(result => { cb.recordSuccess(); return result; })
        .catch(error => { if (isTransientD1Error(error)) cb.recordFailure(); throw error; });
    };
    const proxy = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'bind') return (...args) => { bound = args; return proxy; };
        if (prop === 'sql') return sql;
        if (prop === 'run' || prop === 'first' || prop === 'all' || prop === 'raw') return (...args) => exec(prop, args);
        const value = target()[prop];
        return typeof value === 'function' ? value.bind(target()) : value;
      }
    });
    return proxy;
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql) => statement(sql);
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

// Module-level breakers shared within an isolate.
const breakers = new Map();
export function breaker(name, options) {
  if (!breakers.has(name)) breakers.set(name, new CircuitBreaker({ name, ...options }));
  return breakers.get(name);
}