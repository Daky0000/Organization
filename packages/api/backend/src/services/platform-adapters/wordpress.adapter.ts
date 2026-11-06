import axios from "axios";
import { UserIntegration } from "@prisma/client";
import { logIntegrationEvent } from "../../utils/integration-log";

export class WordPressAdapter {
  static async publishPost(
    content: string,
    title: string,
    _media: { url?: string } | null,
    userIntegration: UserIntegration
  ) {
    try {
      const siteUrl = this.resolveSiteUrl(userIntegration);
      const authHeader = this.resolveAuth(userIntegration);

      const resp = await axios.post(
        `${siteUrl}/wp-json/wp/v2/posts`,
        { title, content, status: "publish" },
        { headers: { Authorization: authHeader } }
      );
      return { success: true, platformPostId: resp.data?.id };
    } catch (error: any) {
      await logIntegrationEvent({
        userId: userIntegration.userId,
        integrationId: userIntegration.integrationId,
        userIntegrationId: userIntegration.id,
        eventType: "post_publish",
        status: "failed",
        errorMessage: error?.message || "WordPress publish failed",
      });
      return {
        success: false,
        error:
          error?.response?.data?.message ||
          error?.message ||
          "WordPress publish failed",
      };
    }
  }

  static async validateConnection(
    siteUrl: string,
    username: string,
    password: string
  ) {
    try {
      const auth = Buffer.from(`${username}:${password}`).toString("base64");
      const resp = await axios.get(`${siteUrl}/wp-json/wp/v2/users/me`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      return { valid: resp.status < 400, data: resp.data };
    } catch (error: any) {
      return { valid: false, error: error?.message || "WordPress auth failed" };
    }
  }

  static async uploadMedia(
    fileUrl: string,
    userIntegration: UserIntegration
  ) {
    const siteUrl = this.resolveSiteUrl(userIntegration);
    const authHeader = this.resolveAuth(userIntegration);
    const fileResp = await axios.get(fileUrl, { responseType: "arraybuffer" });
    const resp = await axios.post(
      `${siteUrl}/wp-json/wp/v2/media`,
      fileResp.data,
      {
        headers: {
          Authorization: authHeader,
          "Content-Type": "image/jpeg",
        },
      }
    );
    return resp.data?.id;
  }

  static async getCategories(userIntegration: UserIntegration) {
    const siteUrl = this.resolveSiteUrl(userIntegration);
    const authHeader = this.resolveAuth(userIntegration);
    const resp = await axios.get(`${siteUrl}/wp-json/wp/v2/categories`, {
      headers: { Authorization: authHeader },
    });
    return resp.data || [];
  }

  private static resolveSiteUrl(userIntegration: UserIntegration) {
    if (userIntegration.accountId?.startsWith("http")) {
      return userIntegration.accountId;
    }
    return process.env.WORDPRESS_SITE_URL || "";
  }

  private static resolveAuth(userIntegration: UserIntegration) {
    const token = userIntegration.accessToken || "";
    if (!token) return "";
    if (token.startsWith("Basic ")) return token;

    if (token.includes(":")) {
      const auth = Buffer.from(token).toString("base64");
      return `Basic ${auth}`;
    }

    return `Basic ${token}`;
  }
}
