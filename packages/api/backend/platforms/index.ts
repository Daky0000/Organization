import { FacebookPagesPlatform } from './facebook_pages.js';
import { InstagramBusinessPlatform } from './instagram_business.js';
import { LinkedInPlatform } from './linkedin.js';
import { TwitterXPlatform } from './twitter_x.js';
import { TikTokPlatform } from './tiktok.js';

export const platformRegistry = {
  facebook: new FacebookPagesPlatform(),
  instagram: new InstagramBusinessPlatform(),
  linkedin: new LinkedInPlatform(),
  twitter: new TwitterXPlatform(),
  tiktok: new TikTokPlatform(),
};

export function getPlatformAdapter(id: string) {
  return platformRegistry[id as keyof typeof platformRegistry] || null;
}
