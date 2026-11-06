import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle,
  Copy,
  ExternalLink,
  Loader2,
  Power,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TestTube2,
  X,
} from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';
import { PlatformLogo } from '../PlatformLogo';

type PlatformField = {
  id: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password';
  helpText: string;
  required?: boolean;
};

type PlatformDef = {
  id: string;
  name: string;
  description: string;
  fields: PlatformField[];
  docsUrl: string;
  redirectHint: string;
  redirectFieldId?: 'redirectUri' | 'calendarRedirectUri';
  expectedCallbackPath?: string;
  usesMetaComplianceRoutes?: boolean;
  setupSteps: string[];
};

type PlatformRow = {
  platform: string;
  config: Record<string, any>;
  enabled: boolean;
};

type RedirectCheckItem = {
  label: string;
  passed: boolean;
  detail: string;
};

const authHeaders = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const getBackendBase = () => {
  if (typeof window === 'undefined') return API_BASE_URL;
  return (API_BASE_URL || window.location.origin).replace(/\/$/, '');
};

const getFrontendBase = () => {
  if (typeof window === 'undefined') return 'https://marketing.dakyx.com';
  return window.location.origin.replace(/\/$/, '');
};

const buildRedirectUri = (platform: PlatformDef) => {
  const base = getBackendBase();
  if (platform.expectedCallbackPath) {
    return `${base}${platform.expectedCallbackPath}`;
  }
  return `${base}/auth/${platform.id}/callback`;
};

const buildDeauthorizeUrl = (platform: PlatformDef) => {
  const base = getBackendBase();
  if (platform.usesMetaComplianceRoutes) {
    return `${base}/api/meta/deauthorize`;
  }
  return `${base}/api/oauth/${platform.id}/deauthorize`;
};

const buildDataDeletionCallbackUrl = (platform: PlatformDef) => {
  const base = getBackendBase();
  if (platform.usesMetaComplianceRoutes) {
    return `${base}/api/meta/data-deletion`;
  }
  return `${base}/api/oauth/${platform.id}/data-deletion`;
};

const buildDataDeletionPageUrl = () => `${getFrontendBase()}/data-deletion`;

