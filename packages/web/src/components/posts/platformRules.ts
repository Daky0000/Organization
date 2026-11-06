export type PlatformKey = 'twitter' | 'instagram' | 'linkedin' | 'facebook' | 'tiktok';

export type PreviewAction = 'trim' | 'remove_excess_hashtags' | 'add_line_break';

export type PreviewWarning = {
  type: 'error' | 'warning' | 'info';
  message: string;
  action?: PreviewAction;
};

export type PreviewConstraints = {
  platform: PlatformKey;
  charCount: number;
  charLimit: number;
  hashtags: string[];
  idealHashtagRange: [number, number];
  warnings: PreviewWarning[];
  suggestions: string[];
  firstLineLength: number;
  emojiCount: number;
  hasLink: boolean;
  toneNotes?: string;
};

type PlatformRules = {
  maxChars: number;
  idealHashtagRange: [number, number];
  imageCrops: string[];
  warningThresholds: {
    tooManyHashtags: number;
    tooFewHashtags: number;
    tooLongFirstLine: number;
  };
  linksPreview: 'prominent' | 'subtle' | 'hidden';
  toneNotes?: string;
  description: string;
};

export const PLATFORM_RULES: Record<PlatformKey, PlatformRules> = {
  twitter: {
    maxChars: 280,
    idealHashtagRange: [1, 3],
    imageCrops: ['16:9', '1:1'],
    warningThresholds: {
      tooManyHashtags: 3,
      tooFewHashtags: 1,
      tooLongFirstLine: 120,
    },
    linksPreview: 'subtle',
    toneNotes: 'Short, punchy, and conversational performs best.',
    description: 'Fast-moving feed, clarity and brevity win.',
  },
  instagram: {
    maxChars: 2200,
    idealHashtagRange: [5, 10],
    imageCrops: ['1:1', '4:5'],
    warningThresholds: {
      tooManyHashtags: 15,
      tooFewHashtags: 3,
      tooLongFirstLine: 125,
    },
    linksPreview: 'hidden',
    toneNotes: 'Lead with the hook, keep the first line punchy.',
    description: 'Visual-first feed with a short preview before "more".',
  },
  linkedin: {
    maxChars: 3000,
    idealHashtagRange: [1, 5],
    imageCrops: ['1.91:1', '1:1'],
    warningThresholds: {
      tooManyHashtags: 5,
      tooFewHashtags: 1,
      tooLongFirstLine: 140,
    },
    linksPreview: 'prominent',
    toneNotes: 'Professional tone, keep emojis minimal.',
    description: 'Professional network with strong link cards.',
  },
  facebook: {
    maxChars: 63206,
    idealHashtagRange: [1, 5],
    imageCrops: ['1.91:1', '4:5'],
    warningThresholds: {
      tooManyHashtags: 5,
      tooFewHashtags: 0,
      tooLongFirstLine: 160,
    },
    linksPreview: 'prominent',
    toneNotes: 'Conversational copy with a clear CTA performs well.',
    description: 'Broad audience, link previews are prominent.',
  },
  tiktok: {
    maxChars: 2200,
    idealHashtagRange: [3, 6],
    imageCrops: ['9:16'],
    warningThresholds: {
      tooManyHashtags: 6,
      tooFewHashtags: 2,
      tooLongFirstLine: 80,
    },
    linksPreview: 'hidden',
    toneNotes: 'Keep captions snappy and tag relevant trends.',
    description: 'Video-first feed with short captions.',
  },
};

export function computePreviewConstraints(
  platform: PlatformKey,
  caption: string,
  urlInCaption?: string | null
): PreviewConstraints {
  const rules = PLATFORM_RULES[platform];
  const charCount = caption.length;
  const hashtags = extractHashtags(caption);
  const firstLine = caption.split('\n')[0] || '';
  const emojis = extractEmojis(caption);

  const warnings: PreviewWarning[] = [];
  const suggestions: string[] = [];

  if (charCount > rules.maxChars) {
    warnings.push({
      type: 'error',
      message: `Post exceeds ${capitalize(platform)} limit by ${charCount - rules.maxChars} characters.`,
      action: 'trim',
    });
  } else if (charCount > rules.maxChars * 0.9) {
    warnings.push({
      type: 'warning',
      message: `Approaching ${capitalize(platform)} character limit (${charCount} / ${rules.maxChars}).`,
    });
  } else {
    suggestions.push(`OK: Character count optimal (${charCount} / ${rules.maxChars})`);
  }

  if (hashtags.length > rules.warningThresholds.tooManyHashtags) {
    warnings.push({
      type: 'warning',
      message: `Too many hashtags (${hashtags.length}). Ideal: ${rules.idealHashtagRange[0]}-${rules.idealHashtagRange[1]}.`,
      action: 'remove_excess_hashtags',
    });
  } else if (hashtags.length > 0 && hashtags.length < rules.idealHashtagRange[0]) {
    warnings.push({
      type: 'info',
      message: `Consider adding more hashtags. Ideal: ${rules.idealHashtagRange[0]}-${rules.idealHashtagRange[1]}.`,
    });
  } else if (hashtags.length >= rules.idealHashtagRange[0]) {
    suggestions.push(`OK: Hashtag count optimal (${hashtags.length})`);
  }

  if (['instagram', 'linkedin'].includes(platform) && firstLine.length > rules.warningThresholds.tooLongFirstLine) {
    warnings.push({
      type: 'warning',
      message: `First line is ${firstLine.length} chars. Only the first ${rules.warningThresholds.tooLongFirstLine} are visible before "more...".`,
      action: 'add_line_break',
    });
  }

  if (platform === 'linkedin' && emojis.length > 2) {
    warnings.push({
      type: 'info',
      message: `LinkedIn is more formal. ${emojis.length} emojis may feel unprofessional.`,
    });
  }

  return {
    platform,
    charCount,
    charLimit: rules.maxChars,
    hashtags,
    idealHashtagRange: rules.idealHashtagRange,
    warnings,
    suggestions,
    firstLineLength: firstLine.length,
    emojiCount: emojis.length,
    hasLink: Boolean(urlInCaption),
    toneNotes: rules.toneNotes,
  };
}

export function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\p{L}0-9_]+/gu) || [];
  return matches.map((h) => h.toLowerCase());
}

export function extractEmojis(text: string): string[] {
  const matches = text.match(/\p{Extended_Pictographic}/gu) || [];
  return matches;
}

export function extractUrl(text: string): string | null {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
