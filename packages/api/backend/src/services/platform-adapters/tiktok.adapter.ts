import axios from "axios";

const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

export class TikTokAdapter {
  static async getAccountProfile(openId: string, accessToken: string) {
    try {
      const resp = await axios.get(`${TIKTOK_API_BASE}/user/info/`, {
        params: {
          fields: "open_id,union_id,avatar_url,display_name,username,follower_count,following_count,likes_count",
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const user = resp.data?.data?.user || {};
      return {
        username: user.username || user.display_name || "",
        followers: user.follower_count || 0,
        followings: user.following_count || 0,
        total_likes: user.likes_count || 0,
        bio: null,
        verified: false,
        raw: user,
      };
    } catch (error: any) {
      return { error: error?.message || "TikTok profile fetch failed" };
    }
  }
}
