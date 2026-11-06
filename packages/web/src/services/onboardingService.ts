import { api } from './apiClient';

export type OnboardingAnswers = {
  brandName: string;
  website: string;
  industry: string;
  offering: string;
  offerings: string[];
  audience: string;
  tones: string[];
  goals: string[];
  platforms: string[];
};

export type OnboardingStatus = {
  success: boolean;
  completed: boolean;
  skipped: boolean;
  data: Partial<OnboardingAnswers> & { completed_at?: string; skipped_at?: string };
};

export type WebsiteSuggestions = {
  brandName: string;
  industry: string;
  offering: string;
  offerings: string[];
  audience: string;
  tones: string[];
  platforms: string[];
};

export type AccountSuggestions = {
  tones: string[];
  audience: string;
};

export const onboardingService = {
  status: () => api.get<OnboardingStatus>('/api/onboarding'),
  complete: (answers: OnboardingAnswers) =>
    api.post<{ success: boolean; memoriesCreated: number }>('/api/onboarding', answers),
  skip: () => api.post<{ success: boolean }>('/api/onboarding/skip'),
  analyzeWebsite: (website: string) =>
    api.post<{ success: boolean; suggestions: WebsiteSuggestions; socialLinks: Record<string, string>; sourceUrl: string }>(
      '/api/onboarding/analyze-website',
      { website },
    ),
  analyzeAccount: (platform: string) =>
    api.post<{
      success: boolean;
      platform: string;
      platformLabel: string;
      handle: string;
      followers: number;
      bio: string | null;
      suggestions: AccountSuggestions;
    }>('/api/onboarding/analyze-account', { platform }),
};
