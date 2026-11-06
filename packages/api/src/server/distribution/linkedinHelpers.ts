import axios from 'axios';

// ─── LinkedIn REST headers ─────────────────────────────────────────────────────

const LINKEDIN_MARKETING_VERSION = String(process.env.LINKEDIN_API_VERSION || '202603').trim() || '202603';

export function getLinkedInRestHeaders(accessToken: string, contentType = 'application/json'): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': LINKEDIN_MARKETING_VERSION,
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

// ─── ID / URN helpers ─────────────────────────────────────────────────────────

export function parseLinkedInOrganizationId(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const urnMatch = raw.match(/organization:(\d+)/i);
  if (urnMatch?.[1]) return urnMatch[1];
  return /^\d+$/.test(raw) ? raw : '';
}

export function buildLinkedInRestliList(values: string[]): string {
  return `List(${values.map((v) => encodeURIComponent(v)).join(',')})`;
}

export function buildLinkedInRestliListValue(values: string[]): string {
  return `List(${values.join(',')})`;
}

export function normalizeLinkedInOrganization(org: any, idFallback = ''): { id: string; name: string; picture_url?: string | null; raw: any } {
  const id = parseLinkedInOrganizationId(org?.id) || idFallback;
  const localizedName = String(org?.localizedName || org?.name || '').trim();
  return {
    id,
    name: localizedName || `LinkedIn Page ${id || idFallback}`,
    picture_url:
      (typeof org?.logoV2?.displayedPicture === 'string' && org.logoV2.displayedPicture) ||
      (typeof org?.logoV2?.original === 'string' && org.logoV2.original) ||
      null,
    raw: org,
  };
}

// ─── Organization fetch helpers ───────────────────────────────────────────────

