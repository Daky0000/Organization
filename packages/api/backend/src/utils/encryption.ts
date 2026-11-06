import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

const getKey = () => {
  const raw = process.env.ENCRYPTION_KEY || "";
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is required for token encryption");
  }
  return crypto.createHash("sha256").update(raw).digest();
};

export const encryptToken = (token: string): string => {
  if (!token) return token;
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString(
      "base64"
    )}`;
  } catch (error) {
    console.error("Token encryption failed:", error);
    return token;
  }
};

export const decryptToken = (encrypted: string): string => {
  if (!encrypted) return encrypted;
  try {
    const [ivB64, tagB64, dataB64] = encrypted.split(":");
    if (!ivB64 || !tagB64 || !dataB64) return encrypted;
    const key = getKey();
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (error) {
    console.error("Token decryption failed:", error);
    return encrypted;
  }
};
