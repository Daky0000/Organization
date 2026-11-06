import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type { AutopilotRepository } from './repository.ts';
import type { AutopilotTenantContext } from './tenantContext.ts';
import { validateAutopilotContentItem } from './validationAndPolicyService.ts';
import { createCreativeBriefForItem } from './creativeBriefAndRouter.ts';
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
  mediaAssets: Array<{ url: string; type: 'image' | 'video'; alt_text?: string }>;
  idempotencyKey: string;
}

export interface SocialPublisherResult {
  remotePostId: string;
  url?: string;
  raw?: Record<string, any>;
}

export function classifyPublishError(err: unknown): {
  retryable: boolean;
  code: string;
  message: string;
  remediation: string;
} {
  const status = Number((err as any)?.status || (err as any)?.response?.status || 0);
  const rawMsg = String((err as any)?.response?.data?.error?.message || (err as any)?.message || err || 'Unknown publish failure');
  const lower = rawMsg.toLowerCase();

  if (
    status === 401 ||
    status === 403 ||
    /\b(token|oauth|unauthorized|forbidden|revoked|expired|re-authorize|scope|permission)\b/.test(lower)
  ) {
    return {
      retryable: false,
      code: 'AUTH_OR_PERMISSION_ERROR',
      message: rawMsg,
      remediation: 'Reconnect or refresh the social account OAuth token in Connected Accounts before retrying.',
    };
  }

  if (
    status === 400 ||
    status === 422 ||
    /\b(invalid\s+media|aspect\s+ratio|public\s+http|unsupported|character\s+limit|carousel\s+requires)\b/.test(lower)
  ) {
    return {
      retryable: false,
      code: 'INVALID_PAYLOAD_OR_MEDIA',
      message: rawMsg,
      remediation: 'Fix the media URL/aspect ratio or caption format in the Creative Queue, re-validate, and republish.',
    };
  }

  if (
    status === 429 ||
    (status >= 500 && status <= 599) ||
    /\b(rate\s*limit|too\s+many\s+requests|timeout|etimedout|econnreset|eai_again|temporarily\s+unavailable|502|503|504)\b/.test(lower)
  ) {
    return {
      retryable: true,
      code: status === 429 ? 'PLATFORM_RATE_LIMITED' : 'TRANSIENT_UPSTREAM_FAILURE',
      message: rawMsg,
      remediation: 'Transient platform or network issue detected; safe to retry with idempotency protection.',
    };
  }

  return {
    retryable: false,
    code: 'PERMANENT_PUBLISH_ERROR',
    message: rawMsg,
    remediation: 'Inspect platform response details and verify account configuration before retrying.',
  };
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
      throw new AutopilotLifecycleError(
        'APPROVAL_PERMISSION_DENIED',
        `Role "${tenant.userRole}" cannot approve content items; admin or owner role required.`,
        403,
      );
    }

    // Ensure QA/Policy gates have run and passed with zero blockers before approval
    const business = await repo.getBusinessProfile(tenant.tenantId);
    const brand = await repo.getBrandProfile(tenant.tenantId);
    if (business) {
      let brief = await repo.getCreativeBrief(tenant.tenantId, item.id);
      if (!brief) {
        brief = createCreativeBriefForItem({ item, business, brand });
        await repo.saveCreativeBrief(brief);
      }
      const referencedAssets = [];
      for (const refId of brief.reference_asset_ids) {
        const asset = await repo.getBrandAssetById(tenant.tenantId, refId);
        if (asset) referencedAssets.push(asset);
      }

      const cachedFailed =
        item.validation_report &&
        item.validation_report.passed === false
          ? item.validation_report
          : null;

      const report =
        cachedFailed ??
        validateAutopilotContentItem({ item, brief, business, brand, referencedAssets });
      item.validation_report = report;

      if (!report.passed) {
        const blockers = (report.issues ?? []).filter((i: any) => i.severity === 'blocker');
        throw new AutopilotLifecycleError(
          'VALIDATION_BLOCKER_UNRESOLVED',
          `Cannot approve content item with ${blockers.length} unresolved policy/QA blocker(s): ${blockers.map((b: any) => b.code).join(', ')}.`,
          422,
          { validation_report: report },
        );
      }
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
  slotId?: string;
  timezone?: string;
  channels?: string[];
  socialAccountMap?: Record<string, string>;
  allowBlackoutOverride?: boolean;
}): Promise<{ item: ContentItemRecord; publications: PublicationRecord[] }> {
  const { repo, tenant, itemId } = params;
  const item = await repo.getContentItem(tenant.tenantId, itemId);
  if (!item) {
    throw new AutopilotLifecycleError('ITEM_NOT_FOUND', 'Content item not found in this workspace.', 404);
  }

  const business = await repo.getBusinessProfile(tenant.tenantId);

  // Enforce approval gate before scheduling
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

  const slots: NamedScheduleSlot[] = business?.schedule_config?.named_slots ?? [];
  const chosenSlot = params.slotId ? slots.find((s) => s.id === params.slotId) : undefined;

  const resolvedScheduledIso =
    params.scheduledAt ||
    item.scheduled_slot?.scheduled_at ||
    new Date(Date.now() + 3600_000).toISOString();

  const parsedDate = new Date(resolvedScheduledIso);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new AutopilotLifecycleError('INVALID_SCHEDULE_DATE', 'Invalid scheduled_at ISO timestamp.', 400);
  }

  const dateKey = parsedDate.toISOString().slice(0, 10);
  const blackoutSet = new Set(business?.schedule_config?.blackout_dates ?? []);
  if (blackoutSet.has(dateKey) && !params.allowBlackoutOverride) {
    throw new AutopilotLifecycleError(
      'BLACKOUT_WINDOW_CONFLICT',
      `Requested date ${dateKey} falls inside a configured workspace blackout window.`,
      409,
      { blackoutDate: dateKey },
    );
  }

  const resolvedTimezone =
    params.timezone ||
    chosenSlot?.timezone ||
    item.scheduled_slot?.timezone ||
    business?.schedule_config?.timezone ||
    'UTC';

  const targetChannels = (params.channels?.length ? params.channels : item.target_channels).filter(Boolean);
  if (!targetChannels.length) {
    throw new AutopilotLifecycleError('NO_TARGET_CHANNELS', 'Select at least one target channel to schedule.', 400);
  }

  const now = new Date().toISOString();
  const createdPublications: PublicationRecord[] = [];

  for (const ch of targetChannels) {
    const variantMediaType =
      item.channel_variants?.[ch]?.media_type ||
      (item.format === 'carousel'
        ? 'CAROUSEL'
        : item.format === 'short_video' || item.format === 'product_demo'
          ? 'REEL'
          : item.format === 'story'
            ? 'STORY'
            : 'FEED_POST');

    const pub: PublicationRecord = {
      id: randomUUID(),
      tenant_id: tenant.tenantId,
      content_item_id: item.id,
      channel: ch.toLowerCase(),
      social_account_id: params.socialAccountMap?.[ch] ?? null,
      platform_media_type: variantMediaType,
      slot_name: chosenSlot?.name || item.scheduled_slot?.slot_name || 'Custom Schedule Slot',
      timezone: resolvedTimezone,
      scheduled_at: parsedDate.toISOString(),
      status: 'scheduled',
      remote_post_id: null,
      error_message: null,
      retryable: false,
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

  // Materialize a calendar-visible `blog_posts` row marked `social_only` + `approved` when DB is active
  // so `ScheduleCalendar.tsx` displays it while `scheduler.ts` never auto-publishes it as a blog article!
  if (params.pool && params.hasDatabase?.()) {
    try {
      const blogId = item.linked_blog_post_id || randomUUID();
      const slug = `autopilot-${item.id.slice(0, 8)}-${Date.now().toString(36)}`;
      const coverImg = item.media_assets.find((m) => m.type === 'image')?.url ?? null;
      const videoUrl = item.media_assets.find((m) => m.type === 'video')?.url ?? null;
      await params.pool.query(
        `INSERT INTO blog_posts (
           id, user_id, title, slug, excerpt, content, featured_image, status,
           scheduled_at, social_automation, source, approval_status, post_format,
           media_assets, video_url, tenant_id, autopilot_item_id, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8,$9::jsonb,'autopilot','approved','social_only',$10::jsonb,$11,$12,$13,NOW(),NOW())
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           scheduled_at = EXCLUDED.scheduled_at,
           social_automation = EXCLUDED.social_automation,
           approval_status = 'approved',
           media_assets = EXCLUDED.media_assets,
           video_url = EXCLUDED.video_url,
           updated_at = NOW()`,
        [
          blogId,
          tenant.userId,
          item.title,
          slug,
          item.hook.slice(0, 220),
          item.caption,
          coverImg || '',
          parsedDate.toISOString(),
          JSON.stringify({ enabled: true, platforms: targetChannels, managed_by: 'autopilot' }),
          JSON.stringify(item.media_assets),
          videoUrl,
          tenant.tenantId,
          item.id,
        ],
      );
      item.linked_blog_post_id = blogId;
    } catch {
      // Non-fatal in mock/partial DB environments
    }
  }

  await repo.saveContentItem(item);
  await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'item.scheduled', 'content_item', item.id, {
    scheduled_at: parsedDate.toISOString(),
    timezone: resolvedTimezone,
    channels: targetChannels,
    publication_ids: createdPublications.map((p) => p.id),
  });

  return { item, publications: createdPublications };
}

