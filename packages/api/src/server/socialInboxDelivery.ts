import axios from 'axios';
import { INSTAGRAM_GRAPH_BASE, META_GRAPH_BASE } from '../meta-graph.ts';
import { isInstagramDirectLogin } from '../platform-helpers.ts';

// Sends a Social Inbox reply back through the platform the conversation came
// from: Messenger / Instagram direct messages and Facebook / Instagram comment
// replies. Threads are created by the Meta webhook (webhookRoutes.ts), which
// records the receiving Page / Instagram account as external_account_id and
// the sender (DMs) or comment (comments) as external_thread_id.

export type ReplyThread = {
  platform: string;
  channel_type: string;
  external_thread_id: string | null;
  external_account_id: string | null;
};

// The token that may act for the receiving account, and which API it speaks.
export type ReplyCredentials = {
  accessToken: string;
  // Instagram API with Instagram Login (graph.instagram.com) vs. Facebook Login.
  instagramDirect: boolean;
  // The Facebook Page behind an Instagram account connected through Facebook.
  pageId?: string | null;
  // The Instagram professional account id (Instagram rows).
  instagramAccountId?: string | null;
};

export type ReconnectHint = { platform: 'facebook' | 'instagram'; method?: 'instagram' | 'facebook'; extraScopes: string[] };

export type DeliveryOutcome =
  | { ok: true; externalMessageId: string | null }
  | { ok: false; status: number; error: string; reconnect?: ReconnectHint };

type ReplyRequest = { url: string; body: Record<string, unknown>; permission: string };

const OUTSIDE_WINDOW_SUBCODES = new Set([2018278, 2534022]);

// Why a thread can't be answered from the inbox, or null when it can.
export function checkInboxReplyable(thread: ReplyThread): { status: number; error: string } | null {
  const platform = String(thread.platform || '').toLowerCase();
  const channel = String(thread.channel_type || '').toLowerCase();
  if (platform !== 'facebook' && platform !== 'instagram') {
    return { status: 422, error: 'Replying from the inbox is available for Facebook and Instagram conversations.' };
  }
  if (channel === 'mention') {
    return { status: 422, error: `Replies to mentions are not supported yet. Open the post on ${platform === 'facebook' ? 'Facebook' : 'Instagram'} to respond.` };
  }
  if (!String(thread.external_thread_id || '').trim()) {
    return { status: 422, error: 'This conversation has no platform reference to reply to.' };
  }
  return null;
}

// Which Graph call answers this thread, or why it can't be answered here.
export function planInboxReply(
  thread: ReplyThread,
  creds: ReplyCredentials,
  text: string,
): ReplyRequest | { status: number; error: string } {
  const blocked = checkInboxReplyable(thread);
  if (blocked) return blocked;
  const platform = String(thread.platform || '').toLowerCase();
  const channel = String(thread.channel_type || '').toLowerCase();
  const target = String(thread.external_thread_id || '').trim();
  const encodedTarget = encodeURIComponent(target);
  if (platform === 'facebook') {
    if (channel === 'dm') {
      const pageId = String(thread.external_account_id || creds.pageId || '').trim();
      if (!pageId) return { status: 409, error: 'Could not tell which Facebook Page received this conversation.' };
      return {
        url: `${META_GRAPH_BASE}/${encodeURIComponent(pageId)}/messages`,
        body: { recipient: { id: target }, messaging_type: 'RESPONSE', message: { text } },
        permission: 'pages_messaging',
      };
    }
    return { url: `${META_GRAPH_BASE}/${encodedTarget}/comments`, body: { message: text }, permission: 'pages_manage_engagement' };
  }

  // Instagram
  const graphBase = creds.instagramDirect ? INSTAGRAM_GRAPH_BASE : META_GRAPH_BASE;
  if (channel === 'dm') {
    // Instagram Login sends as the Instagram account; Facebook Login sends
    // through the Page the account is linked to.
    const senderId = String((creds.instagramDirect ? creds.instagramAccountId || thread.external_account_id : creds.pageId) || '').trim();
    if (!senderId) return { status: 409, error: 'Could not tell which account received this conversation. Reconnect Instagram.' };
    return {
      url: `${graphBase}/${encodeURIComponent(senderId)}/messages`,
      body: { recipient: { id: target }, message: { text } },
      permission: creds.instagramDirect ? 'instagram_business_manage_messages' : 'instagram_manage_messages',
    };
  }
  return {
    url: `${graphBase}/${encodedTarget}/replies`,
    body: { message: text },
    permission: creds.instagramDirect ? 'instagram_business_manage_comments' : 'instagram_manage_comments',
  };
}

