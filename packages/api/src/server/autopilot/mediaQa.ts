import type { ContentItemRecord, ValidationIssue, ValidationReport } from './types.ts';
import { isForbiddenMediaUrl, type AutopilotAssetRecord } from './assetPipeline.ts';

// Media and platform publishability checks. Run after generation, again at
// approval, and again immediately before publishing (assets can be deleted and
// delivery can break between those moments).
//
// Instagram limits: developers.facebook.com/docs/instagram-platform/content-publishing
// and .../instagram-graph-api/reference/ig-user/media, checked 2026-10-29.
export const INSTAGRAM_MEDIA_LIMITS = {
  source: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media',
  verified_at: '2026-10-29',
  imageMime: 'image/jpeg',
  imageMaxBytes: 8 * 1024 * 1024,
  feedAspectMin: 4 / 5,
  feedAspectMax: 1.91,
  carouselMin: 2,
  carouselMax: 20,
  videoCodecs: ['avc1', 'avc3', 'hvc1', 'hev1'],
  videoMimes: ['video/mp4', 'video/quicktime'],
  videoMaxWidth: 1920,
  reelMinMs: 3_000,
  reelMaxMs: 15 * 60_000,
  reelMaxBytes: 300 * 1024 * 1024,
  reelAspectMin: 0.01,
  reelAspectMax: 10,
  storyVideoMaxMs: 60_000,
  storyVideoMaxBytes: 100 * 1024 * 1024,
  storyAspectMin: 0.1,
  storyAspectMax: 10,
} as const;

export type PlacementType = 'FEED_POST' | 'CAROUSEL' | 'REEL' | 'STORY';

function issue(code: string, message: string, remediation: string, severity: ValidationIssue['severity'] = 'blocker', gate: ValidationIssue['gate'] = 'platform_format'): ValidationIssue {
  return { gate, severity, code, message, remediation };
}

export function placementForItem(item: ContentItemRecord, channel?: string): PlacementType {
  const variant = channel ? item.channel_variants?.[channel]?.media_type : undefined;
  if (variant) return variant;
  return item.format === 'carousel' ? 'CAROUSEL'
    : item.format === 'short_video' || item.format === 'product_demo' ? 'REEL'
    : item.format === 'story' ? 'STORY'
    : 'FEED_POST';
}

/**
 * The publishable media of an item, in order. Scene clips of an unassembled
 * multi-scene video are not publishable media on their own.
 */
export function publishableMediaEntries(item: ContentItemRecord) {
  return (item.media_assets ?? []).filter((m: any) => m.role !== 'scene_clip');
}

