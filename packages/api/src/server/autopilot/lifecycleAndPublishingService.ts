import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type { AutopilotRepository } from './repository.ts';
import type { AutopilotTenantContext } from './tenantContext.ts';
import { validateAutopilotContentItem } from './validationAndPolicyService.ts';
import { createCreativeBriefForItem } from './creativeBriefAndRouter.ts';
import { evaluateMediaPublishability, mergeValidationIssues, placementForItem, publishableMediaEntries } from './mediaQa.ts';
import { getTenantControls, isGlobalPublishingKilled } from './billingAndBudgetService.ts';
import type { AssetStorageDriver } from './assetStorage.ts';
import { logger } from '../../logger.ts';
import {
  ALLOWED_LIFECYCLE_TRANSITIONS,
  type ContentItemRecord,
  type ContentLifecycleState,
  type NamedScheduleSlot,
  type PublicationAttemptRecord,
  type PublicationRecord,
} from './types.ts';

export class AutopilotLifecycleError extends Error {
  code: string;
  status: number;
  details?: Record<string, any>;

  constructor(code: string, message: string, status = 400, details?: Record<string, any>) {
    super(message);
    this.name = 'AutopilotLifecycleError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface SocialPublisherInput {
  userId: string;
  tenantId: string;
  channel: string;
  socialAccountId?: string | null;
  title: string;
  caption: string;
  platformMediaType: 'FEED_POST' | 'CAROUSEL' | 'REEL' | 'STORY';
  mediaAssets: Array<{ url: string; type: 'image' | 'video'; alt_text?: string; mime_type?: string }>;
  idempotencyKey: string;
}

/** One-shot channels. remotePostId must be the platform's own ID; never invented. */
export interface SocialPublisherResult {
  remotePostId?: string | null;
  url?: string | null;
  raw?: Record<string, any>;
}

export type ContainerStatus = 'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED' | 'PUBLISHED' | 'UNKNOWN';

export type StagedFailure = { ok: false; code: string; message: string; retryable: boolean; outcome: 'definitive' | 'unknown' };

/**
 * Channels whose publishing is asynchronous on the platform side (Instagram
 * containers). Every step persists before the next, so a crash or a lost
 * response resumes from the last recorded step instead of posting twice.
 */
export interface StagedPublisher {
  checkAccount(userId: string): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  createContainer(input: SocialPublisherInput): Promise<{ ok: true; containerId: string; raw?: any } | StagedFailure>;
  checkContainer(userId: string, containerId: string): Promise<{ status: ContainerStatus; detail?: string }>;
  publishContainer(userId: string, containerId: string): Promise<{ ok: true; mediaId: string; permalink: string | null } | StagedFailure>;
  findPublishedMedia(userId: string, opts: { containerId: string; caption: string; sinceIso: string }): Promise<{ mediaId: string; permalink: string | null } | null>;
}

/** Formats each channel's publisher actually implements for the autopilot. */
export const CHANNEL_FORMAT_CAPABILITY: Record<string, { formats: Array<SocialPublisherInput['platformMediaType']>; staged: boolean; note: string }> = {
  instagram: { formats: ['FEED_POST', 'CAROUSEL', 'REEL', 'STORY'], staged: true, note: 'Instagram Graph API containers (backend/platforms/instagram_business.ts); Story needs a Business/Creator account.' },
  facebook: { formats: ['FEED_POST'], staged: false, note: 'Page feed posts only through publishToplatform.' },
  linkedin: { formats: ['FEED_POST'], staged: false, note: 'Feed posts only.' },
  twitter: { formats: ['FEED_POST'], staged: false, note: 'Posts only.' },
  threads: { formats: ['FEED_POST'], staged: false, note: 'Posts only.' },
  pinterest: { formats: ['FEED_POST'], staged: false, note: 'Pins only.' },
  tiktok: { formats: [], staged: false, note: 'Not wired to the autopilot publisher.' },
};

export const PUBLISH_MAX_ATTEMPTS = 5;
const PROCESSING_TIMEOUT_MS = 30 * 60_000;
const RECONCILE_MAX_ATTEMPTS = 6;
const LEASE_SECONDS = 300;
const DELIVERY_URL_TTL_SECONDS = 6 * 3600;

export function publishBackoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}