export async function fetchLinkedInOrganizationsByIds(
  accessToken: string,
  organizationIds: string[],
): Promise<Array<{ id: string; name: string; picture_url?: string | null; raw: any }>> {
  const uniqueIds = Array.from(new Set(organizationIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const batchResp = await axios.get(
    `https://api.linkedin.com/rest/organizations?ids=${buildLinkedInRestliList(uniqueIds)}`,
    { headers: getLinkedInRestHeaders(accessToken), validateStatus: () => true, timeout: 15000 },
  );
  const batchData: any = batchResp.data || {};
  if (batchResp.status < 400 && batchData?.results && typeof batchData.results === 'object') {
    return uniqueIds
      .map((id) => {
        const status = Number(batchData?.statuses?.[id] ?? 200);
        if (status >= 400) return null;
        const org = batchData.results[id];
        if (!org) return null;
        return normalizeLinkedInOrganization(org, id);
      })
      .filter(Boolean) as Array<{ id: string; name: string; picture_url?: string | null; raw: any }>;
  }

  const organizations: Array<{ id: string; name: string; picture_url?: string | null; raw: any }> = [];
  for (const organizationId of uniqueIds) {
    const orgResp = await axios.get(
      `https://api.linkedin.com/rest/organizations/${encodeURIComponent(organizationId)}`,
      { headers: getLinkedInRestHeaders(accessToken), validateStatus: () => true, timeout: 15000 },
    );
    if (orgResp.status >= 400 || !orgResp.data) continue;
    organizations.push(normalizeLinkedInOrganization(orgResp.data, organizationId));
  }
  return organizations;
}

export async function fetchLinkedInOrganizationNetworkSize(accessToken: string, organizationUrn: string): Promise<number | null> {
  const resp = await axios.get(
    `https://api.linkedin.com/rest/networkSizes/${encodeURIComponent(organizationUrn)}`,
    { params: { edgeType: 'COMPANY_FOLLOWED_BY_MEMBER' }, headers: getLinkedInRestHeaders(accessToken), validateStatus: () => true, timeout: 15000 },
  );
  if (resp.status >= 400) return null;
  const firstDegreeSize = Number((resp.data as any)?.firstDegreeSize);
  return Number.isFinite(firstDegreeSize) ? firstDegreeSize : null;
}

export async function fetchLinkedInPostsByAuthor(accessToken: string, authorUrn: string, maxCount = 100): Promise<any[]> {
  const posts: any[] = [];
  let start = 0;
  while (posts.length < maxCount) {
    const count = Math.min(100, maxCount - posts.length);
    const resp = await axios.get('https://api.linkedin.com/rest/posts', {
      params: { q: 'author', author: authorUrn, viewContext: 'AUTHOR', count, start },
      headers: getLinkedInRestHeaders(accessToken),
      validateStatus: () => true,
      timeout: 15000,
    });
    if (resp.status >= 400) break;
    const elements = Array.isArray((resp.data as any)?.elements) ? (resp.data as any).elements : [];
    posts.push(...elements);
    if (elements.length < count) break;
    start += elements.length;
  }
  return posts;
}

// ─── Social metadata / reactions ─────────────────────────────────────────────

export async function fetchLinkedInSocialMetadataBatch(accessToken: string, entityUrns: string[]): Promise<Record<string, any>> {
  const uniqueUrns = Array.from(new Set(entityUrns.map((urn) => String(urn || '').trim()).filter(Boolean)));
  if (uniqueUrns.length === 0) return {};
  const resp = await axios.get(
    `https://api.linkedin.com/rest/socialMetadata?ids=${buildLinkedInRestliList(uniqueUrns)}`,
    { headers: getLinkedInRestHeaders(accessToken), validateStatus: () => true, timeout: 15000 },
  );
  if (resp.status >= 400) return {};
  const data: any = resp.data || {};
  return data?.results && typeof data.results === 'object' ? data.results : {};
}

export function sumLinkedInReactionCounts(metadata: any): number {
  const summaries = metadata?.reactionSummaries;
  if (!summaries || typeof summaries !== 'object') return 0;
  return Object.values(summaries).reduce<number>((sum, summary: any) => sum + Number(summary?.count || 0), 0);
}

export async function fetchLinkedInShareStatisticsForPosts(
  accessToken: string,
  organizationUrn: string,
  postUrns: string[],
): Promise<Map<string, any>> {
  const uniquePostUrns = Array.from(new Set(postUrns.map((urn) => String(urn || '').trim()).filter(Boolean)));
  if (uniquePostUrns.length === 0) return new Map();

  const params = new URLSearchParams({ q: 'organizationalEntity', organizationalEntity: organizationUrn });
  const shareUrns = uniquePostUrns.filter((urn) => /^urn:li:share:/i.test(urn));
  const ugcPostUrns = uniquePostUrns.filter((urn) => /^urn:li:ugcPost:/i.test(urn));
  if (shareUrns.length > 0) params.set('shares', buildLinkedInRestliListValue(shareUrns));
  if (ugcPostUrns.length > 0) params.set('ugcPosts', buildLinkedInRestliListValue(ugcPostUrns));

  const resp = await axios.get(
    `https://api.linkedin.com/rest/organizationalEntityShareStatistics?${params.toString()}`,
    { headers: getLinkedInRestHeaders(accessToken), validateStatus: () => true, timeout: 15000 },
  );
  const statsByPost = new Map<string, any>();
  if (resp.status >= 400) return statsByPost;
  const elements = Array.isArray((resp.data as any)?.elements) ? (resp.data as any).elements : [];
  for (const element of elements) {
    const key = String(element?.share || element?.ugcPost || '').trim();
    if (!key) continue;
    statsByPost.set(key, element?.totalShareStatistics || {});
  }
  return statsByPost;
}

// ─── Organization ACL / admin list ────────────────────────────────────────────

export async function listLinkedInAdminOrganizations(
  accessToken: string,
  _personId: string,
  options?: { allowedRoles?: string[] },
): Promise<{ organizations: Array<{ id: string; name: string; picture_url?: string | null; roles?: string[] }>; warning: string | null }> {
  const allowedRoles = new Set((options?.allowedRoles || []).map((role) => String(role || '').trim().toUpperCase()).filter(Boolean));
  const aclRequests = [
    { url: 'https://api.linkedin.com/rest/organizationAcls', headers: getLinkedInRestHeaders(accessToken) },
    { url: 'https://api.linkedin.com/v2/organizationAcls', headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' } },
  ];
  let aclWarning: string | null = null;
  const organizationRoles = new Map<string, Set<string>>();
  let requestIndex = 0;
  let start = 0;
  const count = 100;

  while (requestIndex < aclRequests.length) {
    const request = aclRequests[requestIndex];
    const aclResp = await axios.get(request.url, { params: { q: 'roleAssignee', count, start }, headers: request.headers, validateStatus: () => true, timeout: 15000 });
    const aclData: any = aclResp.data || {};
    if (aclResp.status >= 400) {
      aclWarning = aclData?.message || `LinkedIn organization ACL lookup failed (${aclResp.status})`;
      if (requestIndex === 0 && [400, 401, 404, 410, 426].includes(aclResp.status)) { requestIndex += 1; start = 0; continue; }
      return { organizations: [], warning: aclWarning };
    }
    const elements = Array.isArray(aclData?.elements) ? aclData.elements : [];
    for (const row of elements) {
      const state = String(row?.state || '').trim().toUpperCase();
      if (state && state !== 'APPROVED') continue;
      const role = String(row?.role || '').trim().toUpperCase();
      if (allowedRoles.size > 0 && role && !allowedRoles.has(role)) continue;
      const organizationId = parseLinkedInOrganizationId(row?.organizationTarget || row?.organization);
      if (!organizationId) continue;
      const roles = organizationRoles.get(organizationId) || new Set<string>();
      if (role) roles.add(role);
      organizationRoles.set(organizationId, roles);
    }
    if (elements.length < count) {
      const organizationDetails = await fetchLinkedInOrganizationsByIds(accessToken, Array.from(organizationRoles.keys()));
      return { organizations: organizationDetails.map((org) => ({ id: org.id, name: org.name, picture_url: org.picture_url, roles: Array.from(organizationRoles.get(org.id) || []) })), warning: aclWarning };
    }
    start += count;
  }
  return { organizations: [], warning: aclWarning };
}

// ─── Profile identity resolution ─────────────────────────────────────────────

export async function resolveLinkedInProfileIdentity(
  accessToken: string,
  fallback?: { accountId?: string | null; accountName?: string | null; tokenData?: any },
): Promise<{ personId: string; profileName: string }> {
  let personId = String(fallback?.accountId || '').trim() || String(fallback?.tokenData?.sub || fallback?.tokenData?.user_id || fallback?.tokenData?.id || '').trim();
  let profileName = String(fallback?.accountName || fallback?.tokenData?.name || '').trim();

  if (!personId || !profileName) {
    const meResp = await axios.get('https://api.linkedin.com/v2/me', { headers: { Authorization: `Bearer ${accessToken}` }, validateStatus: () => true, timeout: 15000 });
    if (meResp.status < 400) {
      const meData: any = meResp.data || {};
      personId = personId || String(meData?.id || '').trim();
      profileName = profileName || [String(meData?.localizedFirstName || '').trim(), String(meData?.localizedLastName || '').trim()].filter(Boolean).join(' ').trim();
    }
    if (!personId) {
      const userinfoResp = await axios.get('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` }, validateStatus: () => true, timeout: 15000 });
      if (userinfoResp.status >= 400) throw new Error('LinkedIn profile lookup failed — please reconnect');
      const userData: any = userinfoResp.data || {};
      personId = String(userData?.sub || '').trim();
      profileName = profileName || String(userData?.name || '').trim() || [String(userData?.given_name || '').trim(), String(userData?.family_name || '').trim()].filter(Boolean).join(' ').trim();
    }
  }
  return { personId, profileName };
}

// ─── Content extraction ───────────────────────────────────────────────────────

export function extractLinkedInOrganizationDescription(org: any): string | null {
  const direct = String(org?.description || '').trim();
  if (direct) return direct;
  const localized = org?.description?.localized;
  if (localized && typeof localized === 'object') {
    const first = Object.values(localized).find((v) => typeof v === 'string' && String(v).trim());
    if (typeof first === 'string' && first.trim()) return first.trim();
  }
  return null;
}

export function extractLinkedInPostText(post: any): string | null {
  const commentary = String(post?.commentary || '').trim();
  if (commentary) return commentary.slice(0, 5000);
  const articleTitle = String(post?.content?.article?.title || '').trim();
  if (articleTitle) return articleTitle.slice(0, 5000);
  return null;
}

export function extractLinkedInPostMediaType(post: any): string {
  const mediaId = String(post?.content?.media?.id || '').trim().toLowerCase();
  if (post?.content?.multiImage?.images?.length) return 'multi_image';
  if (post?.content?.article?.source) return 'article';
  if (mediaId.includes(':video:')) return 'video';
  if (mediaId.includes(':image:')) return 'image';
  if (mediaId.includes(':document:')) return 'document';
  return 'text';
}
