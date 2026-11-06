// Single source of truth for the Meta Graph API version used by every
// Facebook / Instagram call (OAuth dialog, token exchange, publishing,
// analytics, webhooks).
//
// Meta answers calls made to an expired version with the oldest version still
// supported, so a stale pin silently changes behaviour every few months. v19.0
// expired 2026-05-21 and v20.0 on 2026-09-24; v24.0 is supported until
// 2028-02-18. Override with META_GRAPH_API_VERSION (e.g. "v25.0") to move
// without a code change.
const DEFAULT_META_GRAPH_VERSION = 'v24.0';

function resolveMetaGraphVersion(): string {
  const raw = String(process.env.META_GRAPH_API_VERSION || '').trim();
  return /^v\d{1,3}\.\d$/.test(raw) ? raw : DEFAULT_META_GRAPH_VERSION;
}

export const META_GRAPH_VERSION = resolveMetaGraphVersion();
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
// Instagram API with Instagram Login shares Graph API versioning.
export const INSTAGRAM_GRAPH_BASE = `https://graph.instagram.com/${META_GRAPH_VERSION}`;
export const META_OAUTH_DIALOG_URL = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