export function classifyPublishError(err: unknown): {
  retryable: boolean;
  ambiguous: boolean;
  code: string;
  message: string;
  remediation: string;
} {
  const status = Number((err as any)?.status || (err as any)?.response?.status || 0);
  const rawMsg = String((err as any)?.response?.data?.error?.message || (err as any)?.message || err || 'Unknown publish failure');
  const lower = rawMsg.toLowerCase();
  const netCode = String((err as any)?.code || '');

  if (status === 401 || status === 403 || /\b(token|oauth|unauthorized|forbidden|revoked|expired|re-authorize|reconnect|scope|permission)\b/.test(lower)) {
    return { retryable: false, ambiguous: false, code: 'RECONNECT_ACCOUNT', message: rawMsg, remediation: 'Reconnect the social account in Integrations, then retry.' };
  }
  if (status === 400 || status === 422 || /\b(invalid\s+media|aspect\s+ratio|public\s+http|unsupported|character\s+limit|carousel\s+requires)\b/.test(lower)) {
    return { retryable: false, ambiguous: false, code: 'INVALID_PAYLOAD_OR_MEDIA', message: rawMsg, remediation: 'Fix the media or caption in the Creative Queue, re-validate, and republish.' };
  }
  // The request may have reached the platform and posted: never retry blindly.
  if (['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(netCode) || status === 504 || /\b(timeout|timed out|socket hang up|econnreset)\b/.test(lower)) {
    return { retryable: false, ambiguous: true, code: 'PUBLISH_OUTCOME_UNKNOWN', message: rawMsg, remediation: 'Check the account for the post before retrying; the platform may have published it.' };
  }
  if (status === 429 || (status >= 500 && status <= 599) || /\b(rate\s*limit|too\s+many\s+requests|temporarily\s+unavailable|502|503)\b/.test(lower)) {
    return { retryable: true, ambiguous: false, code: status === 429 ? 'PLATFORM_RATE_LIMITED' : 'TRANSIENT_UPSTREAM_FAILURE', message: rawMsg, remediation: 'Transient platform issue; retried automatically with backoff.' };
  }
  return { retryable: false, ambiguous: false, code: 'PERMANENT_PUBLISH_ERROR', message: rawMsg, remediation: 'Inspect the platform response and the account configuration before retrying.' };
}

// ── Time handling ────────────────────────────────────────────────────────────

export function isValidIanaTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

function zoneOffsetMs(utcMs: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Converts a wall-clock time in an IANA zone to a UTC instant. A time that does
 * not exist (spring-forward gap) is rejected; an ambiguous one (fall-back) takes
 * the earlier instant and says so.
 */
export function zonedLocalToUtc(local: string, tz: string): { iso: string; ambiguous: boolean } {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(local || '').trim());
  if (!m) throw new AutopilotLifecycleError('INVALID_SCHEDULE_DATE', 'scheduled_local must be YYYY-MM-DDTHH:mm.', 400);
  if (!isValidIanaTimezone(tz)) throw new AutopilotLifecycleError('INVALID_TIMEZONE', `"${tz}" is not an IANA timezone.`, 400);
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const candidates = new Set<number>();
  for (const probe of [wall - 14 * 3600_000, wall, wall + 14 * 3600_000]) {
    const guess = wall - zoneOffsetMs(probe, tz);
    if (guess + zoneOffsetMs(guess, tz) === wall) candidates.add(guess);
  }
  const valid = [...candidates].sort((a, b) => a - b);
  if (!valid.length) {
    throw new AutopilotLifecycleError('DST_GAP', `${local} does not exist in ${tz} (the clocks skip it). Choose a time outside the daylight-saving change.`, 400, { local, timezone: tz });
  }
  return { iso: new Date(valid[0]).toISOString(), ambiguous: valid.length > 1 };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

async function authoritativeReport(repo: AutopilotRepository, tenantId: string, item: ContentItemRecord) {
  const business = await repo.getBusinessProfile(tenantId);
  if (!business) return null;
  const brand = await repo.getBrandProfile(tenantId);
  let brief = await repo.getCreativeBrief(tenantId, item.id);
  if (!brief) {
    brief = createCreativeBriefForItem({ item, business, brand });
    await repo.saveCreativeBrief(brief);
  }
  const referencedAssets = [];
  for (const refId of brief.reference_asset_ids) {
    const asset = await repo.getBrandAssetById(tenantId, refId);
    if (asset) referencedAssets.push(asset);
  }
  const storedPalette = (item.deterministic_overlay as any)?.proposed_palette_hexes;
  const policy = validateAutopilotContentItem({
    item,
    brief,
    business,
    brand,
    referencedAssets,
    proposedPaletteHexes: Array.isArray(storedPalette) && storedPalette.length ? storedPalette : undefined,
  });
  const assets = await repo.getAssetsByIds(tenantId, (item.media_assets ?? []).map((m) => m.asset_id ?? '').filter(Boolean));
  const media = evaluateMediaPublishability({ item, assets, channels: item.target_channels ?? [] });
  return mergeValidationIssues(policy, media);
}

export async function transitionContentItemState(params: {
  repo: AutopilotRepository;
  tenant: AutopilotTenantContext;
  itemId: string;
  toState: ContentLifecycleState;
  actorName?: string;
  notes?: string;
}): Promise<ContentItemRecord> {
  const { repo, tenant, itemId, toState } = params;
  const item = await repo.getContentItem(tenant.tenantId, itemId);
  if (!item) {
    throw new AutopilotLifecycleError('ITEM_NOT_FOUND', 'Content item not found in this workspace.', 404);
  }

  const fromState = item.lifecycle_state;
  if (fromState === toState) return item;

  const allowed = ALLOWED_LIFECYCLE_TRANSITIONS[fromState] ?? [];
  if (!allowed.includes(toState)) {
    throw new AutopilotLifecycleError(
      'INVALID_STATE_TRANSITION',
      `Cannot transition content item from "${fromState}" to "${toState}". Allowed transitions: ${allowed.join(', ') || 'none'}.`,
      409,
      { fromState, toState, allowed },
    );
  }

  if (toState === 'approved') {
    if (!tenant.canApprove) {
      throw new AutopilotLifecycleError('APPROVAL_PERMISSION_DENIED', `Role "${tenant.userRole}" cannot approve content items; admin or owner role required.`, 403);
    }
    // Approval always re-runs QA on the server against the current content and
    // media; a cached report can never approve modified content.
    const report = await authoritativeReport(repo, tenant.tenantId, item);
    if (!report) {
      throw new AutopilotLifecycleError('BUSINESS_PROFILE_REQUIRED', 'Complete the business profile before approving content.', 400);
    }
    item.validation_report = report;
    if (!report.passed) {
      const blockers = report.issues.filter((i) => i.severity === 'blocker');
      throw new AutopilotLifecycleError(
        'VALIDATION_BLOCKER_UNRESOLVED',
        `Cannot approve content item with ${blockers.length} unresolved policy/QA blocker(s): ${blockers.map((b) => b.code).join(', ')}.`,
        422,
        { validation_report: report },
      );
    }
    item.approved_by = tenant.userId;
    item.approved_at = new Date().toISOString();
  }

  if (toState === 'needs_changes' || toState === 'rejected') {
    item.approved_by = null;
    item.approved_at = null;
  }

  item.lifecycle_state = toState;
  item.updated_at = new Date().toISOString();
  await repo.saveContentItem(item);

  await repo.recordApprovalEvent({
    tenant_id: tenant.tenantId,
    content_item_id: item.id,
    action: toState,
    from_state: fromState,
    to_state: toState,
    actor_user_id: tenant.userId,
    actor_name: params.actorName || tenant.userId,
    actor_role: tenant.userRole,
    notes: params.notes || '',
  });

  await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, `item.transition.${toState}`, 'content_item', item.id, {
    from_state: fromState,
    to_state: toState,
    notes: params.notes || '',
  });

  return item;
}

export async function scheduleApprovedContentItem(params: {
  repo: AutopilotRepository;
  pool?: Pick<Pool, 'query'> | null;
  hasDatabase?: () => boolean;
  tenant: AutopilotTenantContext;
  itemId: string;
  scheduledAt?: string;
  scheduledLocal?: string;
  slotId?: string;
  timezone?: string;
  channels?: string[];
  socialAccountMap?: Record<string, string>;
  allowBlackoutOverride?: boolean;
  now?: Date;
}): Promise<{ item: ContentItemRecord; publications: PublicationRecord[]; timezone_note?: string }> {
  const { repo, tenant, itemId } = params;
  if (!tenant.canPublish) {
    throw new AutopilotLifecycleError('SCHEDULE_PERMISSION_DENIED', `Role "${tenant.userRole}" cannot schedule posts; admin or owner role required.`, 403);
  }
  const item = await repo.getContentItem(tenant.tenantId, itemId);
  if (!item) {
    throw new AutopilotLifecycleError('ITEM_NOT_FOUND', 'Content item not found in this workspace.', 404);
  }

  const business = await repo.getBusinessProfile(tenant.tenantId);

  if (item.lifecycle_state !== 'approved') {
    const canAutoStreamline =
      item.lifecycle_state === 'draft_ready' &&
      !item.approval_required &&
      business?.capacity.approval_mode === 'streamlined_evergreen' &&
      item.validation_report?.passed === true;

    if (!canAutoStreamline) {
      throw new AutopilotLifecycleError(
        'APPROVAL_REQUIRED_BEFORE_SCHEDULE',
        `Content item is in state "${item.lifecycle_state}" and must be explicitly approved before scheduling.`,
        409,
      );
    }
    item.lifecycle_state = 'approved';
    item.approved_by = tenant.userId;
    item.approved_at = new Date().toISOString();
  }

  // Time-sensitive checks happen again at schedule time.
  const report = await authoritativeReport(repo, tenant.tenantId, item);
  if (report && !report.passed) {
    const blockers = report.issues.filter((i) => i.severity === 'blocker');
    throw new AutopilotLifecycleError('VALIDATION_BLOCKER_UNRESOLVED', `Cannot schedule with ${blockers.length} unresolved blocker(s): ${blockers.map((b) => b.code).join(', ')}.`, 422, { validation_report: report });
  }

  const slots: NamedScheduleSlot[] = business?.schedule_config?.named_slots ?? [];
  const chosenSlot = params.slotId ? slots.find((s) => s.id === params.slotId) : undefined;

  const resolvedTimezone =
    params.timezone || chosenSlot?.timezone || item.scheduled_slot?.timezone || business?.schedule_config?.timezone || 'UTC';
  if (!isValidIanaTimezone(resolvedTimezone)) {
    throw new AutopilotLifecycleError('INVALID_TIMEZONE', `"${resolvedTimezone}" is not an IANA timezone.`, 400);
  }

  let timezoneNote: string | undefined;
  let resolvedScheduledIso: string;
  if (params.scheduledLocal) {
    const z = zonedLocalToUtc(params.scheduledLocal, resolvedTimezone);
    resolvedScheduledIso = z.iso;
    if (z.ambiguous) timezoneNote = `${params.scheduledLocal} occurs twice in ${resolvedTimezone}; the earlier instant was used.`;
  } else {
    resolvedScheduledIso = params.scheduledAt || item.scheduled_slot?.scheduled_at || new Date((params.now ?? new Date()).getTime() + 3600_000).toISOString();
  }

  const parsedDate = new Date(resolvedScheduledIso);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new AutopilotLifecycleError('INVALID_SCHEDULE_DATE', 'Invalid scheduled_at ISO timestamp.', 400);
  }
  const nowMs = (params.now ?? new Date()).getTime();
  if (parsedDate.getTime() < nowMs - 60_000) {
    throw new AutopilotLifecycleError('SCHEDULE_IN_PAST', 'scheduled_at is in the past.', 400, { scheduled_at: parsedDate.toISOString() });
  }

  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: resolvedTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsedDate);
  const blackoutSet = new Set(business?.schedule_config?.blackout_dates ?? []);
  if (blackoutSet.has(dateKey) && !params.allowBlackoutOverride) {
    throw new AutopilotLifecycleError('BLACKOUT_WINDOW_CONFLICT', `Requested date ${dateKey} falls inside a configured workspace blackout window.`, 409, { blackoutDate: dateKey });
  }

  const targetChannels = (params.channels?.length ? params.channels : item.target_channels).filter(Boolean).map((c) => c.toLowerCase());
  if (!targetChannels.length) {
    throw new AutopilotLifecycleError('NO_TARGET_CHANNELS', 'Select at least one target channel to schedule.', 400);
  }
  for (const ch of targetChannels) {
    const placement = placementForItem(item, ch);
    const cap = CHANNEL_FORMAT_CAPABILITY[ch];
    if (!cap || !cap.formats.includes(placement)) {
      throw new AutopilotLifecycleError('CHANNEL_FORMAT_UNSUPPORTED', `${ch} ${placement} is not supported by the autopilot publisher. ${cap?.note ?? ''}`.trim(), 422, { channel: ch, placement });
    }
  }

  const now = new Date().toISOString();
  const existing = await repo.listPublications(tenant.tenantId, item.id);
  const createdPublications: PublicationRecord[] = [];

  for (const ch of targetChannels) {
    const accountId = params.socialAccountMap?.[ch] ?? null;
    const live = existing.find((p) => p.channel === ch && (p.social_account_id ?? null) === accountId && !['published', 'cancelled', 'publish_failed'].includes(p.status));
    if (live) {
      // Rescheduling an existing publication is a compare-and-set, not a second row.
      const moved = await repo.transitionPublication(tenant.tenantId, live.id, ['pending', 'scheduled', 'retry_wait', 'paused'], {
        scheduled_at: parsedDate.toISOString(),
        timezone: resolvedTimezone,
        status: 'scheduled',
        acting_user_id: tenant.userId,
        paused: false,
      });
      if (!moved) {
        throw new AutopilotLifecycleError('PUBLICATION_IN_FLIGHT', `The ${ch} publication is already being published (${live.status}); it cannot be rescheduled now.`, 409);
      }
      createdPublications.push(moved);
      continue;
    }
    const pub: PublicationRecord = {
      id: randomUUID(),
      tenant_id: tenant.tenantId,
      content_item_id: item.id,
      channel: ch,
      social_account_id: accountId,
      platform_media_type: placementForItem(item, ch),
      slot_name: chosenSlot?.name || item.scheduled_slot?.slot_name || 'Custom Schedule Slot',
      timezone: resolvedTimezone,
      scheduled_at: parsedDate.toISOString(),
      status: 'scheduled',
      remote_post_id: null,
      error_message: null,
      retryable: false,
      acting_user_id: tenant.userId,
      publish_idempotency_key: `pub:${item.id}:${ch}:${accountId ?? 'default'}:v${item.version}:${randomUUID().slice(0, 8)}`,
      attempt_count: 0,
      published_at: null,
      created_at: now,
      updated_at: now,
    };
    await repo.savePublication(pub);
    createdPublications.push(pub);
  }

  item.scheduled_slot = {
    slot_id: chosenSlot?.id ?? item.scheduled_slot?.slot_id,
    slot_name: chosenSlot?.name ?? item.scheduled_slot?.slot_name ?? 'Scheduled',
    scheduled_at: parsedDate.toISOString(),
    timezone: resolvedTimezone,
  };
  item.lifecycle_state = 'scheduled';
  item.updated_at = now;

  // Calendar-visible `blog_posts` row marked social_only so ScheduleCalendar
  // shows it; scheduler.ts never publishes social_only rows. Media is listed by
  // asset ID only: delivery URLs are short-lived and derived at publish time.
  if (params.pool && params.hasDatabase?.()) {
    try {
      const blogId = item.linked_blog_post_id || randomUUID();
      const slug = `autopilot-${item.id.slice(0, 8)}-${Date.now().toString(36)}`;
      await params.pool.query(
        `INSERT INTO blog_posts (
           id, user_id, title, slug, excerpt, content, featured_image, status,
           scheduled_at, social_automation, source, approval_status, post_format,
           media_assets, video_url, tenant_id, autopilot_item_id, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'','scheduled',$7,$8::jsonb,'autopilot','approved','social_only',$9::jsonb,NULL,$10,$11,NOW(),NOW())
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           scheduled_at = EXCLUDED.scheduled_at,
           social_automation = EXCLUDED.social_automation,
           approval_status = 'approved',
           media_assets = EXCLUDED.media_assets,
           updated_at = NOW()`,
        [
          blogId,
          tenant.userId,
          item.title,
          slug,
          item.hook.slice(0, 220),
          item.caption,
          parsedDate.toISOString(),
          JSON.stringify({ enabled: true, platforms: targetChannels, managed_by: 'autopilot' }),
          JSON.stringify(publishableMediaEntries(item).map((m) => ({ asset_id: m.asset_id, type: m.type }))),
          tenant.tenantId,
          item.id,
        ],
      );
      item.linked_blog_post_id = blogId;
    } catch (err: any) {
      logger.warn({ err: err?.message, itemId: item.id }, 'autopilot_calendar_mirror_failed');
    }
  }

  await repo.saveContentItem(item);
  await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'item.scheduled', 'content_item', item.id, {
    scheduled_at: parsedDate.toISOString(),
    timezone: resolvedTimezone,
    channels: targetChannels,
    publication_ids: createdPublications.map((p) => p.id),
  });

  return { item, publications: createdPublications, timezone_note: timezoneNote };
}