const PLATFORMS: PlatformDef[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    description: 'Enable or disable WordPress connections. Users connect with Application Passwords.',
    fields: [],
    docsUrl: 'https://developer.wordpress.org/rest-api/reference/',
    redirectHint: 'No OAuth redirect needed (Application Password). Compliance & deauthorize webhooks are provided below if required by your security policy.',
    setupSteps: [
      'Toggle WordPress to Enabled so workspace users can connect their WordPress sites.',
      'Users generate an Application Password in WordPress Admin → Users → Profile → Application Passwords.',
      'If your WordPress security plugin requires webhook callbacks for deauthorization or GDPR data deletion, use the URLs below.',
    ],
  },
  {
    id: 'facebook',
    name: 'Facebook (Meta)',
    description: 'OAuth credentials for Facebook Graph API — pages, publishing, and webhooks.',
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Meta App ID', type: 'text', helpText: 'From Meta for Developers → App Settings → Basic.' },
      { id: 'appSecret', label: 'App Secret', placeholder: 'Meta App Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange and signed_request verification.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/facebook/callback', type: 'text', helpText: 'Must match the Valid OAuth Redirect URI in Meta Facebook Login → Settings.' },
      { id: 'scopes', label: 'OAuth Scopes (Optional)', placeholder: 'public_profile,pages_show_list,pages_read_engagement,pages_manage_posts', type: 'text', helpText: 'Leave empty for default Facebook page publishing scopes. Any scope requested must be added in Meta for Developers → App Review → Permissions and Features.' },
      { id: 'webhookVerifyToken', label: 'Webhook Verify Token (Optional)', placeholder: 'Any random string', type: 'password', helpText: 'The Verify Token you enter in Meta → Webhooks for `/webhooks/meta`. Overridden by the META_WEBHOOK_VERIFY_TOKEN environment variable when set.' },
    ],
    docsUrl: 'https://developers.facebook.com/',
    redirectHint: 'Use `/auth/facebook/callback` in Facebook Login → Settings → Valid OAuth Redirect URIs.',
    redirectFieldId: 'redirectUri',
    expectedCallbackPath: '/auth/facebook/callback',
    usesMetaComplianceRoutes: true,
    setupSteps: [
      'Open Meta for Developers (developers.facebook.com) → Select your App → App Settings → Basic and copy your App ID and App Secret into the form below.',
      'Under App Review → Permissions and Features (or Use Cases), ensure `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts` are added to your app.',
      'In App Settings → Basic, paste the Deauthorize Callback URL and Data Deletion Request URL into the User Data Deletion & Deauthorize fields.',
      'In the left sidebar under Facebook Login → Settings, paste the Valid OAuth Redirect URI into "Valid OAuth Redirect URIs" and verify it with the Redirect URI Validator below.',
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'OAuth credentials for Instagram Platform — supports Instagram API with Instagram Login (Direct) and Instagram API with Facebook Login (Business Login for Instagram with IG_API_ONBOARDING).',
    fields: [
      { id: 'appId', label: 'Instagram / Meta App ID', placeholder: 'Instagram App ID or Meta App ID', type: 'text', helpText: 'From Meta for Developers → Products → Instagram → API setup with Instagram login (or App Settings → Basic if using Facebook Login).' },
      { id: 'appSecret', label: 'Instagram / Meta App Secret', placeholder: 'Instagram App Secret or Meta App Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/instagram/callback', type: 'text', helpText: 'Must match the Valid OAuth Redirect URI registered in your Meta app settings.' },
      { id: 'loginType', label: 'Default Login Flow (Optional)', placeholder: 'instagram (default) or facebook', type: 'text', required: false, helpText: 'Set to "instagram" for Instagram API with Instagram Login (www.instagram.com/oauth/authorize) or "facebook" for Business Login for Instagram via Facebook Login (the www.facebook.com Login dialog with IG_API_ONBOARDING).' },
      { id: 'configId', label: 'Facebook Login for Business Config ID (Optional)', placeholder: 'e.g. 123456789012345', type: 'text', required: false, helpText: 'Optional config_id from Facebook Login for Business → Configurations when using Business Login for Instagram via Facebook.' },
      { id: 'scopes', label: 'OAuth Scopes (Optional)', placeholder: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments', type: 'text', required: false, helpText: 'Leave empty for recommended defaults. Direct Instagram Login: instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments. Facebook Login: public_profile,pages_show_list,pages_read_engagement,business_management,instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,instagram_manage_messages.' },
    ],
    docsUrl: 'https://developers.facebook.com/documentation/instagram-platform',
    redirectHint: 'Paste the Valid OAuth Redirect URI, Deauthorize Callback URL, and Data Deletion Request URL into your Meta App Settings.',
    redirectFieldId: 'redirectUri',
    expectedCallbackPath: '/auth/instagram/callback',
    usesMetaComplianceRoutes: true,
    setupSteps: [
      '1. Meta App Type: Create or use an app of type "Business" on Meta for Developers (https://developers.facebook.com/documentation/instagram-platform).',
      '2. Choose Login Flow: Add "Instagram" product in your Meta App Dashboard. You can use "API setup with Instagram business login" (Direct Instagram Login, no Facebook Page required) AND/OR "API setup with Facebook login" (Business Login for Instagram with embedded Page & Professional Account onboarding: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram).',
      '3. Roles in Development Mode: While the Meta App is in Development Mode, only users added under App Roles → Roles as Administrators, Developers, or Instagram Testers can connect.',
      '4. Professional Account: The Instagram account must be a Professional Account (Business or Creator). When using Business Login via Facebook, Meta\'s IG_API_ONBOARDING flow lets users convert their account and create/link a Facebook Page inline.',
      '5. Configure Callbacks: Paste the Valid OAuth Redirect URI (`/auth/instagram/callback`), Deauthorize Callback URL (`/api/meta/deauthorize`), and Data Deletion Request URL (`/api/meta/data-deletion`).',
      '6. Verify: Use the Redirect URI Validator below to confirm exact match before saving.',
    ],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'OAuth credentials for publishing UGC posts, organization pages, and analytics.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'LinkedIn Client ID', type: 'text', helpText: 'From LinkedIn Developer Portal → Your App → Auth tab.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'LinkedIn Client Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/linkedin/callback', type: 'text', helpText: 'Must match the Authorized redirect URLs for your app in the LinkedIn Auth tab.' },
      { id: 'scopes', label: 'OAuth Scopes (Optional)', placeholder: 'openid,profile,email,w_member_social', type: 'text', required: false, helpText: 'Leave empty for defaults. Use "openid,profile,email,w_member_social" for standard personal posting, or include organization scopes if approved.' },
    ],
    docsUrl: 'https://learn.microsoft.com/en-us/linkedin/',
    redirectHint: 'Use `/auth/linkedin/callback` under LinkedIn Developer Portal → Auth → OAuth 2.0 settings.',
    redirectFieldId: 'redirectUri',
    expectedCallbackPath: '/auth/linkedin/callback',
    setupSteps: [
      'Open LinkedIn Developer Portal (linkedin.com/developers/apps) → Select your app → Auth tab.',
      'Copy the Client ID and Primary Client Secret into the form below.',
      'Under OAuth 2.0 settings → Authorized redirect URLs for your app, add the Valid OAuth Redirect URI below and verify with the Redirect URI Validator.',
    ],
  },
  {
    id: 'twitter',
    name: 'X (Twitter)',
    description: 'OAuth 2.0 + PKCE credentials for posting tweets via API v2.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'X OAuth Client ID', type: 'text', helpText: 'From developer.x.com → Project & App → Keys and tokens (OAuth 2.0 Client ID).' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'X OAuth Client Secret (optional)', type: 'password', helpText: 'Some setups use PKCE without client secret; include if using Confidential Client.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/twitter/callback', type: 'text', helpText: 'Must match your Callback URI / Redirect URL in User authentication settings.' },
    ],
    docsUrl: 'https://developer.x.com/',
    redirectHint: 'Use `/auth/twitter/callback` in X Developer Portal → User authentication settings.',
    redirectFieldId: 'redirectUri',
    expectedCallbackPath: '/auth/twitter/callback',
    setupSteps: [
      'Go to X Developer Portal (developer.x.com) → Your App → User authentication settings → Set up.',
      'Enable OAuth 2.0 (Read and Write permissions, Web App / Automated App) and paste the Valid OAuth Redirect URI into "Callback URI / Redirect URL".',
      'Copy the OAuth 2.0 Client ID and Client Secret into the fields below and run the Redirect URI Validator.',
    ],
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    description: 'OAuth credentials for creating Pins and listing boards.',
    fields: [
      { id: 'clientId', label: 'App ID', placeholder: 'Pinterest App ID', type: 'text', helpText: 'From developers.pinterest.com → My Apps → Manage.' },
      { id: 'clientSecret', label: 'App Secret', placeholder: 'Pinterest App Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/pinterest/callback', type: 'text', helpText: 'Must match the Redirect link registered in your Pinterest app.' },
    ],
    docsUrl: 'https://developers.pinterest.com/docs/api/v5/',
    redirectHint: 'Use `/auth/pinterest/callback` in Pinterest App → Redirect link.',
    redirectFieldId: 'redirectUri',
    expectedCallbackPath: '/auth/pinterest/callback',
    setupSteps: [
      'Open Pinterest Developers (developers.pinterest.com/apps) and select your app.',
      'Copy your App ID and App Secret into the form below.',
      'Add the Valid OAuth Redirect URI under "Redirect link" in your Pinterest app and verify it with the Redirect URI Validator.',
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: 'OAuth credentials for publishing video posts (push_by_file & pull_by_url) and photo posts via Content Posting API.',
    fields: [
      { id: 'clientKey', label: 'Client Key', placeholder: 'TikTok Client Key', type: 'text', helpText: 'From developers.tiktok.com → your app → App info. This is the "Client Key" (not Client ID).' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'TikTok Client Secret', type: 'password', helpText: 'Keep this secret. From developers.tiktok.com → your app → App info.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/tiktok/callback', type: 'text', helpText: 'Must match the Redirect URI in your TikTok Login Kit settings.' },
      { id: 'verificationCode', label: 'Domain Verification Code (Optional)', placeholder: 'e.g. GuHuKYUdxb13mmRk5PkdrDFlLEBosnIF', type: 'text', helpText: 'Required by TikTok for pull_by_url. File verification is automatically answered at /tiktok*.txt.' },
    ],
    docsUrl: 'https://developers.tiktok.com/doc/login-kit-web/',
    redirectHint: 'Use `/auth/tiktok/callback` on the backend. Required scopes: user.info.basic, video.upload, video.publish.',
    redirectFieldId: 'redirectUri',
    expectedCallbackPath: '/auth/tiktok/callback',
    setupSteps: [
      'Open TikTok for Developers (developers.tiktok.com) → Manage apps → Your App.',
      'Copy the Client Key and Client Secret from Basic Information into the fields below.',
      'Under Products → Login Kit → Web → Redirect URI, paste the Valid OAuth Redirect URI below and validate it.',
      'Under Content Posting API → Domain verification (for pull_by_url), select HTML file verification. Your app automatically answers all https://marketing.dakyx.com/tiktok*.txt verification challenges.',
    ],
  },
  {
    id: 'threads',
    name: 'Threads',
    description: 'OAuth credentials for publishing posts to Threads and syncing insights (Meta Graph API).',
    fields: [
      { id: 'appId', label: 'App ID', placeholder: 'Meta / Threads App ID', type: 'text', helpText: 'From Meta for Developers → Threads Use Case → Settings. Note: Threads has its own App ID & Secret.' },
      { id: 'appSecret', label: 'App Secret', placeholder: 'Meta / Threads App Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/threads/callback', type: 'text', helpText: 'Must match the Redirect Callback URL in your Meta Threads Use Case settings.' },
    ],
    docsUrl: 'https://developers.facebook.com/docs/threads/',
    redirectHint: 'Use `/auth/threads/callback` for Redirect Callback URL, `/api/meta/deauthorize` for Uninstall Callback URL, and `/api/meta/data-deletion` for Delete Callback URL.',
    redirectFieldId: 'redirectUri',
    expectedCallbackPath: '/auth/threads/callback',
    usesMetaComplianceRoutes: true,
    setupSteps: [
      'In Meta for Developers → Use Cases → Access the Threads API → Settings, copy the Threads App ID and Threads App Secret.',
      'Paste the Valid OAuth Redirect URI into "Redirect Callback URLs", the Deauthorize Callback URL into "Uninstall Callback URL", and the Data Deletion Request URL into "Delete Callback URL".',
      'Use the Redirect URI Validator below to verify the callback URI.',
    ],
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    description: 'API key for connecting user Mailchimp accounts to sync contacts and campaigns.',
    fields: [],
    docsUrl: 'https://mailchimp.com/developer/',
    redirectHint: 'No OAuth needed — users connect with their own Mailchimp API key in the Integrations page.',
    setupSteps: [
      'Toggle Mailchimp to Enabled so users can connect their Mailchimp accounts using an API key and server prefix (e.g., us19).',
      'Compliance URLs for Deauthorize and Data Deletion Requests are provided below for platform audit requirements.',
    ],
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'OAuth credentials for sending emails from users\' Gmail or Google Workspace address via the Gmail API.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Google OAuth Client ID', type: 'text', helpText: 'From Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'Google OAuth Client Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/gmail/callback', type: 'text', helpText: 'Must match the Authorized redirect URI in your Google OAuth app.' },
    ],
    docsUrl: 'https://developers.google.com/gmail/api',
    redirectHint: 'Use `/auth/gmail/callback` on the backend. Enable Gmail API in Google Cloud Console before testing.',
    redirectFieldId: 'redirectUri',
    expectedCallbackPath: '/auth/gmail/callback',
    setupSteps: [
      'In Google Cloud Console → APIs & Services → Library, enable the Gmail API.',
      'Go to APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web application) and copy the Client ID and Client Secret below.',
      'Under Authorized redirect URIs, paste the Valid OAuth Redirect URI (`/auth/gmail/callback`) and verify with the Redirect URI Validator.',
    ],
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    description: 'OAuth credentials for syncing meetings to Google Calendar. Users connect their calendar to schedule meetings from the CRM.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Google OAuth Client ID', type: 'text', helpText: 'Same Client ID as Gmail if using the same Google Cloud project.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'Google OAuth Client Secret', type: 'password', helpText: 'Same Client Secret as Gmail if using the same Google Cloud project.' },
      { id: 'calendarRedirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/api/calendar/google/callback', type: 'text', helpText: 'Must be added to Authorized redirect URIs in Google Cloud Console.' },
    ],
    docsUrl: 'https://developers.google.com/calendar/api/guides/overview',
    redirectHint: 'Use `/api/calendar/google/callback` on the backend. Enable Google Calendar API in Google Cloud Console.',
    redirectFieldId: 'calendarRedirectUri',
    expectedCallbackPath: '/api/calendar/google/callback',
    setupSteps: [
      'In Google Cloud Console → APIs & Services → Library, enable the Google Calendar API.',
      'You can reuse your Gmail OAuth 2.0 Client ID and Client Secret or create a dedicated one.',
      'Add `/api/calendar/google/callback` to Authorized redirect URIs in Google Cloud Console and check it with the Redirect URI Validator below.',
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'OAuth credentials for sending workflow notifications and agent alerts to Slack workspaces.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Slack App Client ID', type: 'text', helpText: 'From api.slack.com → Your Apps → Basic Information.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'Slack App Client Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/slack/callback', type: 'text', helpText: 'Must match the Redirect URL in your Slack app OAuth & Permissions settings.' },
      { id: 'signingSecret', label: 'Signing Secret', placeholder: 'Slack App Signing Secret', type: 'password', helpText: 'From Basic Information → App Credentials. Verifies the app_uninstalled / tokens_revoked events Slack sends to the Deauthorize Callback URL.' },
    ],
    docsUrl: 'https://api.slack.com/authentication/oauth-v2',
    redirectHint: 'Use `/auth/slack/callback` on the backend. Required scopes: chat:write, channels:read.',
    redirectFieldId: 'redirectUri',
    expectedCallbackPath: '/auth/slack/callback',
    setupSteps: [
      'Open Slack API (api.slack.com/apps) → Select your app → Basic Information and copy Client ID & Client Secret.',
      'Go to OAuth & Permissions → Redirect URLs, add the Valid OAuth Redirect URI below, and click Save URLs.',
      'Add Bot Token Scopes `chat:write` and `channels:read`, then validate the Redirect URI below.',
      'Optional: under Event Subscriptions, set the Request URL to the Deauthorize Callback URL below and subscribe to `app_uninstalled` and `tokens_revoked` so uninstalling the app disconnects the workspace.',
    ],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Enable WhatsApp Business Cloud API. Users connect with their own phone number ID and access token from Meta Developer Console.',
    fields: [],
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/',
    redirectHint: 'Users connect with their Meta Phone Number ID and System User Access Token. Meta Deauthorize & Data Deletion URLs are provided below.',
    usesMetaComplianceRoutes: true,
    setupSteps: [
      'Toggle WhatsApp Business to Enabled so workspace users can connect their WhatsApp Cloud API phone numbers.',
      'In Meta for Developers → App Settings → Basic, use the Deauthorize Callback URL and Data Deletion Request URL provided below.',
    ],
  },
  {
    id: 'zoom',
    name: 'Zoom',
    description: 'OAuth credentials for creating and managing Zoom meetings from content workflows.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Zoom App Client ID', type: 'text', helpText: 'From marketplace.zoom.us → Build App → App Credentials.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'Zoom App Client Secret', type: 'password', helpText: 'Keep this secret. Used server-side for token exchange.' },
      { id: 'redirectUri', label: 'Redirect URL', placeholder: 'https://YOUR-BACKEND/auth/zoom/callback', type: 'text', helpText: 'Must match the Redirect URL for OAuth in your Zoom Marketplace app.' },
      { id: 'webhookSecret', label: 'Secret Token', placeholder: 'Zoom app Secret Token', type: 'password', helpText: 'From Features → Access → Secret Token. Verifies deauthorization notifications and answers Zoom’s endpoint URL validation.' },
    ],
    docsUrl: 'https://marketplace.zoom.us/develop/create',
    redirectHint: 'Use `/auth/zoom/callback` for Redirect URL and `/api/oauth/zoom/deauthorize` for Zoom Deauthorization Notification Endpoint URL.',
    redirectFieldId: 'redirectUri',
    expectedCallbackPath: '/auth/zoom/callback',
    setupSteps: [
      'Open Zoom App Marketplace (marketplace.zoom.us) → Develop → Build App → General / OAuth App.',
      'Copy Client ID and Client Secret into the form below.',
      'Paste the Valid OAuth Redirect URI into both "Redirect URL for OAuth" and "OAuth Allow Lists".',
      'Under Surface / Features → Deauthorization Notification, paste the Deauthorize Callback URL (`/api/oauth/zoom/deauthorize`).',
    ],
  },
  {
    id: 'vapi',
    name: 'Vapi (AI Voice Calls)',
    description: 'Voice-agent provider for the AI Sales OS. Vapi owns telephony, speech recognition, turn-taking and speech synthesis; we supply the call brief and receive an end-of-call report.',
    fields: [
      { id: 'apiKey', label: 'Private API Key', placeholder: 'Vapi private key', type: 'password', helpText: 'From dashboard.vapi.ai → API Keys. Used server-side only.' },
      { id: 'publicKey', label: 'Public API Key', placeholder: 'Vapi public key', type: 'text', helpText: 'Browser-safe key for Web SDK test calls under Sales → Settings.' },
      { id: 'phoneNumberId', label: 'Phone Number ID', placeholder: 'e.g. 8f2c…', type: 'text', helpText: 'The UUID of the Vapi phone number that calls are placed from.' },
      { id: 'webhookSecret', label: 'Webhook Secret', placeholder: 'Shared secret for /webhooks/vapi', type: 'password', helpText: 'Set the same value as the Server URL secret on your Vapi phone number.' },
    ],
    docsUrl: 'https://docs.vapi.ai/api-reference/calls/create',
    redirectHint: 'Set the Server URL on your Vapi phone number to `/webhooks/vapi` on this backend.',
    expectedCallbackPath: '/webhooks/vapi',
    setupSteps: [
      'Open dashboard.vapi.ai → Organization → API Keys and copy your Private API Key and Public API Key.',
      'Go to Phone Numbers → select your number → copy the Phone Number ID (UUID).',
      'Set the Server URL on your Vapi phone number to the Callback URL below (`/webhooks/vapi`) with matching Webhook Secret.',
    ],
  },
  {
    id: 'hubtel',
    name: 'Hubtel (Payments)',
    description: 'Hubtel payment gateway credentials for processing GHS subscription payments.',
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Hubtel Client ID', type: 'text', helpText: 'From Hubtel merchant dashboard → API credentials.' },
      { id: 'clientSecret', label: 'Client Secret', placeholder: 'Hubtel Client Secret', type: 'password', helpText: 'Keep this secret. Used server-side for payment initiation.' },
      { id: 'merchantAccountNumber', label: 'Merchant Account Number', placeholder: 'e.g. 2024XXX', type: 'text', helpText: 'Your Hubtel merchant account number from the dashboard.' },
    ],
    docsUrl: 'https://developers.hubtel.com/',
    redirectHint: 'Callback URL is handled automatically at `/api/payments/hubtel/callback`.',
    expectedCallbackPath: '/api/payments/hubtel/callback',
    setupSteps: [
      'Log in to your Hubtel Merchant Dashboard and copy your API Client ID, Client Secret, and POS Sales / Merchant Account Number.',
      'Whitelist the Callback URL (`/api/payments/hubtel/callback`) in your Hubtel developer settings if required.',
    ],
  },
  {
    id: 'resend',
    name: 'Resend (Transactional Email)',
    description: 'API key and sender details for all outgoing emails — campaigns, automations, password resets, and notifications.',
    fields: [
      { id: 'apiKey', label: 'API Key', placeholder: 're_...', type: 'password', helpText: 'From resend.com → API Keys. Create a key with full access.' },
      { id: 'fromEmail', label: 'From Email', placeholder: 'noreply@yourdomain.com', type: 'text', helpText: 'Must be a verified domain or address in your Resend account.' },
      { id: 'fromName', label: 'From Name', placeholder: 'DakyXTech', type: 'text', helpText: 'Display name shown to recipients in the From field.' },
    ],
    docsUrl: 'https://resend.com/docs',
    redirectHint: 'Verify your sending domain in the Resend dashboard before going live.',
    setupSteps: [
      'Verify your sending domain in resend.com → Domains.',
      'Create a Full Access API Key under resend.com → API Keys and paste it below.',
      'Use the "Send a test email" tool inside this modal to confirm delivery.',
    ],
  },
  {
    id: 'smtp',
    name: 'SMTP (Email Fallback)',
    description: 'SMTP server details as a fallback email provider if Resend is not configured.',
    fields: [
      { id: 'host', label: 'SMTP Host', placeholder: 'smtp.mailgun.org', type: 'text', helpText: 'Hostname of your SMTP server.' },
      { id: 'port', label: 'Port', placeholder: '587', type: 'text', helpText: 'Common ports: 587 (STARTTLS), 465 (SSL), 25 (unencrypted).' },
      { id: 'username', label: 'Username', placeholder: 'postmaster@yourdomain.com', type: 'text', helpText: 'SMTP authentication username.' },
      { id: 'password', label: 'Password', placeholder: '', type: 'password', helpText: 'SMTP authentication password. Keep this secret.' },
      { id: 'fromEmail', label: 'From Email', placeholder: 'noreply@yourdomain.com', type: 'text', helpText: 'Default sender address for outgoing mail.' },
    ],
    docsUrl: 'https://en.wikipedia.org/wiki/SMTP',
    redirectHint: 'SMTP is used only when no Resend API key is configured.',
    setupSteps: [
      'Enter your SMTP server hostname, port (587 for STARTTLS or 465 for TLS), username, password, and default From Email.',
      'Save credentials to enable automatic fallback email delivery.',
    ],
  },
];