export async function executePublication(params: {
  repo: AutopilotRepository;
  tenant: AutopilotTenantContext;
  publicationId: string;
  idempotencyKey?: string;
  publisherAdapter: (input: SocialPublisherInput) => Promise<SocialPublisherResult>;
}): Promise<{
  publication: PublicationRecord;
  attempt: PublicationAttemptRecord;
  item: ContentItemRecord;
  deduplicated: boolean;
}> {
  const { repo, tenant, publicationId, publisherAdapter } = params;

  if (!tenant.canPublish) {
    throw new AutopilotLifecycleError(
      'PUBLISH_PERMISSION_DENIED',
      `Role "${tenant.userRole}" is not permitted to publish live social posts.`,
      403,
    );
  }

  const publication = await repo.getPublication(tenant.tenantId, publicationId);
  if (!publication) {
    throw new AutopilotLifecycleError('PUBLICATION_NOT_FOUND', 'Publication record not found in this workspace.', 404);
  }

  const business = await repo.getBusinessProfile(tenant.tenantId);
  if (
    business?.capacity.allowed_publisher_roles?.length &&
    !business.capacity.allowed_publisher_roles.includes(tenant.userRole as any)
  ) {
    throw new AutopilotLifecycleError(
      'PUBLISH_ROLE_RESTRICTED',
      `Workspace policy restricts publishing to roles: ${business.capacity.allowed_publisher_roles.join(', ')}.`,
      403,
    );
  }

  const item = await repo.getContentItem(tenant.tenantId, publication.content_item_id);
  if (!item) {
    throw new AutopilotLifecycleError('ITEM_NOT_FOUND', 'Parent content item not found.', 404);
  }

  if (item.approval_required && !item.approved_by) {
    throw new AutopilotLifecycleError(
      'UNAPPROVED_PUBLISH_BLOCKED',
      'Cannot publish content item without recorded human approval.',
      409,
    );
  }

  if (item.validation_report?.passed === false) {
    throw new AutopilotLifecycleError(
      'FAILED_VALIDATION_PUBLISH_BLOCKED',
      'Cannot publish content item with failing QA/policy validation.',
      422,
    );
  }

  const priorAttempts = await repo.listPublicationAttempts(tenant.tenantId, publication.id);

  // 1. Idempotency Guard: If caller key already succeeded OR publication already succeeded, never re-post!
  if (params.idempotencyKey) {
    const existingByKey = await repo.findAttemptByIdempotencyKey(tenant.tenantId, params.idempotencyKey);
    if (existingByKey && existingByKey.status === 'succeeded') {
      await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.deduplicated', 'publication', publication.id, {
        idempotency_key: params.idempotencyKey,
        remote_post_id: publication.remote_post_id,
      });
      return { publication, attempt: existingByKey, item, deduplicated: true };
    }
  }

  const priorSucceeded = priorAttempts.find((a) => a.status === 'succeeded');
  if (publication.status === 'published' && priorSucceeded) {
    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.deduplicated', 'publication', publication.id, {
      idempotency_key: priorSucceeded.idempotency_key,
      remote_post_id: publication.remote_post_id,
    });
    return { publication, attempt: priorSucceeded, item, deduplicated: true };
  }

  if (publication.status === 'cancelled') {
    throw new AutopilotLifecycleError('PUBLICATION_CANCELLED', 'Cannot execute a cancelled publication.', 409);
  }

  const attemptNumber = priorAttempts.length + 1;
  if (attemptNumber > 4) {
    throw new AutopilotLifecycleError(
      'MAX_PUBLISH_RETRIES_EXCEEDED',
      'Maximum publish retry attempts (4) reached for this publication.',
      429,
    );
  }

  // Construct unique per-attempt key while preserving caller key on first attempt
  const baseKey = params.idempotencyKey || `pub:${publication.id}:v${item.version}`;
  const existingKeyCollision = await repo.findAttemptByIdempotencyKey(tenant.tenantId, baseKey);
  const attemptIdempotencyKey = existingKeyCollision ? `${baseKey}:attempt:${attemptNumber}` : baseKey;

  // Mark publishing in progress via atomic claim lock
  const claimed = await repo.claimPublicationForExecution(tenant.tenantId, publication.id);
  if (!claimed && publication.status !== 'publishing') {
    throw new AutopilotLifecycleError(
      'PUBLICATION_ALREADY_IN_PROGRESS',
      'This publication is currently in progress or already published.',
      409,
    );
  }
  publication.status = 'publishing';
  publication.updated_at = new Date().toISOString();

  if (item.lifecycle_state === 'approved' || item.lifecycle_state === 'scheduled' || item.lifecycle_state === 'publish_failed') {
    item.lifecycle_state = 'publishing';
    item.updated_at = publication.updated_at;
    await repo.saveContentItem(item);
  }

  const variant = item.channel_variants?.[publication.channel];
  const captionToPublish = variant
    ? `${variant.caption}${variant.hashtags?.length ? `\n\n${variant.hashtags.join(' ')}` : ''}`
    : item.caption;

  try {
    const result = await publisherAdapter({
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      channel: publication.channel,
      socialAccountId: publication.social_account_id,
      title: item.title,
      caption: captionToPublish,
      platformMediaType: publication.platform_media_type,
      mediaAssets: item.media_assets,
      idempotencyKey: attemptIdempotencyKey,
    });

    const publishedAt = new Date().toISOString();
    const attempt: PublicationAttemptRecord = {
      id: randomUUID(),
      tenant_id: tenant.tenantId,
      publication_id: publication.id,
      idempotency_key: attemptIdempotencyKey,
      attempt_number: attemptNumber,
      status: 'succeeded',
      request_meta: {
        channel: publication.channel,
        platform_media_type: publication.platform_media_type,
        media_count: item.media_assets.length,
      },
      response_meta: {
        remote_post_id: result.remotePostId,
        url: result.url ?? null,
      },
      error_message: null,
      retryable: false,
      next_retry_at: null,
      created_at: publishedAt,
    };
    await repo.savePublicationAttempt(attempt);

    publication.status = 'published';
    publication.remote_post_id = result.remotePostId;
    publication.error_message = null;
    publication.retryable = false;
    publication.published_at = publishedAt;
    publication.updated_at = publishedAt;
    await repo.savePublication(publication);

    // Check if all active publications for this item are published
    const allPubs = await repo.listPublications(tenant.tenantId, item.id);
    const activePubs = allPubs.filter((p) => p.status !== 'cancelled');
    const allDone = activePubs.length > 0 && activePubs.every((p) => p.status === 'published');
    item.lifecycle_state = allDone ? 'published' : 'scheduled';
    item.updated_at = publishedAt;
    await repo.saveContentItem(item);

    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.succeeded', 'publication', publication.id, {
      channel: publication.channel,
      remote_post_id: result.remotePostId,
      attempt_number: attemptNumber,
      idempotency_key: attemptIdempotencyKey,
    });

    return { publication, attempt, item, deduplicated: false };
  } catch (err: any) {
    const classified = classifyPublishError(err);
    const failedAt = new Date().toISOString();
    const backoffMs = classified.retryable ? 30_000 * Math.pow(2, attemptNumber - 1) : 0;
    const nextRetryAt = classified.retryable && attemptNumber < 4
      ? new Date(Date.now() + backoffMs).toISOString()
      : null;

    const attempt: PublicationAttemptRecord = {
      id: randomUUID(),
      tenant_id: tenant.tenantId,
      publication_id: publication.id,
      idempotency_key: attemptIdempotencyKey,
      attempt_number: attemptNumber,
      status: classified.retryable ? 'failed_retryable' : 'failed_permanent',
      request_meta: {
        channel: publication.channel,
        platform_media_type: publication.platform_media_type,
      },
      response_meta: {
        error_code: classified.code,
        remediation: classified.remediation,
      },
      error_message: classified.message,
      retryable: classified.retryable,
      next_retry_at: nextRetryAt,
      created_at: failedAt,
    };
    await repo.savePublicationAttempt(attempt);

    publication.status = 'publish_failed';
    publication.error_message = `${classified.message} (${classified.remediation})`;
    publication.retryable = classified.retryable;
    publication.updated_at = failedAt;
    await repo.savePublication(publication);

    item.lifecycle_state = 'publish_failed';
    item.updated_at = failedAt;
    await repo.saveContentItem(item);

    await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.failed', 'publication', publication.id, {
      channel: publication.channel,
      attempt_number: attemptNumber,
      retryable: classified.retryable,
      code: classified.code,
      error: classified.message,
      next_retry_at: nextRetryAt,
    });

    return { publication, attempt, item, deduplicated: false };
  }
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
  if (pub.status === 'published' || pub.status === 'publishing') {
    throw new AutopilotLifecycleError('CANNOT_PAUSE_ACTIVE', 'Cannot pause a publication that is already publishing or published.', 400);
  }
  pub.paused = true;
  pub.updated_at = new Date().toISOString();
  await repo.savePublication(pub);
  await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.paused', 'publication', pub.id, {});
  return pub;
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
  pub.paused = false;
  pub.updated_at = new Date().toISOString();
  await repo.savePublication(pub);
  await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.resumed', 'publication', pub.id, {});
  return pub;
}