// Turns a Graph API error into something the user can act on.
export function describeReplyFailure(
  platform: 'facebook' | 'instagram',
  status: number,
  data: any,
  permission: string,
  instagramDirect: boolean,
): { ok: false; status: number; error: string; reconnect?: ReconnectHint } {
  const err = data?.error || {};
  const code = Number(err.code);
  const subcode = Number(err.error_subcode);
  const detail = String(err.message || err.error_user_msg || `HTTP ${status}`).slice(0, 300);
  const label = platform === 'facebook' ? 'Facebook' : 'Instagram';
  const reconnect: ReconnectHint = {
    platform,
    ...(platform === 'instagram' ? { method: instagramDirect ? 'instagram' as const : 'facebook' as const } : {}),
    extraScopes: [permission],
  };

  if (code === 10 && OUTSIDE_WINDOW_SUBCODES.has(subcode)) {
    return { ok: false, status: 422, error: `This conversation is outside ${label}'s 24-hour reply window, so it can only be answered in Meta Business Suite.` };
  }
  if (code === 190 || status === 401) {
    return { ok: false, status: 409, error: `${label} access has expired. Reconnect ${label} to reply.`, reconnect: { ...reconnect, extraScopes: [] } };
  }
  if (code === 10 || code === 200 || code === 230 || (code >= 200 && code < 300) || /permission/i.test(detail)) {
    return { ok: false, status: 422, error: `${label} needs the ${permission} permission to send this reply. Reconnect ${label} and approve it.`, reconnect };
  }
  return { ok: false, status: 502, error: `${label} rejected the reply: ${detail}` };
}

export async function deliverInboxReply(thread: ReplyThread, creds: ReplyCredentials, text: string): Promise<DeliveryOutcome> {
  const plan = planInboxReply(thread, creds, text);
  if (!('url' in plan)) return { ok: false, status: plan.status, error: plan.error };
  const platform = String(thread.platform).toLowerCase() === 'facebook' ? 'facebook' : 'instagram';
  try {
    const resp = await axios.post(plan.url, plan.body, {
      params: { access_token: creds.accessToken },
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 15_000,
    });
    const data: any = resp.data || {};
    if (resp.status >= 400 || data.error) {
      return describeReplyFailure(platform, resp.status, data, plan.permission, creds.instagramDirect);
    }
    return { ok: true, externalMessageId: String(data.message_id || data.id || '') || null };
  } catch (err) {
    return { ok: false, status: 502, error: `Could not reach ${platform === 'facebook' ? 'Facebook' : 'Instagram'}: ${err instanceof Error ? err.message : 'network error'}` };
  }
}

// The token and account ids for answering on behalf of a thread's account.
export async function resolveReplyCredentials(
  thread: ReplyThread & { user_id: string },
  deps: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
    decrypt: (encrypted: string) => string;
    getPublishableSocialConnection: (userId: string, platformId: string) => Promise<any>;
  },
): Promise<ReplyCredentials | { status: number; error: string; reconnect?: ReconnectHint }> {
  const platform = String(thread.platform || '').toLowerCase();
  if (platform === 'facebook') {
    // Page tokens act as the Page; older threads have no recorded Page, which
    // is only resolvable when the user saved exactly one.
    const accountId = String(thread.external_account_id || '').trim();
    const { rows } = await deps.query(
      `SELECT account_id, access_token_encrypted, access_token FROM social_accounts
        WHERE user_id = $1 AND platform = 'facebook' AND account_type = 'page' AND connected = true
          AND (COALESCE(access_token_encrypted, '') <> '' OR COALESCE(access_token, '') <> '')
          ${accountId ? 'AND account_id = $2' : ''}`,
      accountId ? [thread.user_id, accountId] : [thread.user_id],
    );
    if (rows.length !== 1) {
      return {
        status: 409,
        error: accountId
          ? 'This Facebook Page is not saved for publishing. Save it under Integrations → Facebook → Manage Pages, then try again.'
          : 'Could not tell which Facebook Page received this conversation.',
        reconnect: { platform: 'facebook', extraScopes: [] },
      };
    }
    const row = rows[0];
    let token = '';
    try { token = row.access_token_encrypted ? deps.decrypt(String(row.access_token_encrypted)) : ''; } catch { token = ''; }
    token = token || String(row.access_token || '').trim();
    if (!token) return { status: 409, error: 'The saved Facebook Page token can no longer be read. Reconnect Facebook.', reconnect: { platform: 'facebook', extraScopes: [] } };
    return { accessToken: token, instagramDirect: false, pageId: String(row.account_id) };
  }

  const conn = await deps.getPublishableSocialConnection(thread.user_id, 'instagram');
  const token = String(conn?.access_token || '').trim();
  if (!conn || conn.needs_reapproval || !token) {
    return { status: 409, error: 'Instagram access has expired. Reconnect Instagram to reply.', reconnect: { platform: 'instagram', extraScopes: [] } };
  }
  const tokenData = conn.token_data && typeof conn.token_data === 'object' ? conn.token_data : {};
  const instagramDirect = isInstagramDirectLogin({ accessToken: token, tokenData });
  return {
    accessToken: token,
    instagramDirect,
    pageId: tokenData.pageId ? String(tokenData.pageId) : null,
    instagramAccountId: String(conn.account_id || thread.external_account_id || '') || null,
  };
}