function evaluateRedirectUri(
  candidateRaw: string,
  platform: PlatformDef,
  configuredFormValue: string
): { valid: boolean; canonicalUri: string; checks: RedirectCheckItem[] } {
  const canonicalUri = buildRedirectUri(platform);
  const candidate = candidateRaw.trim();
  const expectedPath = platform.expectedCallbackPath || `/auth/${platform.id}/callback`;
  const backendBase = getBackendBase();

  if (!candidate) {
    return {
      valid: false,
      canonicalUri,
      checks: [
        {
          label: 'URI provided',
          passed: false,
          detail: `Enter a URI to validate against ${canonicalUri}`,
        },
      ],
    };
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(candidate);
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return {
      valid: false,
      canonicalUri,
      checks: [
        {
          label: 'Valid URL syntax',
          passed: false,
          detail: 'The URI is not a valid absolute URL (must include https:// or http://localhost).',
        },
      ],
    };
  }

  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const isSecureScheme = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalhost);

  let expectedOrigin = '';
  try {
    expectedOrigin = new URL(backendBase).origin;
  } catch {
    expectedOrigin = backendBase;
  }

  const originMatches = parsed.origin === expectedOrigin;
  const exactPathMatches = parsed.pathname === expectedPath;
  const noTrailingSlashIssue = !parsed.pathname.endsWith('/') || expectedPath.endsWith('/');
  const noQueryOrHash = !parsed.search && !parsed.hash;
  const formTrimmed = configuredFormValue.trim();
  const matchesFormField = !platform.redirectFieldId || (Boolean(formTrimmed) && formTrimmed === candidate);

  const checks: RedirectCheckItem[] = [
    {
      label: 'HTTPS / Secure OAuth Protocol',
      passed: isSecureScheme,
      detail: isSecureScheme
        ? `Using ${parsed.protocol}// (${isLocalhost ? 'localhost allowed' : 'HTTPS verified'})`
        : `OAuth providers require https:// in production (found ${parsed.protocol}//)`,
    },
    {
      label: 'Backend Origin Match',
      passed: originMatches,
      detail: originMatches
        ? `Origin matches ${expectedOrigin}`
        : `Origin ${parsed.origin} differs from backend ${expectedOrigin}`,
    },
    {
      label: 'Exact Callback Route Path',
      passed: exactPathMatches && noTrailingSlashIssue,
      detail: exactPathMatches
        ? `Path matches ${expectedPath} exactly`
        : `Expected path ${expectedPath}, but found ${parsed.pathname}`,
    },
    {
      label: 'No Query Strings or URL Fragments',
      passed: noQueryOrHash,
      detail: noQueryOrHash
        ? 'Clean callback URI without ?query or #fragment'
        : 'Remove query parameters (?) and fragments (#) from registered redirect URIs',
    },
    {
      label: 'Matches Redirect URL Input Field',
      passed: matchesFormField,
      detail: matchesFormField
        ? 'Matches the Redirect URL configured in this form'
        : 'Does not match the Redirect URL field above — click "Auto-fill Valid URI" to sync',
    },
  ];

  return {
    valid: checks.every((c) => c.passed),
    canonicalUri,
    checks,
  };
}