export async function reschedulePublication(
  repo: AutopilotRepository,
  tenant: AutopilotTenantContext,
  publicationId: string,
  newScheduledAtIso: string,
): Promise<PublicationRecord> {
  const pub = await repo.getPublication(tenant.tenantId, publicationId);
  if (!pub) {
    throw new AutopilotLifecycleError('PUBLICATION_NOT_FOUND', 'Publication not found.', 404);
  }
  if (pub.status === 'published' || pub.status === 'publishing') {
    throw new AutopilotLifecycleError('CANNOT_RESCHEDULE_ACTIVE', 'Cannot reschedule an in-progress or completed publication.', 400);
  }
  const date = new Date(newScheduledAtIso);
  if (Number.isNaN(date.getTime())) {
    throw new AutopilotLifecycleError('INVALID_DATE', 'Invalid scheduled_at ISO timestamp.', 400);
  }
  pub.scheduled_at = date.toISOString();
  pub.status = 'scheduled';
  pub.paused = false;
  pub.updated_at = new Date().toISOString();
  await repo.savePublication(pub);
  await repo.recordAudit(tenant.tenantId, tenant.userId, tenant.userRole, 'publication.rescheduled', 'publication', pub.id, {
    new_scheduled_at: pub.scheduled_at,
  });
  return pub;
}

export async function processDueAutopilotPublications(params: {
  repo: AutopilotRepository;
  publisherAdapter: (input: SocialPublisherInput) => Promise<SocialPublisherResult>;
  limit?: number;
}): Promise<{ processed: number; succeeded: number; failed: number }> {
  const { repo, publisherAdapter, limit = 10 } = params;
  const due = await repo.listDuePublications(limit);
  let succeeded = 0;
  let failed = 0;

  for (const pub of due) {
    try {
      const tenant: AutopilotTenantContext = {
        tenantId: pub.tenant_id,
        orgId: null,
        projectId: null,
        userId: 'system_autopilot_worker',
        userRole: 'owner',
        canEdit: true,
        canApprove: true,
        canPublish: true,
        correlationId: `worker-${pub.id}`,
      };

      const res = await executePublication({
        repo,
        tenant,
        publicationId: pub.id,
        publisherAdapter,
      });

      if (res.publication.status === 'published') {
        succeeded++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { processed: due.length, succeeded, failed };
}
