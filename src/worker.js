// Cloudflare Worker for Studio Web.
//
// The editor is a static, client-side app in ../public, served by Workers
// Static Assets. This Worker runs in front of the assets to:
//  * stamp the service worker with the deployment's version id, so every
//    deploy gets a fresh offline cache;
//  * add security and caching headers;
//  * answer /healthz.
// Images never reach the Worker: all editing happens in the browser.

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

function withHeaders(res, path) {
  const h = new Headers(res.headers);
  h.set('Content-Security-Policy', CSP);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), clipboard-read=(self), clipboard-write=(self)');
  // File names are not hashed, so let browsers revalidate (cheap 304s via ETag).
  if (!h.has('Cache-Control') || path === '/' || path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css')) {
    h.set('Cache-Control', 'public, max-age=0, must-revalidate');
  }
  if (path.endsWith('.webmanifest')) h.set('Content-Type', 'application/manifest+json');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }

    if (url.pathname === '/sw.js') {
      const res = await env.ASSETS.fetch(new Request(new URL('/sw.js', url), request));
      if (!res.ok) return res;
      const version = env.CF_VERSION_METADATA?.id || 'dev';
      const body = (await res.text()).replaceAll('__BUILD__', version);
      return withHeaders(new Response(body, {
        headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' },
      }), url.pathname);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    return withHeaders(await env.ASSETS.fetch(request), url.pathname);
  },
};
