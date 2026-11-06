import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// SSRF guard for every server-side fetch of a user-controlled URL (automation
// webhooks, WordPress/Make webhooks, the MCP image proxy, Autopilot scanner).
//
// Two layers of defence:
//  1. assertSafePublicUrl() — reject non-http(s) schemes and resolve the host,
//     rejecting if any resolved address is private/reserved/loopback/metadata.
//  2. A custom DNS `lookup` on the http/https agents re-validates the IP at
//     CONNECTION time (and on every redirect hop). This closes the DNS-
//     rebinding TOCTOU gap: even if the host resolves to a public IP during
//     step 1 and an internal IP microseconds later, the connection is refused.
// ─────────────────────────────────────────────────────────────────────────────

function ipv4ToLong(ip: string): number | null {
  const m = ip.split('.');
  if (m.length !== 4) return null;
  let n = 0;
  for (const part of m) {
    const o = Number(part);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}

function inV4Cidr(long: number, base: string, bits: number): boolean {
  const baseLong = ipv4ToLong(base);
  if (baseLong === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (long & mask) === (baseLong & mask);
}

function isPrivateIPv4(ip: string): boolean {
  const long = ipv4ToLong(ip);
  if (long === null) return true; // unparseable → treat as unsafe
  return (
    inV4Cidr(long, '0.0.0.0', 8) ||        // "this host"
    inV4Cidr(long, '10.0.0.0', 8) ||       // private
    inV4Cidr(long, '100.64.0.0', 10) ||    // CGNAT
    inV4Cidr(long, '127.0.0.0', 8) ||      // loopback
    inV4Cidr(long, '169.254.0.0', 16) ||   // link-local (incl. 169.254.169.254 metadata)
    inV4Cidr(long, '172.16.0.0', 12) ||    // private
    inV4Cidr(long, '192.0.0.0', 24) ||     // IETF protocol
    inV4Cidr(long, '192.168.0.0', 16) ||   // private
    inV4Cidr(long, '198.18.0.0', 15) ||    // benchmarking
    inV4Cidr(long, '224.0.0.0', 4) ||      // multicast
    inV4Cidr(long, '240.0.0.0', 4)         // reserved
  );
}

function hextetsToIpv4(hi: number, lo: number): string {
  return `${(hi >>> 8) & 0xff}.${hi & 0xff}.${(lo >>> 8) & 0xff}.${lo & 0xff}`;
}

export function expandIPv6Hextets(rawIp: string): number[] | null {
  let ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);

  // Convert trailing dotted-quad IPv4 (e.g. ::ffff:127.0.0.1) into 2 hex groups
  const v4Tail = ip.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Tail) {
    const v4Long = ipv4ToLong(v4Tail[2]);
    if (v4Long === null) return null;
    const hi = ((v4Long >>> 16) & 0xffff).toString(16);
    const lo = (v4Long & 0xffff).toString(16);
    ip = `${v4Tail[1]}${hi}:${lo}`;
  }

  const dblParts = ip.split('::');
  if (dblParts.length > 2) return null;

  const parseSide = (s: string): number[] | null => {
    if (!s) return [];
    const tokens = s.split(':');
    const nums: number[] = [];
    for (const tok of tokens) {
      if (!/^[0-9a-f]{1,4}$/.test(tok)) return null;
      nums.push(parseInt(tok, 16));
    }
    return nums;
  };

  if (dblParts.length === 2) {
    const left = parseSide(dblParts[0]);
    const right = parseSide(dblParts[1]);
    if (!left || !right || left.length + right.length >= 8) return null;
    const zeros = new Array<number>(8 - left.length - right.length).fill(0);
    return [...left, ...zeros, ...right];
  }

  const full = parseSide(ip);
  if (!full || full.length !== 8) return null;
  return full;
}

export function isPrivateAddress(addr: string): boolean {
  const ip = addr.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) {
    const h = expandIPv6Hextets(ip);
    if (!h) return true;
    const allZeroPrefix5 = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
    // ::/128 unspecified, ::1/128 loopback, or ::/96 IPv4-compatible
    if (allZeroPrefix5 && h[5] === 0) {
      if (h[6] === 0 && (h[7] === 0 || h[7] === 1)) return true;
      return isPrivateIPv4(hextetsToIpv4(h[6], h[7]));
    }
    // ::ffff:0:0/96 IPv4-mapped (covers ::ffff:127.0.0.1 and 0:0:0:0:0:ffff:7f00:1 / a9fe:a9fe)
    if (allZeroPrefix5 && h[5] === 0xffff) {
      return isPrivateIPv4(hextetsToIpv4(h[6], h[7]));
    }
    // ::ffff:0:0:0/96 IPv4-translated
    if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0xffff && h[5] === 0) {
      return isPrivateIPv4(hextetsToIpv4(h[6], h[7]));
    }
    // NAT64 well-known 64:ff9b::/96 & local-use 64:ff9b:1::/48
    if (h[0] === 0x0064 && h[1] === 0xff9b && (h[2] === 0 || h[2] === 1)) {
      return true;
    }
    // 6to4 2002::/16 — inspect embedded IPv4 in h[1..2]
    if (h[0] === 0x2002) {
      return isPrivateIPv4(hextetsToIpv4(h[1], h[2]));
    }
    // Teredo 2001:0000::/32, Benchmarking 2001:0002::/48, Documentation 2001:0db8::/32
    if (h[0] === 0x2001 && (h[1] === 0x0000 || h[1] === 0x0002 || h[1] === 0x0db8)) {
      return true;
    }
    // Discard-only 0100::/64
    if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) {
      return true;
    }
    if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return true; // not a valid IP literal → unsafe
}

