import { extractApiErrorMessage, fetchApiJson } from '../utils/apiRequest';

const authHeaders = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export type IntegrationType = 'cms' | 'social' | 'marketing' | 'messaging' | 'other';

// Server-computed state of a connected account's credentials.
export type ConnectionHealth = {
  status: 'healthy' | 'expiring' | 'reconnect_required';
  reason: string | null;
  message: string | null;
  expiresAt: string | null;
};

export type IntegrationCatalogItem = {
  slug: string;
  name: string;
  type: IntegrationType;
  adminEnabled: boolean;
  configured: boolean;
  connected: boolean;
  connection: Record<string, any> | null;
  health?: ConnectionHealth | null;
};

const isVisibleIntegration = (item: IntegrationCatalogItem) =>
  item.adminEnabled && item.configured;

const FALLBACK_CATALOG: Array<{ slug: string; name: string; type: IntegrationType }> = [
  { slug: 'wordpress', name: 'WordPress', type: 'cms' },
  { slug: 'facebook', name: 'Facebook', type: 'social' },
  { slug: 'instagram', name: 'Instagram', type: 'social' },
  { slug: 'linkedin', name: 'LinkedIn', type: 'social' },
  { slug: 'twitter', name: 'X (Twitter)', type: 'social' },
  { slug: 'pinterest', name: 'Pinterest', type: 'social' },
  { slug: 'tiktok', name: 'TikTok', type: 'social' },
  { slug: 'threads', name: 'Threads', type: 'social' },
  { slug: 'mailchimp', name: 'Mailchimp', type: 'marketing' },
  { slug: 'gmail', name: 'Gmail', type: 'messaging' },
  { slug: 'slack', name: 'Slack', type: 'messaging' },
  { slug: 'whatsapp', name: 'WhatsApp', type: 'messaging' },
  { slug: 'zoom', name: 'Zoom', type: 'messaging' },
  { slug: 'google_calendar', name: 'Google Calendar', type: 'messaging' },
];

const normalizePlatform = (value: string) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'x' || v.includes('twitter')) return 'twitter';
  if (v.includes('facebook')) return 'facebook';
  if (v.includes('instagram')) return 'instagram';
  if (v.includes('linkedin')) return 'linkedin';
  if (v.includes('pinterest')) return 'pinterest';
  if (v.includes('wordpress')) return 'wordpress';
  if (v.includes('mailchimp')) return 'mailchimp';
  if (v.includes('threads')) return 'threads';
  if (v.includes('tiktok')) return 'tiktok';
  return v;
};

