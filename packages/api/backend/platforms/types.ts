export type PostDestination = {
  type?: string;
  id?: string;
  name?: string;
};

export type PostMedia = {
  url: string;
  mimeType?: string;
  type?: 'image' | 'video' | 'reel' | 'story' | 'gif' | 'other';
  size?: number; // bytes — used for resumable upload decisions
};

export type PostContent = {
  text: string;
  link?: string;
  title?: string;
};

export type PostObject = {
  type?: string; // 'FEED_POST' | 'REEL' | 'STORY' | 'VIDEO'
  content: PostContent;
  media?: PostMedia[];
  destination?: PostDestination;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

export type PlatformPostResult = {
  status: 'published' | 'failed' | 'pending';
  platformPostId?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  // Published, but something the user asked for did not make it (e.g. media).
  warning?: string;
  raw?: any;
};

export type AnalyticsResult = {
  likes?: number;
  comments?: number;
  shares?: number;
  impressions?: number;
  reach?: number;
  clicks?: number;
  saves?: number;
  raw?: any;
};

export type TokenRefreshResult = {
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  error?: string;
};

export type PlatformContext = {
  accessToken: string;
  refreshToken?: string;
  accountId?: string | null;
  accountName?: string | null;
  tokenData?: any;
  logger?: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
  helpers?: Record<string, any>;
};

export interface SocialPlatform {
  id: string;
  name: string;
  validate(post: PostObject): ValidationResult;
  post(post: PostObject, ctx: PlatformContext): Promise<PlatformPostResult>;
  getPostAnalytics?(postId: string, ctx: PlatformContext): Promise<AnalyticsResult>;
  refreshToken?(ctx: PlatformContext): Promise<TokenRefreshResult>;
  handleError(error: any): { retryable: boolean; message: string };
}
