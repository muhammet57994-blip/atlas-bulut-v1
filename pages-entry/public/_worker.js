// Preserve the original origin, authentication cookie and response security headers.
// The binding calls ATLAS inside Cloudflare, without visiting workers.dev.
export default {
  async fetch(request, env) {
    try {
      if (!env.ATLAS) throw new Error('Missing binding');
      return await env.ATLAS.fetch(request);
    } catch {
      return new Response('ATLAS bağlantısı şu anda hazır değil. Lütfen daha sonra deneyin.', {
        status: 503,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
        }
      });
    }
  }
};
