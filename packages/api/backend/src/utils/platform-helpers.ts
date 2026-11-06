export const formatContent = (content: unknown, platform: string): string => {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "object") {
    const data = content as Record<string, unknown>;
    const key = platform.toLowerCase();
    const fallback =
      data[key] ??
      data.original ??
      data.text ??
      data.default ??
      "";
    return typeof fallback === "string" ? fallback : JSON.stringify(fallback);
  }
  return String(content);
};

export const pickPlatformContent = (
  content: unknown,
  platform: string
): string => {
  return formatContent(content, platform);
};