// Reject at request time. Returns the parsed URL for reuse.
export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try { u = new URL(String(rawUrl).trim()); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed');
  if (u.username || u.password) throw new Error('URLs with embedded credentials are not allowed');

  const host = u.hostname.replace(/^\[|\]$/g, '');
  // Literal IP in the URL — check directly, no DNS.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('URL points to a private or reserved address');
    return u;
  }
  const lowerHost = host.toLowerCase().replace(/\.$/, '');
  if (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.localhost') ||
    lowerHost.endsWith('.internal') ||
    lowerHost === 'metadata.google.internal'
  ) {
    throw new Error('URL points to an internal or localhost hostname');
  }

  const results = await dns.promises.lookup(host, { all: true }).catch(() => {
    throw new Error('Could not resolve host');
  });
  if (!results.length) throw new Error('Host did not resolve');
  for (const r of results) {
    if (isPrivateAddress(r.address)) throw new Error('Host resolves to a private or reserved address');
  }
  return u;
}

// Connection-time DNS lookup that refuses private IPs (defeats DNS rebinding).
function guardedLookup(hostname: string, options: any, callback: any): void {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : options;
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses: any) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    for (const a of list) {
      if (isPrivateAddress(a.address)) return cb(new Error(`Blocked connection to private address ${a.address}`));
    }
    const first = list[0];
    if (opts && opts.all) return cb(null, list);
    return cb(null, first.address, first.family);
  });
}

const guardedHttpAgent = new http.Agent({ lookup: guardedLookup as any });
const guardedHttpsAgent = new https.Agent({ lookup: guardedLookup as any });

// Drop-in axios request that is validated up front AND pinned to safe IPs at
// connection/redirect time. Caps redirects and body size.
export async function safeAxios<T = unknown>(config: AxiosRequestConfig & { url: string }): Promise<AxiosResponse<T>> {
  await assertSafePublicUrl(config.url);
  return axios.request<T>({
    ...config,
    beforeRedirect: (options) => {
      const proto = String((options as any).protocol || 'https:');
      if (proto !== 'http:' && proto !== 'https:') {
        throw new Error('Redirect to unsupported protocol is blocked');
      }
      const host = String(options.hostname || '').replace(/^\[|\]$/g, '');
      const lower = host.toLowerCase().replace(/\.$/, '');
      if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.internal')) {
        throw new Error('Redirect to internal hostname is blocked');
      }
      if (net.isIP(host) && isPrivateAddress(host)) throw new Error('Redirect to a private address is blocked');
      if (options.auth) throw new Error('Redirect with embedded credentials is blocked');
    },
    httpAgent: guardedHttpAgent,
    httpsAgent: guardedHttpsAgent,
    maxRedirects: config.maxRedirects ?? 2,
    maxContentLength: config.maxContentLength ?? 25 * 1024 * 1024,
    maxBodyLength: config.maxBodyLength ?? 25 * 1024 * 1024,
    timeout: config.timeout ?? 15_000,
  });
}

// The app's own public origins, whose /media URLs publishing re-fetches. They
// are trusted so local development (localhost) can publish media too.
function ownOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const raw of [process.env.BACKEND_PUBLIC_URL, process.env.PUBLIC_API_URL, process.env.API_PUBLIC_URL, process.env.VITE_APP_URL]) {
    try { if (raw) origins.add(new URL(raw).origin); } catch { /* not a URL */ }
  }
  return origins;
}

// Downloads media for re-upload to a social platform. The URL comes from user
// content (a post's featured image), so it gets the same SSRF protection as
// any user-supplied fetch, plus a size cap; data: URLs are decoded locally.
export async function fetchMediaBytes(
  url: string,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<{ buffer: Buffer; mimeType: string }> {
  const maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
  const raw = String(url || '').trim();
  const dataUrl = raw.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/s);
  if (dataUrl) {
    const buffer = Buffer.from(dataUrl[2], 'base64');
    if (buffer.length > maxBytes) throw new Error('Media exceeds the size limit');
    return { buffer, mimeType: dataUrl[1].toLowerCase() };
  }
  let origin = '';
  try { origin = new URL(raw).origin; } catch { throw new Error('Invalid media URL'); }
  const request: AxiosRequestConfig & { url: string } = {
    url: raw,
    method: 'GET',
    responseType: 'arraybuffer',
    timeout: options.timeoutMs ?? 120_000,
    maxContentLength: maxBytes,
    validateStatus: () => true,
  };
  const resp = ownOrigins().has(origin)
    ? await axios.request<ArrayBuffer>({ ...request, maxRedirects: 2 })
    : await safeAxios<ArrayBuffer>(request);
  if (resp.status >= 400) throw new Error(`Media download failed (HTTP ${resp.status})`);
  const mimeType = String(resp.headers['content-type'] || '').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  return { buffer: Buffer.from(resp.data), mimeType };
}
