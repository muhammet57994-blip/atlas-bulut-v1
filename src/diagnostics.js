// Last errors seen by this isolate. Workers Logs is the durable sink; this ring
// exists because `wrangler tail` is unavailable on some networks and the panel
// needs a request id to look anything up. Nothing here is persisted.
const MAX = 50;
const ring = [];

export function rememberDiagnostic(entry) {
  ring.push(entry);
  if (ring.length > MAX) ring.shift();
}

export function diagnosticsSnapshot() {
  return {count: ring.length, items: ring.slice().reverse()};
}

export function resetDiagnostics() { ring.length = 0; }