// ── Publishing state machine ─────────────────────────────────────────────────

export interface PublishingDeps {
  repo: AutopilotRepository;
  publisherAdapter?: (input: SocialPublisherInput) => Promise<SocialPublisherResult>;
  stagedPublishers?: Record<string, StagedPublisher>;
  storage?: AssetStorageDriver | null;
  pool?: Pick<Pool, 'query'> | null;
  /** True when the acting user may still publish for this tenant. */
  authorizePublisher?: (tenantId: string, userId: string) => Promise<boolean>;
  workerId?: string;
  random?: () => number;
}

type Revalidation =
  | { ok: true; item: ContentItemRecord; payload: SocialPublisherInput }
  | { ok: false; code: string; message: string; disposition: 'defer' | 'fail' };

function defaultAuthorizePublisher(tenantId: string, userId: string): boolean {
  return tenantId === `user:${userId}` || tenantId.startsWith(`user:${userId}:`);
}

async function revalidate(deps: PublishingDeps, pub: PublicationRecord): Promise<Revalidation> {
  const { repo } = deps;
  if (isGlobalPublishingKilled()) return { ok: false, code: 'KILL_SWITCH_ACTIVE', message: 'Publishing is halted globally.', disposition: 'defer' };
  let controls;
  try {
    controls = await getTenantControls(deps.pool ?? null, pub.tenant_id, { failClosed: Boolean(deps.pool) });
  } catch {
    return { ok: false, code: 'CONTROLS_UNAVAILABLE', message: 'Workspace controls could not be read; not publishing.', disposition: 'defer' };
  }
  if (controls.kill_switch_publishing) return { ok: false, code: 'KILL_SWITCH_ACTIVE', message: 'Publishing is paused by the workspace kill switch.', disposition: 'defer' };

  const item = await repo.getContentItem(pub.tenant_id, pub.content_item_id);
  if (!item) return { ok: false, code: 'ITEM_NOT_FOUND', message: 'Parent content item no longer exists.', disposition: 'fail' };
  if (!item.approved_by) return { ok: false, code: 'UNAPPROVED_PUBLISH_BLOCKED', message: 'Approval was revoked or never recorded.', disposition: 'fail' };
  if (!['approved', 'scheduled', 'publishing', 'publish_failed', 'published'].includes(item.lifecycle_state)) {
    return { ok: false, code: 'UNAPPROVED_PUBLISH_BLOCKED', message: `Item is "${item.lifecycle_state}", not approved.`, disposition: 'fail' };
  }

  const actor = pub.acting_user_id;
  if (!actor) return { ok: false, code: 'NO_ACTING_USER', message: 'No user is recorded as the publisher; reschedule from the app.', disposition: 'fail' };
  const authorized = deps.authorizePublisher ? await deps.authorizePublisher(pub.tenant_id, actor) : defaultAuthorizePublisher(pub.tenant_id, actor);
  if (!authorized) return { ok: false, code: 'PUBLISHER_NOT_AUTHORIZED', message: 'The scheduling user no longer has publish rights in this workspace.', disposition: 'fail' };

  const cap = CHANNEL_FORMAT_CAPABILITY[pub.channel];
  if (!cap || !cap.formats.includes(pub.platform_media_type)) {
    return { ok: false, code: 'CHANNEL_FORMAT_UNSUPPORTED', message: `${pub.channel} ${pub.platform_media_type} is not supported. ${cap?.note ?? ''}`.trim(), disposition: 'fail' };
  }

  const report = await authoritativeReport(repo, pub.tenant_id, item);
  if (report && !report.passed) {
    const codes = report.issues.filter((i) => i.severity === 'blocker').map((i) => i.code);
    return { ok: false, code: 'QA_BLOCKED', message: `QA blockers: ${codes.join(', ')}`, disposition: 'fail' };
  }

  const entries = publishableMediaEntries(item);
  const assets = await repo.getAssetsByIds(pub.tenant_id, entries.map((m) => m.asset_id ?? '').filter(Boolean));
  const mediaAssets: SocialPublisherInput['mediaAssets'] = [];
  for (const m of entries) {
    const a = m.asset_id ? assets.get(m.asset_id) : null;
    if (!a || a.deleted_at || a.is_demo) return { ok: false, code: 'MEDIA_UNAVAILABLE', message: 'Media asset is missing, deleted or a demo render; regenerate it.', disposition: 'fail' };
    if (!deps.storage) return { ok: false, code: 'STORAGE_NOT_CONFIGURED', message: 'Asset storage is not configured.', disposition: 'defer' };
    const head = await deps.storage.head(a.storage_key).catch(() => undefined);
    if (head === undefined) return { ok: false, code: 'STORAGE_UNAVAILABLE', message: 'Asset storage could not be reached.', disposition: 'defer' };
    if (!head || head.bytes !== a.byte_size) return { ok: false, code: 'MEDIA_UNAVAILABLE', message: `Stored media for asset ${a.id} is missing or changed; regenerate it.`, disposition: 'fail' };
    mediaAssets.push({ url: deps.storage.deliveryUrl(a.storage_key, DELIVERY_URL_TTL_SECONDS), type: a.media_type, alt_text: m.alt_text, mime_type: a.mime_type });
  }
  if (!mediaAssets.length) return { ok: false, code: 'MEDIA_UNAVAILABLE', message: 'No publishable media.', disposition: 'fail' };

  const staged = cap.staged ? deps.stagedPublishers?.[pub.channel] : undefined;
  if (staged) {
    const acct = await staged.checkAccount(actor).catch((e: any) => ({ ok: false as const, code: 'ACCOUNT_CHECK_FAILED', message: e?.message || 'Account check failed' }));
    if (!acct.ok) return { ok: false, code: acct.code, message: acct.message, disposition: acct.code === 'ACCOUNT_CHECK_FAILED' ? 'defer' : 'fail' };
  }

  const variant = item.channel_variants?.[pub.channel];
  const caption = variant ? `${variant.caption}${variant.hashtags?.length ? `\n\n${variant.hashtags.join(' ')}` : ''}` : item.caption;
  return {
    ok: true,
    item,
    payload: {
      userId: actor,
      tenantId: pub.tenant_id,
      channel: pub.channel,
      socialAccountId: pub.social_account_id,
      title: item.title,
      caption,
      platformMediaType: pub.platform_media_type,
      mediaAssets,
      idempotencyKey: pub.publish_idempotency_key || `pub:${pub.id}`,
    },
  };
}