const fallbackCatalog = async (): Promise<{ success: boolean; integrations?: IntegrationCatalogItem[]; error?: string }> => {
  try {
    const [enabledRes, accountsRes, wpRes] = await Promise.all([
      fetchApiJson<{ enabled?: string[] }>('/api/integrations/enabled', { headers: authHeaders() }, 'Failed to load enabled integrations'),
      fetchApiJson<{ data?: any[] }>('/api/accounts', { headers: authHeaders() }, 'Failed to load connected accounts'),
      fetchApiJson<{ connected?: boolean; siteUrl?: string | null }>('/api/wordpress/status', { headers: authHeaders() }, 'Failed to load WordPress status'),
    ]);

    const enabledData = enabledRes.payload || {};
    const accountsData = accountsRes.payload || {};
    const wpData = wpRes.payload || {};

    const enabled = Array.isArray(enabledData.enabled) ? enabledData.enabled.map(normalizePlatform) : [];
    const enabledSet = new Set(enabled.filter(Boolean));
    const accounts = Array.isArray(accountsData.data) ? accountsData.data : [];
    const connectedSet = new Set(
      accounts
        .filter((acc: any) => acc?.connected !== false)
        .map((acc: any) => normalizePlatform(acc.platform))
        .filter(Boolean)
    );

    const wpConnected = Boolean(wpData?.connected);

    // Build a map of platform -> account data for connection objects
    const accountsByPlatform = new Map<string, any>();
    for (const acc of accounts) {
      const platform = normalizePlatform(acc.platform);
      if (platform && acc.connected !== false) {
        accountsByPlatform.set(platform, acc);
      }
    }

    const integrations: IntegrationCatalogItem[] = FALLBACK_CATALOG.map((item) => {
      const adminEnabled = enabledSet.has(item.slug);
      const configured = item.slug === 'wordpress' || item.slug === 'mailchimp' ? true : enabledSet.has(item.slug);
      const connected =
        item.slug === 'wordpress'
          ? wpConnected
          : item.slug === 'mailchimp'
            ? false
            : connectedSet.has(item.slug);
      
      let connection: Record<string, any> | null = null;
      let health: ConnectionHealth | null = null;
      if (item.slug === 'wordpress' && wpConnected) {
        connection = { siteUrl: wpData?.siteUrl || null, connectedAt: null };
      } else if (accountsByPlatform.has(item.slug) && connected) {
        const acc = accountsByPlatform.get(item.slug);
        connection = {
          accountId: acc.accountId || acc.id || null,
          accountName: acc.accountName || null,
          username: acc.handle || null,
          connectedAt: acc.connectedAt || null,
        };
        if (acc.needsReapproval) {
          health = { status: 'reconnect_required', reason: null, message: 'This connection needs to be reconnected.', expiresAt: acc.expiresAt || null };
        }
      }

      return { ...item, adminEnabled, configured, connected, connection, health };
    }).filter(isVisibleIntegration);

    return { success: true, integrations };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to load integrations' };
  }
};

async function sha256Base64Url(input: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  const bytes = new Uint8Array(digest);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  const b64 = btoa(str);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomString(length = 48) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// Shared by startOAuth (top-level redirect) and getOAuthPopupUrl (caller opens
// the popup and assigns this URL to it) so both paths register the same state
// row and CSRF/PKCE handling.
async function buildAuthorizeUrl(
  platform: string,
  returnTo: string,
  options?: { extraScopes?: string[]; rerequest?: boolean; method?: 'instagram' | 'facebook' },
): Promise<{ success: boolean; url?: string; error?: string }> {
  const normalized = String(platform || '').trim().toLowerCase();
  const state = randomString(32);

  let codeVerifier: string | undefined;
  let codeChallenge: string | undefined;
  if (normalized === 'twitter') {
    codeVerifier = randomString(64);
    codeChallenge = await sha256Base64Url(codeVerifier);
  }

  const stateResponse = await fetchApiJson<{ error?: string }>(
    '/api/oauth/state',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ state, platform: normalized, returnTo, codeVerifier }),
    },
    'Failed to start OAuth'
  );
  if (!stateResponse.ok) {
    return { success: false, error: extractApiErrorMessage(stateResponse.payload, stateResponse.text, 'Failed to start OAuth') };
  }

  const params = new URLSearchParams({ state });
  if (normalized === 'twitter' && codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  if (options?.extraScopes && options.extraScopes.length > 0) {
    params.set('extra_scopes', options.extraScopes.join(','));
  }
  if (options?.rerequest) {
    params.set('rerequest', '1');
  }
  if (options?.method) {
    params.set('method', options.method);
  }

  const authResponse = await fetchApiJson<{ url?: string; error?: string }>(
    `/api/oauth/${encodeURIComponent(normalized)}/authorize-url?${params.toString()}`,
    { headers: authHeaders() },
    'Failed to build authorization URL'
  );
  if (!authResponse.ok) {
    return { success: false, error: extractApiErrorMessage(authResponse.payload, authResponse.text, 'Failed to build authorization URL') };
  }
  if (!authResponse.payload?.url) return { success: false, error: 'Authorization URL missing' };
  return { success: true, url: authResponse.payload.url };
}

