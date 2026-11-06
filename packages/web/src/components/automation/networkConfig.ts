export type SocialTemplateNetworkConfig = {
  platform: string;
  label: string;
  maxStatusLimit: number;
  features: {
    contentTypeToggle?: boolean;
    showThumbnail?: boolean;
    addImageLink?: boolean;
    removeCss?: boolean;
  };
};

export const normalizeSocialTemplatePlatform = (value: string) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'x' || v.includes('twitter')) return 'twitter';
  if (v.includes('facebook')) return 'facebook';
  if (v.includes('instagram')) return 'instagram';
  if (v.includes('linkedin')) return 'linkedin';
  if (v.includes('pinterest')) return 'pinterest';
  if (v.includes('threads')) return 'threads';
  if (v.includes('tiktok')) return 'tiktok';
  if (v.includes('wordpress')) return 'wordpress';
  return v;
};

export const NETWORK_CONFIGS: Record<string, SocialTemplateNetworkConfig> = {
  facebook: {
    platform: 'facebook',
    label: 'Facebook',
    maxStatusLimit: 63206,
    features: { contentTypeToggle: true },
  },
  twitter: {
    platform: 'twitter',
    label: 'X (Twitter)',
    maxStatusLimit: 280,
    features: { showThumbnail: true },
  },
  instagram: {
    platform: 'instagram',
    label: 'Instagram',
    maxStatusLimit: 2200,
    features: { removeCss: true },
  },
  linkedin: {
    platform: 'linkedin',
    label: 'LinkedIn',
    maxStatusLimit: 3000,
    features: {},
  },
  pinterest: {
    platform: 'pinterest',
    label: 'Pinterest',
    maxStatusLimit: 500,
    features: { addImageLink: true, removeCss: true },
  },
  threads: {
    platform: 'threads',
    label: 'Threads',
    maxStatusLimit: 500,
    features: { removeCss: true },
  },
  tiktok: {
    platform: 'tiktok',
    label: 'TikTok',
    maxStatusLimit: 2200,
    features: { removeCss: true },
  },
  wordpress: {
    platform: 'wordpress',
    label: 'WordPress',
    maxStatusLimit: 10000,
    features: { removeCss: true },
  },
};

export const getNetworkConfig = (platform: string) =>
  NETWORK_CONFIGS[normalizeSocialTemplatePlatform(platform)];