async function captionFor(deps: PublishingDeps, pub: PublicationRecord): Promise<string> {
  if (pub.platform_media_type === 'STORY') return '';
  const item = await deps.repo.getContentItem(pub.tenant_id, pub.content_item_id);
  if (!item) return '';
  const variant = item.channel_variants?.[pub.channel];
  return variant ? variant.caption : item.caption;
}

async function recordAttempt(repo: AutopilotRepository, pub: PublicationRecord, status: PublicationAttemptRecord['status'], meta: { error?: string | null; retryable?: boolean; nextRetryAt?: string | null; response?: Record<string, any> }) {
  const attempt: PublicationAttemptRecord = {
    id: randomUUID(),
    tenant_id: pub.tenant_id,
    publication_id: pub.id,
    idempotency_key: `${pub.publish_idempotency_key || `pub:${pub.id}`}:a${pub.attempt_count ?? 0}:${randomUUID().slice(0, 6)}`,
    attempt_number: pub.attempt_count ?? 0,
    status,
    request_meta: { channel: pub.channel, platform_media_type: pub.platform_media_type, container_id: pub.provider_container_id ?? null },
    response_meta: meta.response ?? {},
    error_message: meta.error ?? null,
    retryable: Boolean(meta.retryable),
    next_retry_at: meta.nextRetryAt ?? null,
    created_at: new Date().toISOString(),
  };
  await repo.savePublicationAttempt(attempt);
  return attempt;
}

