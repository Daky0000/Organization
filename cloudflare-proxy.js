/**
 * Cloudflare Worker — Magnific / Freepik API Proxy
 *
 * Routes:
 *   /magnific/* → https://api.magnific.com/*
 *   /freepik/*  → https://api.freepik.com/*
 *
 * Deploy to Cloudflare Workers (free tier), then set:
 *   - MAGNIFIC_PROXY_URL = https://<your-worker>.workers.dev  (in Railway)
 *   - PROXY_SECRET       = <random string>  (in both Worker env vars AND Railway)
 *
 * Cloudflare IPs are not in Akamai's cloud-hosting blocklist,
 * so this bypasses the 403 block Railway receives directly.
 */

export default {
  async fetch(request, env) {
    // Optional shared secret — prevents public abuse of the proxy
    if (env.PROXY_SECRET) {
      const secret = request.headers.get('X-Proxy-Secret');
      if (secret !== env.PROXY_SECRET) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const url = new URL(request.url);
    const path = url.pathname;

    let targetBase;
    let targetPath;

    if (path.startsWith('/magnific')) {
      targetBase = 'https://api.magnific.com';
      targetPath = path.slice('/magnific'.length) || '/';
    } else if (path.startsWith('/freepik')) {
      targetBase = 'https://api.freepik.com';
      targetPath = path.slice('/freepik'.length) || '/';
    } else {
      return new Response(JSON.stringify({ error: 'Unknown route — use /magnific/* or /freepik/*' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const targetUrl = `${targetBase}${targetPath}${url.search}`;

    // Forward headers, strip proxy-internal and Cloudflare-injected ones
    const headers = new Headers(request.headers);
    for (const h of ['X-Proxy-Secret', 'host', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-ipcountry', 'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip']) {
      headers.delete(h);
    }

    try {
      const upstream = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
      });

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