export function evaluateMediaPublishability(params: {
  item: ContentItemRecord;
  assets: Map<string, AutopilotAssetRecord | null>;
  channels: string[];
  requireDeliveryVerified?: boolean;
}): ValidationIssue[] {
  const { item, assets } = params;
  const out: ValidationIssue[] = [];
  const entries = publishableMediaEntries(item);

  if (entries.length === 0) {
    const clips = (item.media_assets ?? []).filter((m: any) => m.role === 'scene_clip').length;
    out.push(clips > 1
      ? issue('REEL_NOT_ASSEMBLED', `This video has ${clips} separate scene clips and no single master file; platforms need one video.`, 'Generate a single-scene reel, or upload an edited master video as a brand asset and regenerate.')
      : issue('MEDIA_MISSING', 'No publishable media is attached to this item.', 'Generate the visual again, or attach a real asset.'));
  }

  for (const [i, m] of entries.entries()) {
    const assetId = (m as any).asset_id as string | undefined;
    const label = `Media ${i + 1}`;
    if (!assetId) {
      out.push(issue('MEDIA_NOT_DURABLE', `${label} is not a stored asset${isForbiddenMediaUrl(m.url) ? ' (it is an empty, inline or local-only URL)' : ''}.`, 'Regenerate the item so its media is stored and verified.', 'blocker', 'brand_compliance'));
      continue;
    }
    const asset = assets.get(assetId) ?? null;
    if (!asset || asset.deleted_at || asset.tenant_id !== item.tenant_id) {
      out.push(issue('ASSET_NOT_FOUND', `${label} (asset ${assetId}) is missing, deleted or not in this workspace.`, 'Regenerate the media or re-attach an asset from this workspace.'));
      continue;
    }
    if (asset.is_demo) {
      out.push(issue('DEMO_ASSET_NOT_PUBLISHABLE', `${label} is a DEMO — NOT PUBLISHABLE sandbox render.`, 'Regenerate with a live provider; demo assets can never be published.'));
    }
    if ((params.requireDeliveryVerified ?? true) && !asset.delivery_verified_at) {
      out.push(issue('ASSET_DELIVERY_UNVERIFIED', `${label} has not been confirmed fetchable from outside the app${asset.delivery_error ? ` (${asset.delivery_error})` : ''}.`, 'Use "Verify delivery" on the asset; check the storage bucket is reachable over HTTPS.'));
    }
  }

  const resolved = entries
    .map((m: any) => (m.asset_id ? assets.get(m.asset_id) ?? null : null))
    .filter((a): a is AutopilotAssetRecord => Boolean(a && !a.deleted_at));

  for (const channel of params.channels.map((c) => c.toLowerCase())) {
    if (channel !== 'instagram') continue;
    const placement = placementForItem(item, channel);
    const L = INSTAGRAM_MEDIA_LIMITS;
    if (placement === 'CAROUSEL' && (entries.length < L.carouselMin || entries.length > L.carouselMax)) {
      out.push(issue('IG_CAROUSEL_COUNT', `Instagram carousels take ${L.carouselMin}–${L.carouselMax} items; this one has ${entries.length}.`, 'Adjust the slide count and regenerate.'));
    }
    if (placement === 'REEL' && entries.length !== 1) {
      if (entries.length > 1) out.push(issue('IG_REEL_SINGLE_VIDEO', 'An Instagram Reel is exactly one video.', 'Keep one master video for the reel.'));
    }
    for (const a of resolved) {
      const ratio = a.width && a.height ? a.width / a.height : null;
      if (a.media_type === 'image') {
        if (placement === 'REEL') out.push(issue('IG_REEL_REQUIRES_VIDEO', 'Instagram Reels need a video, not an image.', 'Use the short-form video workflow.'));
        if (a.mime_type !== L.imageMime) out.push(issue('IG_IMAGE_REQUIRES_JPEG', `Instagram accepts JPEG images only; this asset is ${a.mime_type}.`, 'Regenerate with JPEG output (the default for Instagram), or upload a JPEG.'));
        if (a.byte_size > L.imageMaxBytes) out.push(issue('IG_IMAGE_TOO_LARGE', `Instagram images must be ≤ 8 MB; this one is ${(a.byte_size / 1048576).toFixed(1)} MB.`, 'Regenerate at a smaller size.'));
        if (placement !== 'STORY' && ratio !== null && (ratio < L.feedAspectMin - 0.001 || ratio > L.feedAspectMax + 0.001)) {
          out.push(issue('IG_FEED_ASPECT_OUT_OF_RANGE', `Instagram feed images must be between 4:5 and 1.91:1; this one is ${a.width}x${a.height}.`, 'Regenerate at 1:1 or 4:5.'));
        }
      } else {
        if (!L.videoMimes.includes(a.mime_type as any)) out.push(issue('IG_VIDEO_CONTAINER', `Instagram needs MP4 or MOV; this asset is ${a.mime_type}.`, 'Re-encode as H.264 MP4.'));
        if (!a.video_codec || !L.videoCodecs.includes(a.video_codec as any)) out.push(issue('IG_VIDEO_CODEC', `Instagram needs H.264 or HEVC video; detected ${a.video_codec ?? 'unknown'}.`, 'Re-encode as H.264 MP4.'));
        if (a.width && a.width > L.videoMaxWidth) out.push(issue('IG_VIDEO_TOO_WIDE', `Instagram video width is capped at 1920 px; this one is ${a.width} px.`, 'Re-render at 1080x1920.'));
        const isStory = placement === 'STORY';
        const maxMs = isStory ? L.storyVideoMaxMs : L.reelMaxMs;
        const maxBytes = isStory ? L.storyVideoMaxBytes : L.reelMaxBytes;
        if (!a.duration_ms || a.duration_ms < L.reelMinMs || a.duration_ms > maxMs) {
          out.push(issue('IG_VIDEO_DURATION', `Instagram ${isStory ? 'Story' : 'Reel'} video must be 3 s–${isStory ? '60 s' : '15 min'}; this one is ${a.duration_ms ? (a.duration_ms / 1000).toFixed(1) + ' s' : 'unknown'}.`, 'Adjust the storyboard duration and regenerate.'));
        }
        if (a.byte_size > maxBytes) out.push(issue('IG_VIDEO_TOO_LARGE', `Video exceeds Instagram's ${maxBytes / 1048576} MB limit.`, 'Re-render at a lower bitrate.'));
        const [lo, hi] = isStory ? [L.storyAspectMin, L.storyAspectMax] : [L.reelAspectMin, L.reelAspectMax];
        if (ratio !== null && (ratio < lo || ratio > hi)) out.push(issue('IG_VIDEO_ASPECT', 'Video aspect ratio is outside what Instagram accepts.', 'Re-render at 9:16.'));
        if (placement === 'FEED_POST') out.push(issue('IG_FEED_VIDEO_IS_REEL', 'A single feed video publishes as a Reel on Instagram.', 'Switch the format to Reel.', 'warning'));
      }
    }
  }
  return out;
}

export const QA_VALIDATOR_VERSION = 'qa-policy-engine-v1+media-qa-2026.10.29';

/** Folds media issues into a policy report and recomputes its verdict. */
export function mergeValidationIssues(report: ValidationReport, extra: ValidationIssue[]): ValidationReport & { validator_version: string; media_issue_codes: string[] } {
  const codes = new Set(report.issues.map((i) => i.code));
  const issues = [...report.issues, ...extra.filter((i) => !codes.has(i.code))];
  const blockers = issues.filter((i) => i.severity === 'blocker').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return {
    ...report,
    issues,
    passed: blockers === 0,
    outcome: blockers > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass',
    score: Math.max(0, 100 - blockers * 30 - warnings * 8),
    requires_human_review: report.requires_human_review || blockers > 0,
    validator_version: QA_VALIDATOR_VERSION,
    media_issue_codes: extra.map((i) => i.code),
  };
}

/** True when an item's media can be handed to a platform right now. */
export function mediaIsPublishable(issues: ValidationIssue[]): boolean {
  return !issues.some((i) => i.severity === 'blocker');
}