export const integrationService = {
  async getCatalog(): Promise<{ success: boolean; integrations?: IntegrationCatalogItem[]; error?: string }> {
    const response = await fetchApiJson<{ integrations?: IntegrationCatalogItem[] }>(
      '/api/integrations/catalog',
      { headers: authHeaders() },
      'Failed to load integrations'
    );
    if (response.status === 404) {
      return fallbackCatalog();
    }
    if (!response.ok) {
      return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to load integrations') };
    }
    const integrations = Array.isArray(response.payload?.integrations) ? response.payload.integrations.filter(isVisibleIntegration) : [];
    return { success: true, integrations };
  },

  async disconnectOAuth(platform: string): Promise<{ success: boolean; error?: string }> {
    const response = await fetchApiJson(
      `/api/accounts/${encodeURIComponent(platform)}`,
      {
        method: 'DELETE',
        headers: authHeaders(),
      },
      'Failed to disconnect the account'
    );
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to disconnect') };
    return { success: true };
  },

  async startOAuth(
    platform: string,
    returnTo = '/integrations',
    options?: { extraScopes?: string[]; rerequest?: boolean; method?: 'instagram' | 'facebook' },
  ): Promise<{ success: boolean; error?: string }> {
    const result = await buildAuthorizeUrl(platform, returnTo, options);
    if (!result.success || !result.url) return { success: false, error: result.error };
    window.location.href = result.url;
    return { success: true };
  },

  // Same OAuth handshake as startOAuth, but returns the URL instead of navigating —
  // for callers that open it in a popup (e.g. onboarding) so the host page never unmounts.
  async getOAuthPopupUrl(
    platform: string,
    returnTo = '/dashboard',
    options?: { extraScopes?: string[]; rerequest?: boolean; method?: 'instagram' | 'facebook' },
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    return buildAuthorizeUrl(platform, returnTo, options);
  },

  async listFacebookPages(): Promise<{
    success: boolean;
    pages?: Array<{ id: string; name: string; picture?: string | null; can_publish?: boolean; saved?: boolean }>;
    missingPermissions?: string[];
    error?: string;
  }> {
    const response = await fetchApiJson<{ pages?: Array<{ id: string; name: string; picture?: string | null; can_publish?: boolean; saved?: boolean }>; missingPermissions?: string[] }>(
      '/api/v1/social/facebook/pages',
      { headers: authHeaders() },
      'Failed to load Facebook pages'
    );
    if (response.status === 404) {
      const legacyResponse = await fetchApiJson<{ pages?: Array<{ id: string; name: string; picture?: string | null; can_publish?: boolean; saved?: boolean }>; missingPermissions?: string[] }>(
        '/api/facebook/targets',
        { headers: authHeaders() },
        'Failed to load Facebook pages'
      );
      if (!legacyResponse.ok) {
        return { success: false, error: extractApiErrorMessage(legacyResponse.payload, legacyResponse.text, `Failed to load pages (${legacyResponse.status})`) };
      }
      return { success: true, pages: legacyResponse.payload?.pages || [], missingPermissions: legacyResponse.payload?.missingPermissions || [] };
    }
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, `Failed to load pages (${response.status})`) };
    return { success: true, pages: response.payload?.pages || [], missingPermissions: response.payload?.missingPermissions || [] };
  },

  async listFacebookTargets(): Promise<{
    success: boolean;
    pages?: Array<{ id: string; name: string; picture?: string | null; can_publish?: boolean; saved?: boolean }>;
    groups?: Array<{ id: string; name: string }>;
    missingPermissions?: string[];
    warnings?: string[];
    error?: string;
  }> {
    const response = await fetchApiJson<{
      pages?: Array<{ id: string; name: string; picture?: string | null; can_publish?: boolean; saved?: boolean }>;
      groups?: Array<{ id: string; name: string }>;
      missingPermissions?: string[];
      warnings?: string[];
      warning?: string;
    }>('/api/v1/social/facebook/targets', { headers: authHeaders() }, 'Failed to load Facebook targets');
    if (response.status === 404) {
      const legacyResponse = await fetchApiJson<{
        pages?: Array<{ id: string; name: string; picture?: string | null; can_publish?: boolean; saved?: boolean }>;
        groups?: Array<{ id: string; name: string }>;
        warnings?: string[] | string;
        warning?: string;
      }>('/api/facebook/targets', { headers: authHeaders() }, 'Failed to load Facebook targets');
      if (!legacyResponse.ok) {
        return { success: false, error: extractApiErrorMessage(legacyResponse.payload, legacyResponse.text, `Failed to load targets (${legacyResponse.status})`) };
      }
      return {
        success: true,
        pages: legacyResponse.payload?.pages || [],
        groups: legacyResponse.payload?.groups || [],
        warnings: legacyResponse.payload?.warnings ? [legacyResponse.payload.warnings].flat() : legacyResponse.payload?.warning ? [legacyResponse.payload.warning] : [],
      };
    }
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, `Failed to load targets (${response.status})`) };
    return {
      success: true,
      pages: response.payload?.pages || [],
      groups: response.payload?.groups || [],
      missingPermissions: response.payload?.missingPermissions || [],
      warnings: response.payload?.warnings || [],
    };
  },

  async lookupFacebookPage(query: string): Promise<{
    success: boolean;
    page?: { id: string; name: string; picture?: string | null; can_publish?: boolean; saved?: boolean };
    pages?: Array<{ id: string; name: string; picture?: string | null; can_publish?: boolean; saved?: boolean }>;
    error?: string;
  }> {
    const response = await fetchApiJson<{
      page?: { id: string; name: string; picture?: string | null; can_publish?: boolean; saved?: boolean };
      pages?: Array<{ id: string; name: string; picture?: string | null; can_publish?: boolean; saved?: boolean }>;
      error?: string;
    }>(
      '/api/v1/social/facebook/lookup-page',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ query }),
      },
      'Failed to look up Facebook Page',
    );
    if (!response.ok) {
      return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to look up Facebook Page') };
    }
    return { success: true, page: response.payload?.page, pages: response.payload?.pages || [] };
  },

  async listInstagramTargets(): Promise<{
    success: boolean;
    targets?: Array<{
      pageId: string;
      pageName: string;
      pagePicture?: string | null;
      pageTasks?: string[];
      instagramId: string | null;
      instagramUsername: string | null;
      instagramName?: string | null;
      instagramAccountType?: string | null;
      instagramFollowers?: number | null;
      instagramFollowing?: number | null;
      instagramMediaCount?: number | null;
      instagramBio?: string | null;
      instagramProfilePicture?: string | null;
      instagramWebsite?: string | null;
      instagramVerified?: boolean;
      canPublish?: boolean;
      canInsights?: boolean;
    }>;
    facebookConnected?: boolean;
    missingPermissions?: string[];
    warnings?: string[];
    error?: string;
  }> {
    const response = await fetchApiJson<{
      facebookConnected?: boolean;
      targets?: Array<{
        pageId: string;
        pageName: string;
        pagePicture?: string | null;
        pageTasks?: string[];
        instagramId: string | null;
        instagramUsername: string | null;
        instagramName?: string | null;
        instagramAccountType?: string | null;
        instagramFollowers?: number | null;
        instagramFollowing?: number | null;
        instagramMediaCount?: number | null;
        instagramBio?: string | null;
        instagramProfilePicture?: string | null;
        instagramWebsite?: string | null;
        instagramVerified?: boolean;
        canPublish?: boolean;
        canInsights?: boolean;
      }>;
      missingPermissions?: string[];
      warnings?: string[];
    }>(
      '/api/instagram/targets',
      { headers: authHeaders() },
      'Failed to load Instagram targets'
    );
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to load Instagram targets') };
    return {
      success: true,
      facebookConnected: response.payload?.facebookConnected,
      targets: response.payload?.targets || [],
      missingPermissions: response.payload?.missingPermissions || [],
      warnings: response.payload?.warnings || [],
    };
  },

  async connectInstagram(pageId: string, instagramId: string, instagramUsername?: string | null): Promise<{ success: boolean; error?: string }> {
    const response = await fetchApiJson(
      '/api/instagram/connect',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ pageId, instagramId, instagramUsername }),
      },
      'Failed to connect Instagram'
    );
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to connect Instagram') };
    return { success: true };
  },

  async listPinterestBoards(): Promise<{ success: boolean; boards?: Array<{ id: string; name: string }>; error?: string }> {
    const response = await fetchApiJson<{ boards?: Array<{ id: string; name: string }> }>(
      '/api/pinterest/boards',
      { headers: authHeaders() },
      'Failed to load Pinterest boards'
    );
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to load boards') };
    return { success: true, boards: response.payload?.boards || [] };
  },

  async listLinkedInTargets(): Promise<{
    success: boolean;
    targets?: Array<{ id: string; name: string; accountType: 'profile' | 'page'; saved?: boolean }>;
    warning?: string | null;
    error?: string;
  }> {
    const response = await fetchApiJson<{
      targets?: Array<{ id: string; name: string; accountType: 'profile' | 'page'; saved?: boolean }>;
      warning?: string | null;
    }>('/api/linkedin/targets', { headers: authHeaders() }, 'Failed to load LinkedIn targets');
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to load LinkedIn targets') };
    return { success: true, targets: response.payload?.targets || [], warning: response.payload?.warning || null };
  },

  async saveSocialTarget(payload: { platform: string; account_type: string; account_id: string; account_name: string }): Promise<{ success: boolean; error?: string }> {
    const response = await fetchApiJson(
      '/api/v1/social/accounts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      },
      'Failed to save the connected account'
    );
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to save target') };
    return { success: true };
  },

  async connectMailchimp(payload: { apiKey: string; serverPrefix: string }): Promise<{ success: boolean; error?: string }> {
    const response = await fetchApiJson(
      '/api/integrations/mailchimp/connect',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      },
      'Failed to connect Mailchimp'
    );
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to connect Mailchimp') };
    return { success: true };
  },

  async disconnectMailchimp(): Promise<{ success: boolean; error?: string }> {
    const response = await fetchApiJson(
      '/api/integrations/mailchimp/disconnect',
      {
        method: 'DELETE',
        headers: authHeaders(),
      },
      'Failed to disconnect Mailchimp'
    );
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to disconnect Mailchimp') };
    return { success: true };
  },

  async listLinkedInOrganizations(): Promise<{
    success: boolean;
    organizations?: Array<{ id: string; name: string; picture_url?: string | null }>;
    error?: string;
  }> {
    const response = await fetchApiJson<{ success: boolean; organizations?: Array<{ id: string; name: string; picture_url?: string | null }> }>(
      '/api/social/linkedin/organizations',
      { headers: authHeaders() },
      'Failed to load LinkedIn organizations'
    );
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to load LinkedIn organizations') };
    return { success: true, organizations: response.payload?.organizations || [] };
  },

  async connectLinkedInCompany(organizationId: string): Promise<{ success: boolean; error?: string }> {
    const response = await fetchApiJson(
      '/api/social/linkedin/company-sync',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ organizationId }),
      },
      'Failed to connect LinkedIn company page'
    );
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to connect LinkedIn company page') };
    return { success: true };
  },

  async connectWhatsApp(phoneNumberId: string, accessToken: string, displayName?: string): Promise<{ success: boolean; accountName?: string; error?: string }> {
    const response = await fetchApiJson<{ success: boolean; accountName?: string }>(
      '/api/integrations/whatsapp/connect',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ phoneNumberId, accessToken, displayName }),
      },
      'Failed to connect WhatsApp'
    );
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to connect WhatsApp') };
    return { success: true, accountName: response.payload?.accountName };
  },

  async disconnectWhatsApp(): Promise<{ success: boolean; error?: string }> {
    const response = await fetchApiJson(
      '/api/integrations/whatsapp/disconnect',
      { method: 'DELETE', headers: authHeaders() },
      'Failed to disconnect WhatsApp'
    );
    if (!response.ok) return { success: false, error: extractApiErrorMessage(response.payload, response.text, 'Failed to disconnect WhatsApp') };
    return { success: true };
  },
};

