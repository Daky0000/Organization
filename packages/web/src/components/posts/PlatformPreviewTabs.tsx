import { useEffect, useMemo, useState } from 'react';
import type { LinkMetadata } from '../../types/linkMetadata';
import { linkMetadataService } from '../../services/linkMetadataService';
import ConstraintsSummary from './ConstraintsSummary';
import PlatformMockup from './PlatformMockup';
import {
  PLATFORM_RULES,
  computePreviewConstraints,
  extractHashtags,
  extractUrl,
  type PlatformKey,
  type PreviewAction,
} from './platformRules';

interface PlatformPreviewTabsProps {
  caption: string;
  selectedPlatforms: string[];
  mediaUrls?: string[];
  onCaptionChange?: (value: string) => void;
}

const PlatformPreviewTabs = ({ caption, selectedPlatforms, mediaUrls, onCaptionChange }: PlatformPreviewTabsProps) => {
  const normalizedPlatforms = useMemo(
    () =>
      selectedPlatforms
        .map((platform) => platform.toLowerCase().trim())
        .filter((platform): platform is PlatformKey =>
          ['twitter', 'instagram', 'linkedin', 'facebook', 'tiktok'].includes(platform)
        ),
    [selectedPlatforms]
  );

  const [activeTab, setActiveTab] = useState<PlatformKey | null>(normalizedPlatforms[0] || null);
  const [linkMeta, setLinkMeta] = useState<LinkMetadata | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (normalizedPlatforms.length === 0) {
      setActiveTab(null);
      return;
    }
    if (!activeTab || !normalizedPlatforms.includes(activeTab)) {
      setActiveTab(normalizedPlatforms[0]);
    }
  }, [normalizedPlatforms, activeTab]);

  useEffect(() => {
    const url = extractUrl(caption);
    setDetectedUrl(url);
    if (!url) {
      setLinkMeta(null);
      setLinkLoading(false);
      setLinkError(null);
      return;
    }

    let alive = true;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLinkLoading(true);
      setLinkError(null);
      try {
        const meta = await linkMetadataService.fetch(url, controller.signal);
        if (!alive) return;
        setLinkMeta(meta);
      } catch (err) {
        if (!alive) return;
        setLinkMeta(null);
        setLinkError(err instanceof Error ? err.message : 'Unable to fetch link metadata');
      } finally {
        if (alive) setLinkLoading(false);
      }
    }, 500);

    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [caption]);

  const activePlatform = activeTab || normalizedPlatforms[0] || null;

  const constraints = useMemo(() => {
    if (!activePlatform) return null;
    return computePreviewConstraints(activePlatform, caption, detectedUrl);
  }, [activePlatform, caption, detectedUrl]);

  const applySuggestion = (action: PreviewAction) => {
    if (!activePlatform || !onCaptionChange) return;
    const rules = PLATFORM_RULES[activePlatform];
    let nextCaption = caption;

    switch (action) {
      case 'trim':
        nextCaption = caption.slice(0, rules.maxChars);
        break;
      case 'remove_excess_hashtags': {
        const hashtags = extractHashtags(caption);
        const allowed = new Set(hashtags.slice(0, rules.idealHashtagRange[1]));
        const tokens = caption.split(/\s+/);
        nextCaption = tokens
          .filter((token) => {
            if (!token.startsWith('#')) return true;
            const normalized = token.match(/#[\p{L}0-9_]+/gu)?.[0]?.toLowerCase();
            return normalized ? allowed.has(normalized) : true;
          })
          .join(' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        break;
      }
      case 'add_line_break': {
        if (caption.includes('\n')) break;
        const firstLineLimit = rules.warningThresholds.tooLongFirstLine;
        const sentenceBreak = caption.indexOf('. ');
        if (sentenceBreak !== -1 && sentenceBreak < firstLineLimit) {
          nextCaption = `${caption.slice(0, sentenceBreak + 1)}\n${caption.slice(sentenceBreak + 2)}`;
        } else if (caption.length > firstLineLimit) {
          nextCaption = `${caption.slice(0, firstLineLimit)}\n${caption.slice(firstLineLimit)}`;
        }
        break;
      }
      default:
        break;
    }

    if (nextCaption !== caption) onCaptionChange(nextCaption);
  };

  if (normalizedPlatforms.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
        Select social platforms to see previews.
      </div>
    );
  }

  if (!activePlatform || !constraints) return null;

  return (
    <div className="space-y-4" data-testid="preview-tabs">
      <div className="flex flex-wrap items-center gap-2">
        {normalizedPlatforms.map((platform) => (
          <button
            key={platform}
            type="button"
            onClick={() => setActiveTab(platform)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              activePlatform === platform ? 'bg-slate-950 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {platform === 'twitter' ? 'Twitter' : platform.charAt(0).toUpperCase() + platform.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <PlatformMockup
          platform={activePlatform}
          caption={caption}
          mediaUrls={mediaUrls}
          linkMeta={linkMeta}
          linkLoading={linkLoading}
          linkError={linkError}
        />
        <ConstraintsSummary constraints={constraints} linkLoading={linkLoading} linkError={linkError} onApplySuggestion={applySuggestion} />
      </div>
    </div>
  );
};

export { PlatformPreviewTabs };
