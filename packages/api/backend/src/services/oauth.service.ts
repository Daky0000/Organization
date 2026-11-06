import crypto from "crypto";

export class OAuthService {
  static generateState() {
    return crypto.randomBytes(16).toString("hex");
  }
}