export default function AdminIntegrations() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Record<string, PlatformRow>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [resendTestTo, setResendTestTo] = useState('');
  const [resendTesting, setResendTesting] = useState(false);
  const [resendTestResult, setResendTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Copy state for 1-click copy buttons
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Redirect URI Validator state
  const [validatorInput, setValidatorInput] = useState('');
  const [validatorRan, setValidatorRan] = useState(false);
  const [serverValidating, setServerValidating] = useState(false);
  const [serverMatchSaved, setServerMatchSaved] = useState<boolean | null>(null);

  const activeDef = useMemo(() => PLATFORMS.find((p) => p.id === activeId) ?? null, [activeId]);

  const copyValue = (key: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data.error || 'Failed to load configs');

      const next: Record<string, PlatformRow> = {};
      for (const r of data.configs || []) {
        next[String(r.platform || '').toLowerCase()] = {
          platform: String(r.platform || '').toLowerCase(),
          config: r.config || {},
          enabled: Boolean(r.enabled),
        };
      }
      setRows(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openConfigure = async (id: string) => {
    setActiveId(id);
    setSaveError(null);
    setTestMessage(null);
    setResendTestTo('');
    setResendTestResult(null);
    setValidatorRan(false);
    setServerMatchSaved(null);
    try {
      const def = PLATFORMS.find((p) => p.id === id) ?? null;
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${encodeURIComponent(id)}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data.error || 'Failed to load config');
      const cfg = data.config?.config || data.config || {};
      const row = rows[id] || { platform: id, config: {}, enabled: false };
      const merged = { ...row.config, ...cfg } as Record<string, unknown>;
      if (def?.fields.some((field) => field.id === 'redirectUri')) {
        const current = String(merged.redirectUri ?? '').trim();
        if (!current) {
          merged.redirectUri = buildRedirectUri(def);
        }
      }
      if (def?.fields.some((field) => field.id === 'calendarRedirectUri')) {
        const current = String(merged.calendarRedirectUri ?? '').trim();
        if (!current) {
          merged.calendarRedirectUri = `${getBackendBase()}/api/calendar/google/callback`;
        }
      }
      const nextForm = Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, String(v ?? '')]));
      setForm(nextForm);
      if (def) {
        const initialUri = def.redirectFieldId
          ? nextForm[def.redirectFieldId] || buildRedirectUri(def)
          : buildRedirectUri(def);
        setValidatorInput(initialUri);
      }
    } catch (e) {
      setForm({});
      setSaveError(e instanceof Error ? e.message : 'Failed to load config');
    }
  };

  const runRedirectValidator = async () => {
    if (!activeDef) return;
    setValidatorRan(true);
    setServerValidating(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/admin/platform-configs/${encodeURIComponent(activeDef.id)}/validate-redirect-uri`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ redirectUri: validatorInput.trim() }),
        }
      );
      const data = await res.json().catch(() => ({} as any));
      if (res.ok && data.success) {
        setServerMatchSaved(Boolean(data.matchesSaved));
      } else {
        setServerMatchSaved(null);
      }
    } catch {
      setServerMatchSaved(null);
    } finally {
      setServerValidating(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeDef) return;
    setSaving(true);
    setSaveError(null);
    try {
      const enabled = rows[activeDef.id]?.enabled ?? false;
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${encodeURIComponent(activeDef.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ config: form, enabled }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      await loadAll();
      setActiveId(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (id: string, nextEnabled: boolean) => {
    setToggling(id);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${encodeURIComponent(id)}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data.error || 'Failed to toggle');
      await loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to toggle');
    } finally {
      setToggling(null);
    }
  };

  const test = async (id: string) => {
    setTesting(id);
    setTestMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/${encodeURIComponent(id)}/test`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data.success === false) throw new Error(data.error || 'Test failed');
      setTestMessage({ ok: true, text: data.message || 'Credentials look valid.' });
    } catch (e) {
      setTestMessage({ ok: false, text: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setTesting(null);
    }
  };

  const sendResendTest = async () => {
    if (!resendTestTo.trim()) return;
    setResendTesting(true);
    setResendTestResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/resend/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          to: resendTestTo.trim(),
          apiKey: form.apiKey || undefined,
          fromEmail: form.fromEmail || undefined,
          fromName: form.fromName || undefined,
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      setResendTestResult({ ok: data.success === true, msg: data.message ?? data.error ?? 'Unknown response' });
    } catch {
      setResendTestResult({ ok: false, msg: 'Request failed' });
    } finally {
      setResendTesting(false);
    }
  };

  const activeValidation = useMemo(() => {
    if (!activeDef) return null;
    const fieldValue = activeDef.redirectFieldId ? form[activeDef.redirectFieldId] || '' : '';
    return evaluateRedirectUri(validatorInput, activeDef, fieldValue);
  }, [activeDef, form, validatorInput]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-white px-6 py-6 shadow-xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue">Developer Console & OAuth Compliance</div>
            <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.03em] text-ink">Integrations</h2>
            <p className="mt-1 text-sm text-muted">
              Configure developer credentials, Redirect URIs, Deauthorize Callback URLs, and Data Deletion Request URLs for each integration.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-soft px-3 py-1.5 font-mono text-[11px] text-ink">
              <ShieldCheck size={13} className="text-emerald" />
              Data Deletion Page: {buildDataDeletionPageUrl()}
            </span>
          </div>
        </div>
      </div>

      {testMessage ? (
        <div
          role="status"
          className={`rounded-xl border px-5 py-4 text-sm font-medium ${
            testMessage.ok ? 'border-emerald/30 bg-emerald/5 text-emerald' : 'border-danger-line bg-danger-surface text-danger-text'
          }`}
        >
          {testMessage.text}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-muted" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PLATFORMS.map((p) => {
            const row = rows[p.id] || { platform: p.id, config: {}, enabled: false };
            const isEnabled = Boolean(row.enabled);
            const isToggling = toggling === p.id;
            const isConfigured =
              p.fields.length === 0
                ? true
                : p.id === 'instagram' && !row.config?.appId && rows['facebook']?.config?.appId
                  ? Boolean(rows['facebook'].config.appId && rows['facebook'].config.appSecret)
                  : p.fields
                      .filter((f) => f.required !== false && f.id !== 'scopes')
                      .every((f) => String(row.config?.[f.id] || '').trim());

            const redirectUrl = buildRedirectUri(p);
            const deauthorizeUrl = buildDeauthorizeUrl(p);
            const dataDeletionUrl = buildDataDeletionCallbackUrl(p);
            const hasRedirectCallback = Boolean(p.redirectFieldId || p.expectedCallbackPath);

            return (
              <div
                key={p.id}
                className={`flex flex-col justify-between rounded-2xl border bg-white p-5 transition-all ${
                  isEnabled ? 'border-emerald/40 shadow-sm' : 'border-line hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <PlatformLogo platform={p.id} size={44} />
                    <button
                      type="button"
                      onClick={() => void toggle(p.id, !isEnabled)}
                      disabled={isToggling || (!isConfigured && !isEnabled)}
                      title={!isConfigured && !isEnabled ? 'Configure credentials first' : isEnabled ? 'Disable for users' : 'Enable for users'}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                        isEnabled ? 'bg-emerald/10 text-emerald hover:bg-emerald/20' : 'bg-soft text-muted hover:bg-slate-200/70'
                      }`}
                    >
                      {isToggling ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                      {isEnabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>

                  <div className="mt-3">
                    <h3 className="text-base font-bold text-ink">{p.name}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted">{p.description}</p>
                  </div>

                  {/* Quick Setup & Callback URLs preview on card */}
                  <div className="mt-4 space-y-2.5 rounded-xl border border-line bg-soft/70 px-3.5 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Setup & Callback URLs</span>
                      <a
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue hover:underline"
                        href={p.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={11} />
                        Developer Portal
                      </a>
                    </div>
                    <p className="text-[11px] leading-4 text-muted">{p.redirectHint}</p>

                    <div className="space-y-1.5 pt-1">
                      {hasRedirectCallback && (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5">
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold text-muted">Redirect / Callback URI</div>
                            <div className="truncate font-mono text-[11px] text-ink">{redirectUrl}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyValue(`card-redirect-${p.id}`, redirectUrl)}
                            className="shrink-0 rounded-md border border-line bg-soft px-2 py-1 text-[10px] font-semibold text-ink hover:bg-slate-200/60"
                            title="Copy Redirect URI"
                          >
                            {copiedKey === `card-redirect-${p.id}` ? 'Copied ✓' : 'Copy'}
                          </button>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5">
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold text-muted">Data Deletion Request URL</div>
                          <div className="truncate font-mono text-[11px] text-ink">{dataDeletionUrl}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyValue(`card-deletion-${p.id}`, dataDeletionUrl)}
                          className="shrink-0 rounded-md border border-line bg-soft px-2 py-1 text-[10px] font-semibold text-ink hover:bg-slate-200/60"
                          title="Copy Data Deletion Request URL"
                        >
                          {copiedKey === `card-deletion-${p.id}` ? 'Copied ✓' : 'Copy'}
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5">
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold text-muted">Deauthorize Callback URL</div>
                          <div className="truncate font-mono text-[11px] text-ink">{deauthorizeUrl}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyValue(`card-deauth-${p.id}`, deauthorizeUrl)}
                          className="shrink-0 rounded-md border border-line bg-soft px-2 py-1 text-[10px] font-semibold text-ink hover:bg-slate-200/60"
                          title="Copy Deauthorize Callback URL"
                        >
                          {copiedKey === `card-deauth-${p.id}` ? 'Copied ✓' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-line pt-3.5">
                  <span className={`text-xs font-semibold ${isConfigured ? 'text-emerald' : 'text-amber'}`}>
                    {isConfigured ? 'Configured' : 'Not configured'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void test(p.id)}
                      disabled={testing === p.id || (!isConfigured && p.fields.length > 0)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-soft disabled:opacity-50"
                      title={!isConfigured && p.fields.length > 0 ? 'Configure credentials first' : 'Test credentials'}
                    >
                      {testing === p.id ? <Loader2 size={12} className="animate-spin" /> : <TestTube2 size={12} />}
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={() => void openConfigure(p.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      <SlidersHorizontal size={12} />
                      Configure & Guide
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeDef ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs px-4 py-6">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div className="flex items-center gap-3">
                <PlatformLogo platform={activeDef.id} size={40} />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue">
                    Integration Configuration & Setup Guide
                  </div>
                  <div className="text-lg font-extrabold text-ink">{activeDef.name}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-muted hover:bg-soft hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={save} className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              {/* 1. Step-by-Step Setup Guide & Required Callback URLs */}
              <div className="rounded-xl border border-line bg-soft/60 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-ink">
                    <BookOpen size={14} className="text-blue" />
                    Step-by-Step Developer Setup Guide
                  </div>
                  <a
                    href={activeDef.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-semibold text-blue hover:bg-soft"
                  >
                    <ExternalLink size={12} />
                    Open {activeDef.name} Developer Docs
                  </a>
                </div>

                <ol className="space-y-1.5 text-xs leading-5 text-muted list-decimal list-inside">
                  {activeDef.setupSteps.map((step, idx) => (
                    <li key={idx} className="text-ink/90">
                      {step}
                    </li>
                  ))}
                </ol>

                {/* Copyable Callback & Compliance URLs */}
                <div className="grid gap-2.5 pt-1 sm:grid-cols-2">
                  {(activeDef.redirectFieldId || activeDef.expectedCallbackPath) && (
                    <div className="sm:col-span-2 rounded-xl border border-line bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-ink">
                          Valid OAuth Redirect URI / Callback URL
                        </span>
                        <button
                          type="button"
                          onClick={() => copyValue('modal-redirect', buildRedirectUri(activeDef))}
                          className="inline-flex items-center gap-1 rounded-md border border-line bg-soft px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-slate-200/70"
                        >
                          {copiedKey === 'modal-redirect' ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
                          {copiedKey === 'modal-redirect' ? 'Copied' : 'Copy URI'}
                        </button>
                      </div>
                      <div className="mt-1 select-all break-all font-mono text-xs text-blue">
                        {buildRedirectUri(activeDef)}
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-line bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-ink">
                        Data Deletion Request URL (Webhook)
                      </span>
                      <button
                        type="button"
                        onClick={() => copyValue('modal-deletion', buildDataDeletionCallbackUrl(activeDef))}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-soft px-2 py-1 text-[11px] font-semibold text-ink hover:bg-slate-200/70"
                      >
                        {copiedKey === 'modal-deletion' ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
                        {copiedKey === 'modal-deletion' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="mt-1 select-all break-all font-mono text-xs text-ink">
                      {buildDataDeletionCallbackUrl(activeDef)}
                    </div>
                    <div className="mt-1 text-[10px] text-muted">
                      Paste in your app&apos;s Data Deletion Request Callback field.
                    </div>
                  </div>

                  <div className="rounded-xl border border-line bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-ink">
                        Deauthorize Callback URL
                      </span>
                      <button
                        type="button"
                        onClick={() => copyValue('modal-deauth', buildDeauthorizeUrl(activeDef))}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-soft px-2 py-1 text-[11px] font-semibold text-ink hover:bg-slate-200/70"
                      >
                        {copiedKey === 'modal-deauth' ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
                        {copiedKey === 'modal-deauth' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="mt-1 select-all break-all font-mono text-xs text-ink">
                      {buildDeauthorizeUrl(activeDef)}
                    </div>
                    <div className="mt-1 text-[10px] text-muted">
                      Paste in your app&apos;s Deauthorize / Uninstall Callback field.
                    </div>
                  </div>

                  <div className="sm:col-span-2 rounded-xl border border-line bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-ink">
                        Data Deletion Instructions URL (Public User Page)
                      </span>
                      <button
                        type="button"
                        onClick={() => copyValue('modal-deletion-page', buildDataDeletionPageUrl())}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-soft px-2 py-1 text-[11px] font-semibold text-ink hover:bg-slate-200/70"
                      >
                        {copiedKey === 'modal-deletion-page' ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
                        {copiedKey === 'modal-deletion-page' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="mt-1 select-all break-all font-mono text-xs text-ink">
                      {buildDataDeletionPageUrl()}
                    </div>
                    <div className="mt-1 text-[10px] text-muted">
                      Use this URL if the developer portal asks for a public Data Deletion Instructions webpage instead of a POST webhook.
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Credentials Form (App ID / Client ID & Secret) */}
              <div>
                <div className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-ink">
                  App Credentials (ID, Secret & Redirect URL)
                </div>
                {activeDef.fields.length === 0 ? (
                  <div className="rounded-xl border border-line bg-soft p-4 text-sm text-muted">
                    No admin OAuth credentials required for {activeDef.name}. Users connect directly with their own credentials on the Integrations page.
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {activeDef.fields.map((f) => {
                      const isRedirectField = f.id === 'redirectUri' || f.id === 'calendarRedirectUri';
                      return (
                        <div key={f.id} className={isRedirectField ? 'sm:col-span-2' : ''}>
                          <label className="text-xs font-semibold text-ink">{f.label}</label>
                          <input
                            type={f.type}
                            value={form[f.id] || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setForm((prev) => ({ ...prev, [f.id]: val }));
                              if (isRedirectField) {
                                setValidatorInput(val);
                              }
                            }}
                            placeholder={f.placeholder}
                            className="mt-1 w-full rounded-xl border border-line bg-soft px-4 py-2.5 text-sm text-ink outline-none focus:border-blue focus:bg-white"
                          />
                          {isRedirectField ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const canonical = buildRedirectUri(activeDef);
                                  setForm((prev) => ({ ...prev, [f.id]: canonical }));
                                  setValidatorInput(canonical);
                                }}
                                className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-soft"
                              >
                                Use default redirect
                              </button>
                              <button
                                type="button"
                                onClick={() => copyValue(`field-redirect-${activeDef.id}`, buildRedirectUri(activeDef))}
                                className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-soft"
                              >
                                {copiedKey === `field-redirect-${activeDef.id}` ? 'Copied ✓' : 'Copy default'}
                              </button>
                              <span className="font-mono text-[11px] text-muted">{buildRedirectUri(activeDef)}</span>
                            </div>
                          ) : null}
                          <div className="mt-1 text-[11px] leading-5 text-muted">{f.helpText}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 3. Redirect URI Validator (for all OAuth / Callback tools) */}
              {(activeDef.redirectFieldId || activeDef.expectedCallbackPath) && activeValidation && (
                <div className="rounded-xl border border-line bg-soft/50 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-ink">
                        <ShieldCheck size={15} className="text-blue" />
                        Redirect URI Validator
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        Paste any Redirect URI from your {activeDef.name} developer portal to verify that it matches the backend callback route and saved settings.
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                        activeValidation.valid
                          ? 'bg-emerald/10 text-emerald'
                          : 'bg-amber/15 text-amber'
                      }`}
                    >
                      {activeValidation.valid ? (
                        <>
                          <CheckCircle size={13} /> Valid Redirect URI
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={13} /> Needs Attention
                        </>
                      )}
                    </span>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={validatorInput}
                      onChange={(e) => setValidatorInput(e.target.value)}
                      placeholder={activeValidation.canonicalUri}
                      className="flex-1 rounded-xl border border-line bg-white px-3.5 py-2 font-mono text-xs text-ink outline-none focus:border-blue"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void runRedirectValidator()}
                        disabled={serverValidating}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-blue px-4 py-2 text-xs font-bold text-white hover:bg-blue/90 disabled:opacity-50"
                      >
                        {serverValidating ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                        Check URI
                      </button>
                      {!activeValidation.valid && (
                        <button
                          type="button"
                          onClick={() => {
                            const canonical = activeValidation.canonicalUri;
                            setValidatorInput(canonical);
                            if (activeDef.redirectFieldId) {
                              setForm((prev) => ({ ...prev, [activeDef.redirectFieldId!]: canonical }));
                            }
                            setValidatorRan(true);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-soft"
                        >
                          <Sparkles size={13} className="text-blue" />
                          Auto-fill Valid URI
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Diagnostic Checklist */}
                  <div className="grid gap-1.5 pt-1 sm:grid-cols-2">
                    {activeValidation.checks.map((chk, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                          chk.passed
                            ? 'border-emerald/25 bg-emerald/5 text-ink'
                            : 'border-amber/30 bg-amber/5 text-ink'
                        }`}
                      >
                        {chk.passed ? (
                          <CheckCircle size={14} className="mt-0.5 shrink-0 text-emerald" />
                        ) : (
                          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber" />
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold">{chk.label}</div>
                          <div className="text-[11px] text-muted break-words">{chk.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {validatorRan && serverMatchSaved !== null && (
                    <div className="text-[11px] text-muted">
                      Server config check:{' '}
                      <strong className={serverMatchSaved ? 'text-emerald' : 'text-amber'}>
                        {serverMatchSaved
                          ? 'Matches the currently saved database Redirect URI ✓'
                          : 'Click "Save" below to persist this Redirect URI to the server.'}
                      </strong>
                    </div>
                  )}
                </div>
              )}

              {saveError ? (
                <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                  {saveError}
                </div>
              ) : null}

              {activeDef.id === 'resend' && (
                <div className="border-t border-line pt-4 space-y-2">
                  <p className="text-xs font-semibold text-ink">Send a test email</p>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={resendTestTo}
                      onChange={(e) => setResendTestTo(e.target.value)}
                      placeholder="your@email.com"
                      className="flex-1 rounded-xl border border-line bg-soft px-3 py-2 text-sm text-ink outline-none focus:border-blue focus:bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => void sendResendTest()}
                      disabled={resendTesting || !resendTestTo.trim()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-soft disabled:opacity-50"
                    >
                      {resendTesting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      Test
                    </button>
                  </div>
                  {resendTestResult && (
                    <p className={`text-xs font-medium ${resendTestResult.ok ? 'text-emerald' : 'text-danger'}`}>
                      {resendTestResult.ok ? '✓' : '✗'} {resendTestResult.msg}
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-line pt-4">
                <div className="text-xs text-muted">
                  <CheckCircle size={14} className="inline-block mr-1 text-emerald" />
                  Secrets are encrypted at rest server-side. Users never see them.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveId(null)}
                    className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-soft"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
                    Save Configuration
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
