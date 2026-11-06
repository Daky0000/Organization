export interface CanvasPreset {
  id: string;
  label: string;
  w: number;
  h: number;
  platform?: string;
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: 'ig-square',   label: 'Instagram Square',   w: 1080, h: 1080, platform: 'Instagram' },
  { id: 'ig-portrait', label: 'Instagram Portrait',  w: 1080, h: 1350, platform: 'Instagram' },
  { id: 'ig-story',    label: 'Instagram Story',     w: 1080, h: 1920, platform: 'Instagram' },
  { id: 'fb-post',     label: 'Facebook Post',       w: 1200, h: 630,  platform: 'Facebook'  },
  { id: 'twitter',     label: 'X / Twitter Post',    w: 1200, h: 675,  platform: 'X'         },
  { id: 'linkedin',    label: 'LinkedIn Post',        w: 1200, h: 627,  platform: 'LinkedIn'  },
  { id: 'tiktok',      label: 'TikTok / Reels',      w: 1080, h: 1920, platform: 'TikTok'    },
  { id: 'custom',      label: 'Custom Size',          w: 800,  h: 800                         },
];
