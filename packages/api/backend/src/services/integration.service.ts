import axios from "axios";
import crypto from "crypto";
import { ConnectionStatus, Integration, UserIntegration } from "@prisma/client";
import { encryptToken, decryptToken } from "../utils/encryption";
import { logIntegrationEvent } from "../utils/integration-log";
import { FacebookAdapter } from "./platform-adapters/facebook.adapter";
import { InstagramAdapter } from "./platform-adapters/instagram.adapter";
import { TwitterAdapter } from "./platform-adapters/twitter.adapter";
import { LinkedInAdapter } from "./platform-adapters/linkedin.adapter";
import { PinterestAdapter } from "./platform-adapters/pinterest.adapter";
import { prisma } from "../utils/prisma";


const DEFAULT_INTEGRATIONS: Array<Pick<Integration, "name" | "slug" | "type">> = [
  { name: "Facebook", slug: "facebook", type: "social" },
  { name: "Instagram", slug: "instagram", type: "social" },
  { name: "Twitter", slug: "twitter", type: "social" },
  { name: "LinkedIn", slug: "linkedin", type: "social" },
  { name: "Pinterest", slug: "pinterest", type: "social" },
  { name: "WordPress", slug: "wordpress", type: "cms" },
];

type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
};

type AccountInfo = {
  accountId: string;
  accountName: string;
  accountEmail?: string | null;
  accessToken?: string;
};

const toBase64Url = (buffer: Buffer) =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const createCodeChallenge = (verifier: string) =>
  toBase64Url(crypto.createHash("sha256").update(verifier).digest());

const getRedirectUrl = (platform: string) => {
  const key = `${platform.toUpperCase()}_REDIRECT_URL`;
  return process.env[key] || "";
};

const getClientId = (platform: string) => {
  const key = `${platform.toUpperCase()}_CLIENT_ID`;
  const appKey = `${platform.toUpperCase()}_APP_ID`;
  return process.env[key] || process.env[appKey] || "";
};

const getClientSecret = (platform: string) => {
  const key = `${platform.toUpperCase()}_CLIENT_SECRET`;
  const appKey = `${platform.toUpperCase()}_APP_SECRET`;
  return process.env[key] || process.env[appKey] || "";
};

export class IntegrationService {
  private static async ensureDefaults() {
    const count = await prisma.integration.count();
    if (count > 0) return;
    for (const integration of DEFAULT_INTEGRATIONS) {
      await prisma.integration.upsert({
        where: { slug: integration.slug },
        update: {},
        create: integration,
      });
    }
  }

  static async getIntegrations(type?: string) {
    await this.ensureDefaults();
    return prisma.integration.findMany({
      where: type ? { type } : undefined,
      orderBy: { name: "asc" },
    });
  }

  static getOAuthUrl(platform: string, state: string, codeVerifier?: string) {
    const slug = platform.toLowerCase();
    const clientId = getClientId(slug);
    const redirectUri = getRedirectUrl(slug);
    if (!clientId || !redirectUri) return null;

    const scopeMap: Record<string, string[]> = {
      facebook: [
        "public_profile",
        "email",
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
        "pages_read_user_content",
      ],
      instagram: [
        "instagram_basic",
        "instagram_content_publish",
        "pages_show_list",
        "pages_read_engagement",
      ],
      twitter: ["tweet.read", "tweet.write", "users.read", "offline.access"],
      linkedin: ["r_liteprofile", "r_emailaddress", "w_member_social"],
      pinterest: ["boards:read", "boards:write", "pins:read", "pins:write", "user_accounts:read"],
    };

    if (slug === "twitter") {
      if (!codeVerifier) throw new Error("Missing code verifier for Twitter");
      const codeChallenge = createCodeChallenge(codeVerifier);
      const url = new URL("https://twitter.com/i/oauth2/authorize");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", scopeMap.twitter.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    }

    if (slug === "linkedin") {
      const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", scopeMap.linkedin.join(" "));
      url.searchParams.set("state", state);
      return url.toString();
    }

    if (slug === "pinterest") {
      const url = new URL("https://www.pinterest.com/oauth/");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", scopeMap.pinterest.join(","));
      url.searchParams.set("state", state);
      return url.toString();
    }

    // Facebook + Instagram (Meta)
    const url = new URL("https://www.facebook.com/v18.0/dialog/oauth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", (scopeMap[slug] || []).join(","));
    url.searchParams.set("response_type", "code");
    return url.toString();
  }

  static async connectIntegration(
    userId: string,
    integrationSlug: string,
    authCode: string,
    _state?: string,
    codeVerifier?: string
  ) {
    return this.handleOAuthCallback(integrationSlug, authCode, userId, codeVerifier);
  }

  static async handleOAuthCallback(
    platform: string,
    code: string,
    userId: string,
    codeVerifier?: string
  ) {
    const slug = platform.toLowerCase();
    const integration = await prisma.integration.findUnique({
      where: { slug },
    });
    if (!integration) throw new Error("Integration not configured");

    const tokens = await this.handleCallback(slug, code, codeVerifier);
    const expiresAt = tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000)
      : undefined;

    const accounts = await this.getAccountsFromProvider(slug, tokens.accessToken);
    if (!accounts.length) {
      throw new Error("No accounts returned from provider");
    }

    const results = [] as UserIntegration[];
    for (const account of accounts) {
      const accessToken = encryptToken(account.accessToken || tokens.accessToken);
      const refreshToken = tokens.refreshToken
        ? encryptToken(tokens.refreshToken)
        : null;

      const userIntegration = await prisma.userIntegration.upsert({
        where: {
          userId_integrationId_accountId: {
            userId,
            integrationId: integration.id,
            accountId: account.accountId,
          },
        },
        update: {
          accessToken,
          refreshToken,
          tokenExpiry: expiresAt,
          accountName: account.accountName,
          accountEmail: account.accountEmail || null,
          status: ConnectionStatus.CONNECTED,
        },
        create: {
          userId,
          integrationId: integration.id,
          accessToken,
          refreshToken,
          tokenExpiry: expiresAt,
          accountId: account.accountId,
          accountName: account.accountName,
          accountEmail: account.accountEmail || null,
          status: ConnectionStatus.CONNECTED,
        },
      });

      await logIntegrationEvent({
        userId,
        integrationId: integration.id,
        userIntegrationId: userIntegration.id,
        eventType: "connection",
        status: "success",
        response: { platform: slug, accountId: account.accountId },
      });

      results.push(userIntegration);
    }

    return results;
  }

