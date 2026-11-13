// Post-deploy smoke test. It talks to the live deployment only through
// anonymous endpoints, so it needs no secrets and can run from CI or locally
// right after `wrangler deploy`. Any failed check exits non-zero.
const base = (process.argv[2] || process.env.SMOKE_BASE_URL || 'https://atlas-pasam-v1.pages.dev').replace(/\/+$/u, '');
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const results = [];

function expect(condition, message) { if (!condition) throw new Error(message); }
async function check(name, run) {
  try {
    const detail = await run();
    results.push({ok: true, name});
    console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
  } catch (error) {
    results.push({ok: false, name});
    console.error('FAIL ' + name + ' — ' + (error?.message || String(error)));
  }
}
function request(path, init = {}) {
  return fetch(base + path, {...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs)});
}
async function json(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error('yanıt JSON değil: ' + text.slice(0, 120)); }
}

console.log('Duman testi: ' + base + '\n');

await check('/api/health sağlıklı', async () => {
  const response = await request('/api/health');
  const id = response.headers.get('X-ATLAS-Request-Id');
  expect(UUID.test(id || ''), 'X-ATLAS-Request-Id başlığı yok veya UUID değil');
  const body = await json(response);
  expect(response.status === 200, 'durum ' + response.status + ' (beklenen 200)');
  expect(body.service === 'atlas', 'service alanı atlas değil');
  expect(body.ok === true, 'ok false: ' + JSON.stringify({ready: body.ready, model: body.model, db: body.db, schema: body.schema?.upToDate}));
  expect(body.ready === true, 'yapılandırma hazır değil');
  expect(body.model?.configured === true && body.model?.approved === true, 'model yapılandırılmamış veya onaysız');
  expect(body.db?.reachable === true, 'veritabanına ulaşılamıyor');
  expect(body.schema?.upToDate === true, 'şema güncel değil (applied ' + body.schema?.appliedVersion + ', beklenen ' + body.schema?.expectedVersion + ')');
  return 'şema ' + body.schema.appliedVersion + ', db ' + body.db.latencyMs + 'ms';
});

await check('ana sayfa HTML ve güvenlik başlıklarıyla dönüyor', async () => {
  const response = await request('/');
  expect(response.status === 200, 'durum ' + response.status + ' (beklenen 200)');
  expect((response.headers.get('Content-Type') || '').includes('text/html'), 'Content-Type HTML değil');
  const csp = response.headers.get('Content-Security-Policy') || '';
  expect(csp.includes("default-src 'self'"), 'CSP eksik');
  expect((response.headers.get('Cache-Control') || '').includes('no-store'), 'no-store eksik');
  await response.text();
  return 'CSP ve no-store doğru';
});

await check('/api/session oturumsuz yanıtı', async () => {
  const response = await request('/api/session');
  expect(response.status === 200, 'durum ' + response.status + ' (beklenen 200)');
  const body = await json(response);
  expect(body.authenticated === false, 'oturum açık görünüyor');
  expect(body.ready === true, 'ready false');
  return 'authenticated:false, ready:true';
});

await check('kimlik doğrulaması olmayan POST isteği 401', async () => {
  const response = await request('/api/organize', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'}, body: '{}'});
  expect(response.status === 401, 'durum ' + response.status + ' (beklenen 401)');
  await response.text();
  return 'auth kapısı çalışıyor';
});

await check('yabancı Origin 403 ile reddediliyor', async () => {
  const response = await request('/api/organize', {method: 'POST', headers: {Origin: 'https://evil.example', 'Content-Type': 'application/json'}, body: '{}'});
  expect(response.status === 403, 'durum ' + response.status + ' (beklenen 403)');
  const id = response.headers.get('X-ATLAS-Request-Id');
  expect(UUID.test(id || ''), 'reddedilen yanıtta istek kimliği yok');
  await response.text();
  return 'same-origin kapısı çalışıyor';
});

await check('oturumsuz okuma ucu 401', async () => {
  const response = await request('/api/everyday', {headers: {Origin: base}});
  expect(response.status === 401, 'durum ' + response.status + ' (beklenen 401)');
  await response.text();
  return 'okuma kapısı çalışıyor';
});

await check('bilinmeyen dosya 404 (SPA fallback yok)', async () => {
  const response = await request('/bilinmeyen-dosya.js');
  expect(response.status === 404, 'durum ' + response.status + ' (beklenen 404)');
  await response.text();
  return '404';
});

const failed = results.filter(result => !result.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' kontrol geçti');
if (failed.length) {
  console.error('Başarısız: ' + failed.map(result => result.name).join(', '));
  process.exit(1);
}