async function syncItemState(repo: AutopilotRepository, tenantId: string, itemId: string) {
  const item = await repo.getContentItem(tenantId, itemId);
  if (!item) return null;
  const pubs = (await repo.listPublications(tenantId, itemId)).filter((p) => p.status !== 'cancelled');
  if (!pubs.length) return item;
  const next: ContentLifecycleState = pubs.every((p) => p.status === 'published')
    ? 'published'
    : pubs.some((p) => p.status === 'publish_failed' || p.status === 'reconciliation_required')
      ? 'publish_failed'
      : pubs.some((p) => ['claimed', 'submitting', 'remote_processing', 'publishing', 'retry_wait'].includes(p.status))
        ? 'publishing'
        : 'scheduled';
  if (item.lifecycle_state !== next) {
    item.lifecycle_state = next;
    item.updated_at = new Date().toISOString();
    await repo.saveContentItem(item);
  }
  return item;
}

async function move(
  deps: PublishingDeps,
  pub: PublicationRecord,
  from: string[],
  patch: Partial<PublicationRecord>,
  audit: { event: string; details?: Record<string, any> },
): Promise<PublicationRecord | null> {
  const moved = await deps.repo.transitionPublication(pub.tenant_id, pub.id, from, patch);
  if (moved) {
    await deps.repo.recordAudit(pub.tenant_id, pub.acting_user_id ?? null, 'publisher', `publication.${audit.event}`, 'publication', pub.id, {
      from: pub.status,
      to: moved.status,
      ...(audit.details ?? {}),
    });
  }
  return moved;
}

async function failOrRetry(deps: PublishingDeps, pub: PublicationRecord, from: string[], code: string, message: string, retryable: boolean) {
  const attempts = pub.attempt_count ?? 0;
  if (retryable && attempts < PUBLISH_MAX_ATTEMPTS) {
    const next = new Date(Date.now() + publishBackoffMs(attempts, deps.random)).toISOString();
    await recordAttempt(deps.repo, pub, 'failed_retryable', { error: message, retryable: true, nextRetryAt: next, response: { error_code: code } });
    return move(deps, pub, from, { status: 'retry_wait', next_attempt_at: next, error_code: code, error_message: message, retryable: true, lease_owner: null, lease_expires_at: null }, { event: 'retry_wait', details: { code, next_attempt_at: next } });
  }
  await recordAttempt(deps.repo, pub, 'failed_permanent', { error: message, retryable: false, response: { error_code: code } });
  if (retryable) logger.error({ publicationId: pub.id, code, attempts }, 'autopilot_publish_retries_exhausted');
  return move(deps, pub, from, { status: 'publish_failed', next_attempt_at: null, error_code: retryable ? 'RETRIES_EXHAUSTED' : code, error_message: message, retryable: false, lease_owner: null, lease_expires_at: null }, { event: 'failed', details: { code } });
}

async function markPublished(deps: PublishingDeps, pub: PublicationRecord, from: string[], mediaId: string, permalink: string | null, raw?: Record<string, any>) {
  await recordAttempt(deps.repo, pub, 'succeeded', { response: { remote_post_id: mediaId, permalink } });
  return move(deps, pub, from, {
    status: 'published',
    remote_post_id: mediaId,
    permalink,
    published_at: new Date().toISOString(),
    error_code: null,
    error_message: null,
    retryable: false,
    reconcile_required: false,
    next_attempt_at: null,
    lease_owner: null,
    lease_expires_at: null,
    provider_response: raw ? { last: raw } : pub.provider_response ?? {},
  }, { event: 'published', details: { remote_post_id: mediaId, permalink } });
}

async function needsReconciliation(deps: PublishingDeps, pub: PublicationRecord, from: string[], code: string, message: string, automatic: boolean) {
  await recordAttempt(deps.repo, pub, 'failed_permanent', { error: message, response: { error_code: code, reconciliation: true } });
  logger.warn({ publicationId: pub.id, code }, 'autopilot_publication_reconciliation_required');
  return move(deps, pub, from, {
    status: 'reconciliation_required',
    reconcile_required: true,
    error_code: code,
    error_message: message,
    next_attempt_at: automatic ? new Date(Date.now() + 60_000).toISOString() : null,
    lease_owner: null,
    lease_expires_at: null,
  }, { event: 'reconciliation_required', details: { code } });
}