  static async handleCallback(
    platform: string,
    code: string,
    codeVerifier?: string
  ): Promise<OAuthTokens> {
    const slug = platform.toLowerCase();
    const clientId = getClientId(slug);
    const clientSecret = getClientSecret(slug);
    const redirectUri = getRedirectUrl(slug);

    if (!clientId || !redirectUri) {
      throw new Error("OAuth credentials missing");
    }

    if (slug === "twitter") {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier || "",
      });

      const response = await axios.post(
        "https://api.twitter.com/2/oauth2/token",
        body.toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type,
      };
    }

    if (slug === "linkedin") {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });
      const response = await axios.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        body.toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
      };
    }

    if (slug === "pinterest") {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      });
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const response = await axios.post(
        "https://api.pinterest.com/v5/oauth/token",
        body.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${auth}`,
          },
        }
      );
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
      };
    }

    // Meta OAuth
    const response = await axios.get(
      "https://graph.facebook.com/v18.0/oauth/access_token",
      {
        params: {
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
        },
      }
    );

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
    };
  }

  static async refreshToken(userIntegrationId: string) {
    const userIntegration = await prisma.userIntegration.findUnique({
      where: { id: userIntegrationId },
      include: { integration: true },
    });

    if (!userIntegration) throw new Error("Integration not found");
    const slug = userIntegration.integration.slug;
    const refreshTokenEncrypted = userIntegration.refreshToken;
    if (!refreshTokenEncrypted) {
      throw new Error("Refresh token not available");
    }

    const refreshToken = decryptToken(refreshTokenEncrypted);
    const clientId = getClientId(slug);
    const clientSecret = getClientSecret(slug);
    const redirectUri = getRedirectUrl(slug);

    let tokens: OAuthTokens | null = null;

    if (slug === "twitter") {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      });
      const response = await axios.post(
        "https://api.twitter.com/2/oauth2/token",
        body.toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      tokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
      };
    } else if (slug === "linkedin") {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });
      const response = await axios.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        body.toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      tokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
      };
    } else if (slug === "pinterest") {
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      const response = await axios.post(
        "https://api.pinterest.com/v5/oauth/token",
        body.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${auth}`,
          },
        }
      );
      tokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
      };
    } else if (slug === "facebook" || slug === "instagram") {
      const response = await axios.get(
        "https://graph.facebook.com/v18.0/oauth/access_token",
        {
          params: {
            grant_type: "fb_exchange_token",
            client_id: clientId,
            client_secret: clientSecret,
            fb_exchange_token: refreshToken,
          },
        }
      );
      tokens = {
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in,
      };
    }

    if (!tokens) throw new Error("Refresh not supported for this platform");

    const expiresAt = tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000)
      : null;

    const updated = await prisma.userIntegration.update({
      where: { id: userIntegrationId },
      data: {
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: tokens.refreshToken
          ? encryptToken(tokens.refreshToken)
          : userIntegration.refreshToken,
        tokenExpiry: expiresAt ?? undefined,
      },
    });

    await logIntegrationEvent({
      userId: updated.userId,
      integrationId: updated.integrationId,
      userIntegrationId: updated.id,
      eventType: "token_refresh",
      status: "success",
    });

    return updated;
  }

  static async getUserIntegrations(userId: string) {
    const integrations = await prisma.userIntegration.findMany({
      where: { userId },
      include: {
        integration: true,
        posts: {
          where: { postedAt: { not: null } },
          orderBy: { postedAt: "desc" },
          take: 1,
          select: { postedAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return integrations.map(({ posts, ...integration }) => ({
      ...integration,
      lastUsed: posts[0]?.postedAt ?? null,
    }));
  }

  static async getAccounts(userIntegrationId: string) {
    const current = await prisma.userIntegration.findUnique({
      where: { id: userIntegrationId },
    });
    if (!current) return [];

    return prisma.userIntegration.findMany({
      where: {
        userId: current.userId,
        integrationId: current.integrationId,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  static async getIntegrationStatus(userIntegrationId: string) {
    const integration = await prisma.userIntegration.findUnique({
      where: { id: userIntegrationId },
      include: { integration: true },
    });
    if (!integration) throw new Error("Integration not found");

    const expiry = integration.tokenExpiry;
    if (expiry && expiry.getTime() < Date.now()) {
      return { valid: false, status: ConnectionStatus.EXPIRED };
    }

    const accessToken = integration.accessToken
      ? decryptToken(integration.accessToken)
      : "";
    const validation = await this.validateToken(accessToken, integration.integration.slug);
    return {
      valid: validation.valid,
      status: validation.valid
        ? ConnectionStatus.CONNECTED
        : ConnectionStatus.ERROR,
    };
  }

  static async validateToken(accessToken: string, platform: string) {
    const slug = platform.toLowerCase();
    switch (slug) {
      case "facebook":
        return FacebookAdapter.validateToken(accessToken);
      case "instagram":
        return InstagramAdapter.validateToken(accessToken);
      case "twitter":
        return TwitterAdapter.validateToken(accessToken);
      case "linkedin":
        return LinkedInAdapter.validateToken(accessToken);
      case "pinterest":
        return PinterestAdapter.validateToken(accessToken);
      default:
        return { valid: false };
    }
  }

  static async getPages(accessToken: string, platform: string) {
    const slug = platform.toLowerCase();
    switch (slug) {
      case "facebook":
        return FacebookAdapter.getPages(accessToken);
      case "instagram":
        return InstagramAdapter.getAccounts(accessToken);
      case "twitter":
        return TwitterAdapter.getProfile(accessToken);
      case "linkedin":
        return LinkedInAdapter.getProfile(accessToken);
      case "pinterest":
        return PinterestAdapter.getBoards(accessToken);
      default:
        return [];
    }
  }

  static async disconnectIntegration(userId: string, userIntegrationId: string) {
    const integration = await prisma.userIntegration.findUnique({
      where: { id: userIntegrationId },
    });
    if (!integration) throw new Error("Integration not found");
    if (integration.userId !== userId) throw new Error("Not authorized");

    await prisma.userIntegration.delete({ where: { id: userIntegrationId } });

    await logIntegrationEvent({
      userId,
      integrationId: integration.integrationId,
      userIntegrationId,
      eventType: "disconnect",
      status: "success",
    });

    return { success: true, message: "Disconnected" };
  }

  private static async getAccountsFromProvider(
    platform: string,
    accessToken: string
  ): Promise<AccountInfo[]> {
    const slug = platform.toLowerCase();

    if (slug === "facebook") {
      const pages = await FacebookAdapter.getPages(accessToken);
      return pages.map((page: any) => ({
        accountId: page.id,
        accountName: page.name,
        accessToken: page.access_token,
      }));
    }

    if (slug === "instagram") {
      const accounts = await InstagramAdapter.getAccounts(accessToken);
      return accounts.map((acc: any) => ({
        accountId: acc.id,
        accountName: acc.username || acc.name || acc.id,
      }));
    }

    if (slug === "twitter") {
      const profile = await TwitterAdapter.getProfile(accessToken);
      if (!profile) return [];
      return [
        {
          accountId: profile.id,
          accountName: profile.name || profile.username || profile.id,
          accountEmail: profile.email,
        },
      ];
    }

    if (slug === "linkedin") {
      const profile = await LinkedInAdapter.getProfile(accessToken);
      if (!profile) return [];
      return [
        {
          accountId: profile.id,
          accountName: profile.name || profile.id,
          accountEmail: profile.email,
        },
      ];
    }

    if (slug === "pinterest") {
      const boards = await PinterestAdapter.getBoards(accessToken);
      if (!boards?.length) return [];
      return boards.map((board: any) => ({
        accountId: board.id,
        accountName: board.name || board.id,
      }));
    }

    return [];
  }
}


