import React from "react";
import type { Post } from "../../hooks/usePosts";
import type { UserIntegration } from "../../hooks/useIntegrations";

const platformLimits: Record<string, number> = {
  twitter: 280,
  instagram: 2200,
  linkedin: 3000,
  pinterest: 500,
  facebook: 63206,
  wordpress: 20000,
};

const highlightHashtags = (text: string) => {
  const parts = text.split(/(#[\w-]+)/g);
  return parts.map((part, index) =>
    part.startsWith("#") ? (
      <span key={index} className="text-indigo-300">
        {part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    )
  );
};

const getContentForPlatform = (post: Post, slug: string) => {
  if (typeof post.content === "string") return post.content;
  if (!post.content) return "";
  return post.content[slug] || post.content.original || "";
};

type Props = {
  post: Post;
  integrations: UserIntegration[];
};

export const PostPreview: React.FC<Props> = ({ post, integrations }) => {
  if (!integrations.length) return null;

  return (
    <div className="space-y-4">
      {integrations.map((integration) => {
        const slug = integration.integration?.slug || "";
        const content = getContentForPlatform(post, slug);
        const limit = platformLimits[slug];
        const count = content?.length || 0;
        const overLimit = limit ? count > limit : false;

        return (
          <div
            key={integration.id}
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-100">
                  {integration.integration?.name || "Platform"}
                </p>
                <p className="text-xs text-slate-400">
                  {integration.accountName || "Primary account"}
                </p>
              </div>
              {limit && (
                <p
                  className={`text-xs ${
                    overLimit ? "text-red-300" : "text-slate-400"
                  }`}
                >
                  {count}/{limit}
                </p>
              )}
            </div>

            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-200">
              {highlightHashtags(content)}
            </div>

            {overLimit && (
              <p className="mt-2 text-xs text-red-300">
                Content exceeds platform limit.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};