/** Moves one leased publication forward by one or more steps. */
export async function advancePublication(deps: PublishingDeps, leased: PublicationRecord & { prior_status?: string }): Promise<PublicationRecord | null> {
  const prior = leased.prior_status ?? leased.status;
  let pub: PublicationRecord | null = leased;
  const staged = deps.stagedPublishers?.[leased.channel];
  const isStaged = Boolean(CHANNEL_FORMAT_CAPABILITY[leased.channel]?.staged && staged);

  // Crash recovery for rows whose lease expired mid-step.
  if (['claimed', 'submitting', 'publishing'].includes(prior)) {
    if (isStaged && leased.provider_container_id) {
      pub = await move(deps, leased, [leased.status], { status: 'remote_processing', next_attempt_at: new Date().toISOString() }, { event: 'resumed_processing' });
      if (!pub) return null;
      return advancePublication(deps, { ...pub, prior_status: 'remote_processing' });
    }
    if (prior !== 'claimed' && !isStaged) {
      // A one-shot submission may have posted before the crash.
      return needsReconciliation(deps, leased, [leased.status], 'LEASE_EXPIRED_DURING_SUBMIT', 'The worker stopped while submitting; check the account before retrying.', false);
    }
    // Claimed but never submitted, or an Instagram container that was never
    // published (unpublished containers cannot post on their own): safe to submit.
    if (leased.status !== 'claimed') {
      pub = await move(deps, leased, [leased.status], { status: 'claimed' }, { event: 'reclaimed_after_lease_expiry' });
      if (!pub) return null;
      leased = { ...pub, prior_status: 'claimed' };
    }
  }

  if (prior === 'reconciliation_required') {
    if (!isStaged || !leased.provider_container_id) return null;
    const st = await staged!.checkContainer(leased.acting_user_id ?? '', leased.provider_container_id);
    if (st.status === 'PUBLISHED') {
      const found = await staged!.findPublishedMedia(leased.acting_user_id ?? '', {
        containerId: leased.provider_container_id,
        caption: await captionFor(deps, leased),
        sinceIso: leased.submitted_at ?? leased.created_at,
      });
      if (found) return markPublished(deps, leased, ['reconciliation_required'], found.mediaId, found.permalink);
      const tries = (leased.provider_response as any)?.reconcile_tries ?? 0;
      return move(deps, leased, ['reconciliation_required'], {
        next_attempt_at: tries + 1 >= RECONCILE_MAX_ATTEMPTS ? null : new Date(Date.now() + 10 * 60_000).toISOString(),
        provider_response: { ...(leased.provider_response ?? {}), reconcile_tries: tries + 1 },
        error_message: 'Instagram reports the container as published but the post was not found yet; an operator should confirm it.',
      }, { event: 'reconcile_pending' });
    }
    if (st.status === 'FINISHED') {
      // Not published: the earlier publish call never took effect. Safe to publish now.
      pub = await move(deps, leased, ['reconciliation_required'], { status: 'remote_processing', reconcile_required: false, next_attempt_at: new Date().toISOString() }, { event: 'reconciled_not_published' });
      return pub ? advancePublication(deps, { ...pub, prior_status: 'remote_processing' }) : null;
    }
    if (st.status === 'EXPIRED' || st.status === 'ERROR') {
      return move(deps, leased, ['reconciliation_required'], { status: 'retry_wait', provider_container_id: null, reconcile_required: false, next_attempt_at: new Date().toISOString() }, { event: 'reconciled_container_dead' });
    }
    return move(deps, leased, ['reconciliation_required'], { next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString() }, { event: 'reconcile_deferred' });
  }

  if (prior === 'remote_processing') {
    return pollAndPublish(deps, leased, staged!);
  }

  // scheduled / pending / retry_wait / expired-claim: revalidate, then submit.
  const check = await revalidate(deps, leased);
  if (!check.ok) {
    if (check.disposition === 'defer') {
      return move(deps, leased, ['claimed'], {
        status: prior === 'retry_wait' ? 'retry_wait' : 'scheduled',
        next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        scheduled_at: prior === 'retry_wait' ? leased.scheduled_at : new Date(Date.now() + 5 * 60_000).toISOString(),
        error_code: check.code,
        error_message: check.message,
        lease_owner: null,
        lease_expires_at: null,
      }, { event: 'deferred', details: { code: check.code } });
    }
    await recordAttempt(deps.repo, leased, 'failed_permanent', { error: check.message, response: { error_code: check.code } });
    return move(deps, leased, ['claimed'], { status: 'publish_failed', error_code: check.code, error_message: check.message, retryable: false, lease_owner: null, lease_expires_at: null }, { event: 'blocked', details: { code: check.code } });
  }

  pub = await move(deps, leased, ['claimed'], { status: 'submitting', submitted_at: new Date().toISOString(), attempt_count: (leased.attempt_count ?? 0) + 1 }, { event: 'submitting' });
  if (!pub) return null;

  if (isStaged) {
    const created = await staged!.createContainer(check.payload).catch((e: any): StagedFailure => ({ ok: false, code: 'CONTAINER_CREATE_FAILED', message: e?.message || 'error', retryable: true, outcome: 'unknown' }));
    if (!created.ok) {
      // An unpublished container never posts, so even an unknown outcome here is safe to retry.
      return failOrRetry(deps, pub, ['submitting'], created.code, created.message, created.retryable || created.outcome === 'unknown');
    }
    const isVideo = check.payload.mediaAssets.some((m) => m.type === 'video');
    pub = await move(deps, pub, ['submitting'], {
      status: 'remote_processing',
      provider_container_id: created.containerId,
      processing_started_at: new Date().toISOString(),
      next_attempt_at: new Date(Date.now() + (isVideo ? 30_000 : 0)).toISOString(),
      lease_owner: null,
      lease_expires_at: null,
    }, { event: 'container_created', details: { container_id: created.containerId } });
    if (!pub || isVideo) return pub;
    return pollAndPublish(deps, pub, staged!);
  }

  if (!deps.publisherAdapter) {
    return failOrRetry(deps, pub, ['submitting'], 'NO_PUBLISHER', `No publisher is configured for ${pub.channel}.`, false);
  }
  try {
    const result = await deps.publisherAdapter(check.payload);
    const remoteId = String(result?.remotePostId ?? '').trim();
    if (!remoteId) {
      return needsReconciliation(deps, pub, ['submitting'], 'PUBLISHED_WITHOUT_ID', `${pub.channel} reported success without a post ID; confirm the post on the account.`, false);
    }
    return markPublished(deps, pub, ['submitting'], remoteId, result.url ?? null, result.raw);
  } catch (err) {
    const c = classifyPublishError(err);
    if (c.ambiguous) return needsReconciliation(deps, pub, ['submitting'], c.code, c.message, false);
    return failOrRetry(deps, pub, ['submitting'], c.code, `${c.message} (${c.remediation})`, c.retryable);
  }
}

async function pollAndPublish(deps: PublishingDeps, pub: PublicationRecord, staged: StagedPublisher): Promise<PublicationRecord | null> {
  const containerId = pub.provider_container_id;
  if (!containerId) return failOrRetry(deps, pub, [pub.status], 'CONTAINER_MISSING', 'No container recorded for a processing publication.', true);
  const user = pub.acting_user_id ?? '';
  const st = await staged.checkContainer(user, containerId).catch((): { status: ContainerStatus; detail?: string } => ({ status: 'UNKNOWN' }));
  const started = Date.parse(pub.processing_started_at ?? pub.updated_at);

  if (st.status === 'IN_PROGRESS' || st.status === 'UNKNOWN') {
    if (Date.now() - started > PROCESSING_TIMEOUT_MS) {
      return move(deps, pub, ['remote_processing'], { status: 'publish_failed', error_code: 'PROCESSING_TIMEOUT', error_message: 'Instagram did not finish processing the media in 30 minutes.', next_attempt_at: null, lease_owner: null, lease_expires_at: null }, { event: 'failed', details: { code: 'PROCESSING_TIMEOUT' } });
    }
    return move(deps, pub, ['remote_processing'], { next_attempt_at: new Date(Date.now() + 60_000).toISOString(), lease_owner: null, lease_expires_at: null }, { event: 'processing' });
  }
  if (st.status === 'ERROR') {
    return move(deps, pub, ['remote_processing'], { status: 'publish_failed', error_code: 'PLATFORM_PROCESSING_ERROR', error_message: `Instagram could not process the media${st.detail ? ` (${st.detail})` : ''}.`, next_attempt_at: null, lease_owner: null, lease_expires_at: null }, { event: 'failed', details: { code: 'PLATFORM_PROCESSING_ERROR' } });
  }
  if (st.status === 'EXPIRED') {
    return failOrRetry(deps, { ...pub, provider_container_id: null }, ['remote_processing'], 'CONTAINER_EXPIRED', 'The Instagram container expired before publishing.', true);
  }
  if (st.status === 'PUBLISHED') {
    // Published by an earlier call whose response was lost.
    const found = await staged.findPublishedMedia(user, { containerId, caption: await captionFor(deps, pub), sinceIso: pub.submitted_at ?? pub.created_at });
    if (found) return markPublished(deps, pub, ['remote_processing'], found.mediaId, found.permalink);
    return needsReconciliation(deps, pub, ['remote_processing'], 'PUBLISHED_ID_UNKNOWN', 'Instagram shows the container as published; looking up the post.', true);
  }

  // FINISHED: publish. Kill switches and approval are checked once more immediately before the side effect.
  const recheck = await revalidate(deps, pub);
  if (!recheck.ok) {
    if (recheck.disposition === 'defer') {
      return move(deps, pub, ['remote_processing'], { next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(), error_code: recheck.code, error_message: recheck.message, lease_owner: null, lease_expires_at: null }, { event: 'deferred', details: { code: recheck.code } });
    }
    return move(deps, pub, ['remote_processing'], { status: 'publish_failed', error_code: recheck.code, error_message: recheck.message, next_attempt_at: null, lease_owner: null, lease_expires_at: null }, { event: 'blocked', details: { code: recheck.code } });
  }
  const res = await staged.publishContainer(user, containerId).catch((e: any): StagedFailure => ({ ok: false, code: 'PUBLISH_OUTCOME_UNKNOWN', message: e?.message || 'error', retryable: false, outcome: 'unknown' }));
  if (res.ok) return markPublished(deps, pub, ['remote_processing'], res.mediaId, res.permalink);
  if (res.outcome === 'unknown') return needsReconciliation(deps, pub, ['remote_processing'], res.code, res.message, true);
  if (res.retryable && (pub.attempt_count ?? 0) < PUBLISH_MAX_ATTEMPTS) {
    const next = new Date(Date.now() + publishBackoffMs(pub.attempt_count ?? 1, deps.random)).toISOString();
    await recordAttempt(deps.repo, pub, 'failed_retryable', { error: res.message, retryable: true, nextRetryAt: next, response: { error_code: res.code } });
    // Keep the container: only the publish call is retried.
    return move(deps, pub, ['remote_processing'], { next_attempt_at: next, attempt_count: (pub.attempt_count ?? 0) + 1, error_code: res.code, error_message: res.message, lease_owner: null, lease_expires_at: null }, { event: 'publish_retry', details: { code: res.code } });
  }
  return failOrRetry(deps, pub, ['remote_processing'], res.code, res.message, false);
}

