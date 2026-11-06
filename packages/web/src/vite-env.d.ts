/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_APP_URL: string;
  readonly VITE_INSTAGRAM_APP_ID: string;
  readonly VITE_INSTAGRAM_REDIRECT_URI: string;
  readonly VITE_TWITTER_CLIENT_ID: string;
  readonly VITE_TWITTER_REDIRECT_URI: string;
  readonly VITE_LINKEDIN_CLIENT_ID: string;
  readonly VITE_LINKEDIN_REDIRECT_URI: string;
  readonly VITE_FACEBOOK_APP_ID: string;
  readonly VITE_FACEBOOK_REDIRECT_URI: string;
  readonly VITE_TIKTOK_CLIENT_ID: string;
  readonly VITE_TIKTOK_REDIRECT_URI: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
