import type { LinkMetadata } from '../../types/linkMetadata';
import type { PlatformKey } from './platformRules';
import TwitterMockup from './mockups/TwitterMockup';
import InstagramMockup from './mockups/InstagramMockup';
import LinkedInMockup from './mockups/LinkedInMockup';
import FacebookMockup from './mockups/FacebookMockup';
import TikTokMockup from './mockups/TikTokMockup';

type PlatformMockupProps = {
  platform: PlatformKey;
  caption: string;
  mediaUrls?: string[];
  linkMeta?: LinkMetadata | null;
  linkLoading?: boolean;
  linkError?: string | null;
};

const PlatformMockup = ({ platform, caption, mediaUrls, linkMeta, linkLoading, linkError }: PlatformMockupProps) => {
  const common = {
    caption,
    mediaUrls,
    linkMeta,
    linkLoading,
    linkError,
  };

  switch (platform) {
    case 'twitter':
      return <TwitterMockup {...common} />;
    case 'instagram':
      return <InstagramMockup {...common} />;
    case 'linkedin':
      return <LinkedInMockup {...common} />;
    case 'facebook':
      return <FacebookMockup {...common} />;
    case 'tiktok':
      return <TikTokMockup {...common} />;
    default:
      return null;
  }
};

export default PlatformMockup;