export async function processDueAutopilotPublications(params: PublishingDeps & { limit?: number }): Promise<{ processed: number; succeeded: number; failed: number }> {
  const workerId = params.workerId ?? `worker-${process.pid}-${randomUUID().slice(0, 6)}`;
  const leased = await params.repo.leaseDuePublications(workerId, params.limit ?? 10, LEASE_SECONDS);
  let succeeded = 0;
  let failed = 0;
  const touched = new Set<string>();
  for (const pub of leased) {
    try {
      const out = await advancePublication(params, pub);
      if (out?.status === 'published') succeeded++;
      else if (out && ['publish_failed', 'reconciliation_required'].includes(out.status)) failed++;
      touched.add(`${pub.tenant_id}\u0000${pub.content_item_id}`);
    } catch (err: any) {
      failed++;
      logger.error({ err: err?.message, publicationId: pub.id }, 'autopilot_publication_step_failed');
    }
  }
  for (const key of touched) {
    const [tenantId, itemId] = key.split('\u0000');
    await syncItemState(params.repo, tenantId, itemId).catch(() => {});
  }
  return { processed: leased.length, succeeded, failed };
}

/** User-initiated publish/retry: runs the same state machine for one row. */
export async function executePublication(params: PublishingDeps & {
  tenant: AutopilotTenantContext;
  publicationId: string;
  idempotencyKey?: string;
}): Promise<{ publication: PublicationRecord; attempt: PublicationAttemptRecord | null; item: ContentItemRecord; deduplicated: boolean }> {
  const { repo, tenant, publicationId } = params;

  if (!tenant.canPublish) {
    throw new AutopilotLifecycleError('PUBLISH_PERMISSION_DENIED', `Role "${tenant.userRole}" is not permitted to publish live social posts.`, 403);
  }

  const publication = await repo.getPublication(tenant.tenantId, publicationId);
  if (!publication) {
    throw new AutopilotLifecycleError('PUBLICATION_NOT_FOUND', 'Publication record not found in this workspace.', 404);
  }

  const business = await repo.getBusinessProfile(tenant.tenantId);
  if (business?.capacity.allowed_publisher_roles?.length && !business.capacity.allowed_publisher_roles.includes(tenant.userRole as any)) {
    throw new AutopilotLifecycleError('PUBLISH_ROLE_RESTRICTED', `Workspace policy restricts publishing to roles: ${business.capacity.allowed_publisher_roles.join(', ')}.`, 403);
  }

  const item = await repo.getContentItem(tenant.tenantId, publication.content_item_id);
  if (!item) throw new AutopilotLifecycleError('ITEM_NOT_FOUND', 'Parent content item not found.', 404);
  if (item.approval_required && !item.approved_by) {
    throw new AutopilotLifecycleError('UNAPPROVED_PUBLISH_BLOCKED', 'Cannot publish content item without recorded human approval.', 409);
  }

  const lastAttempt = async () => (await repo.listPublicationAttempts(tenant.tenantId, publication.id))[0] ?? null;

  if (publication.status === 'published') {
    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.deduplicated', 'publication', publication.id, {
      idempotency_key: params.idempotencyKey ?? publication.publish_idempotency_key,
      remote_post_id: publication.remote_post_id,
    });
    return { publication, attempt: await lastAttempt(), item, deduplicated: true };
  }
  if (publication.status === 'cancelled') {
    throw new AutopilotLifecycleError('PUBLICATION_CANCELLED', 'Cannot execute a cancelled publication.', 409);
  }
  if (publication.status === 'reconciliation_required') {
    throw new AutopilotLifecycleError('RECONCILIATION_REQUIRED', 'This post may already be live. Confirm it on the account (or resolve the reconciliation) before retrying.', 409, { remediation: 'POST /autopilot/publications/:id/reconcile' });
  }
  if ((publication.attempt_count ?? 0) >= PUBLISH_MAX_ATTEMPTS && publication.status === 'publish_failed') {
    throw new AutopilotLifecycleError('MAX_PUBLISH_RETRIES_EXCEEDED', `Maximum publish attempts (${PUBLISH_MAX_ATTEMPTS}) reached for this publication.`, 429);
  }

  // Claim it for this request (compare-and-set) with the requesting user as publisher.
  const claimable = ['pending', 'scheduled', 'retry_wait', 'publish_failed'];
  const claimed = await repo.transitionPublication(tenant.tenantId, publication.id, claimable, {
    status: 'claimed',
    acting_user_id: tenant.userId,
    lease_owner: `request-${randomUUID().slice(0, 8)}`,
    lease_expires_at: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(),
    error_code: null,
  });
  if (!claimed) {
    if (publication.status === 'remote_processing' && CHANNEL_FORMAT_CAPABILITY[publication.channel]?.staged) {
      const step = await advancePublication(params, { ...publication, prior_status: 'remote_processing' });
      const updated = await syncItemState(repo, tenant.tenantId, item.id);
      return { publication: step ?? publication, attempt: await lastAttempt(), item: updated ?? item, deduplicated: false };
    }
    throw new AutopilotLifecycleError('PUBLICATION_ALREADY_IN_PROGRESS', 'This publication is currently in progress or already published.', 409);
  }

  const prior = publication.status === 'publish_failed' ? 'retry_wait' : publication.status;
  const out = await advancePublication(params, { ...claimed, prior_status: prior });
  const updatedItem = await syncItemState(repo, tenant.tenantId, item.id);
  const fresh = (await repo.getPublication(tenant.tenantId, publication.id)) ?? out ?? claimed;
  return { publication: fresh, attempt: await lastAttempt(), item: updatedItem ?? item, deduplicated: false };
}

/**
 * Operator resolution of a publication whose outcome is unknown: either the
 * post exists (record its real ID and permalink) or it does not (allow a retry).
 */
export async function resolvePublicationReconciliation(params: {
  repo: AutopilotRepository;
  tenant: AutopilotTenantContext;
  publicationId: string;
  resolution: { posted: true; remotePostId: string; permalink?: string | null } | { posted: false };
}): Promise<PublicationRecord> {
  const { repo, tenant } = params;
  if (!tenant.canPublish) throw new AutopilotLifecycleError('PUBLISH_PERMISSION_DENIED', 'Admin or owner role required.', 403);
  const pub = await repo.getPublication(tenant.tenantId, params.publicationId);
  if (!pub) throw new AutopilotLifecycleError('PUBLICATION_NOT_FOUND', 'Publication not found.', 404);
  if (pub.status !== 'reconciliation_required') throw new AutopilotLifecycleError('NOT_IN_RECONCILIATION', `Publication is ${pub.status}.`, 409);
  const r = params.resolution;
  const patch: Partial<PublicationRecord> = r.posted
    ? { status: 'published', remote_post_id: r.remotePostId.trim(), permalink: r.permalink ?? null, published_at: new Date().toISOString(), reconcile_required: false, error_code: null, error_message: null, next_attempt_at: null }
    : { status: 'retry_wait', provider_container_id: null, reconcile_required: false, next_attempt_at: new Date().toISOString(), error_code: 'RECONCILED_NOT_POSTED' };
  if (r.posted && !r.remotePostId.trim()) throw new AutopilotLifecycleError('REMOTE_ID_REQUIRED', 'Give the post ID shown on the platform.', 400);
  const moved = await repo.transitionPublication(tenant.tenantId, pub.id, ['reconciliation_required'], patch);
  if (!moved) throw new AutopilotLifecycleError('CONCURRENT_UPDATE', 'Publication changed; reload and try again.', 409);
  await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.reconciled', 'publication', pub.id, { posted: r.posted, remote_post_id: r.posted ? r.remotePostId : null });
  await syncItemState(repo, tenant.tenantId, pub.content_item_id);
  return moved;
}

export async function cancelPublication(repo: AutopilotRepository, tenant: AutopilotTenantContext, publicationId: string): Promise<PublicationRecord> {
  const pub = await repo.getPublication(tenant.tenantId, publicationId);
  if (!pub) throw new AutopilotLifecycleError('PUBLICATION_NOT_FOUND', 'Publication not found.', 404);
  if (pub.status === 'published') {
    throw new AutopilotLifecycleError('ALREADY_PUBLISHED', 'This post is live. Cancelling here would not remove it from the platform; delete it there.', 409);
  }
  // An Instagram container in processing has not posted, so cancelling it is real.
  const moved = await repo.transitionPublication(tenant.tenantId, pub.id, ['pending', 'scheduled', 'retry_wait', 'publish_failed', 'remote_processing'], {
    status: 'cancelled', next_attempt_at: null, lease_owner: null, lease_expires_at: null,
  });
  if (!moved) {
    throw new AutopilotLifecycleError('PUBLICATION_IN_FLIGHT', `Cannot cancel while the publication is ${pub.status}; it may already be posting.`, 409);
  }
  await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.cancelled', 'publication', pub.id, { from: pub.status });
  await syncItemState(repo, tenant.tenantId, pub.content_item_id);
  return moved;
}

export async function pausePublication(
  repo: AutopilotRepository,
  tenant: AutopilotTenantContext,
  publicationId: string,
): Promise<PublicationRecord> {
  const pub = await repo.getPublication(tenant.tenantId, publicationId);
  if (!pub) {
    throw new AutopilotLifecycleError('PUBLICATION_NOT_FOUND', 'Publication not found.', 404);
  }
  const moved = await repo.transitionPublication(tenant.tenantId, pub.id, ['pending', 'scheduled', 'retry_wait', 'publish_failed'], { paused: true });
  if (!moved) {
    throw new AutopilotLifecycleError('CANNOT_PAUSE_ACTIVE', `Cannot pause a publication that is ${pub.status}.`, 400);
  }
  await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.paused', 'publication', pub.id, {});
  return moved;
}

export async function resumePublication(
  repo: AutopilotRepository,
  tenant: AutopilotTenantContext,
  publicationId: string,
): Promise<PublicationRecord> {
  const pub = await repo.getPublication(tenant.tenantId, publicationId);
  if (!pub) {
    throw new AutopilotLifecycleError('PUBLICATION_NOT_FOUND', 'Publication not found.', 404);
  }
  const moved = await repo.transitionPublication(tenant.tenantId, pub.id, [pub.status], { paused: false });
  if (!moved) throw new AutopilotLifecycleError('CONCURRENT_UPDATE', 'Publication changed; reload and try again.', 409);
  await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.resumed', 'publication', pub.id, {});
  return moved;
}

export async function reschedulePublication(
  repo: AutopilotRepository,
  tenant: AutopilotTenantContext,
  publicationId: string,
  newScheduledAtIso: string,
  opts: { timezone?: string; scheduledLocal?: string; now?: Date } = {},
): Promise<PublicationRecord> {
  if (!tenant.canPublish) throw new AutopilotLifecycleError('SCHEDULE_PERMISSION_DENIED', 'Admin or owner role required to reschedule.', 403);
  const pub = await repo.getPublication(tenant.tenantId, publicationId);
  if (!pub) {
    throw new AutopilotLifecycleError('PUBLICATION_NOT_FOUND', 'Publication not found.', 404);
  }
  const tz = opts.timezone || pub.timezone || 'UTC';
  if (!isValidIanaTimezone(tz)) throw new AutopilotLifecycleError('INVALID_TIMEZONE', `"${tz}" is not an IANA timezone.`, 400);
  const iso = opts.scheduledLocal ? zonedLocalToUtc(opts.scheduledLocal, tz).iso : newScheduledAtIso;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new AutopilotLifecycleError('INVALID_DATE', 'Invalid scheduled_at ISO timestamp.', 400);
  }
  if (date.getTime() < (opts.now ?? new Date()).getTime() - 60_000) {
    throw new AutopilotLifecycleError('SCHEDULE_IN_PAST', 'scheduled_at is in the past.', 400);
  }
  const moved = await repo.transitionPublication(tenant.tenantId, pub.id, ['pending', 'scheduled', 'retry_wait', 'publish_failed'], {
    scheduled_at: date.toISOString(),
    timezone: tz,
    status: 'scheduled',
    paused: false,
    acting_user_id: tenant.userId,
    next_attempt_at: null,
  });
  if (!moved) {
    throw new AutopilotLifecycleError('CANNOT_RESCHEDULE_ACTIVE', `Cannot reschedule a publication that is ${pub.status}.`, 400);
  }
  await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.rescheduled', 'publication', pub.id, {
    new_scheduled_at: moved.scheduled_at,
    timezone: tz,
  });
  return moved;
}
