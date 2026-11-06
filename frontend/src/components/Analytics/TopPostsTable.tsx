import React, { useMemo, useState } from "react";

type PostRow = {
  id: string;
  title: string;
  platforms: string[];
  engagement?: number | null;
  reach?: number | null;
  postedAt?: string | null;
};

type Props = {
  posts: PostRow[];
  onView?: (id: string) => void;
};

const platformBadge = (platform: string) =>
  platform.slice(0, 2).toUpperCase();

const formatValue = (value?: number | null) =>
  value === null || value === undefined ? "N/A" : value.toLocaleString();

export const TopPostsTable: React.FC<Props> = ({ posts, onView }) => {
  const [sortKey, setSortKey] = useState<"engagement" | "reach" | "date">(
    "engagement"
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const data = [...posts];
    data.sort((a, b) => {
      const aValue =
        sortKey === "reach"
          ? a.reach ?? -1
          : sortKey === "date"
            ? a.postedAt
              ? new Date(a.postedAt).getTime()
              : 0
            : a.engagement ?? -1;
      const bValue =
        sortKey === "reach"
          ? b.reach ?? -1
          : sortKey === "date"
            ? b.postedAt
              ? new Date(b.postedAt).getTime()
              : 0
            : b.engagement ?? -1;
      const delta = aValue - bValue;
      return sortDir === "asc" ? delta : -delta;
    });
    return data;
  }, [posts, sortKey, sortDir]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  if (!posts.length) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
        <p className="text-sm font-semibold text-slate-200">No posts published yet</p>
        <p className="mt-2 text-xs text-slate-500">
          Publish posts to see analytics for your top content.
        </p>
        <a
          href="/posts/new"
          className="mt-4 inline-flex rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
        >
          Create First Post
        </a>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <table className="min-w-full text-left text-xs text-slate-300">
        <thead>
          <tr className="border-b border-slate-800 text-slate-500">
            <th className="py-2 pr-4">Title</th>
            <th className="py-2 pr-4">Platforms</th>
            <th
              className="py-2 pr-4 cursor-pointer"
              onClick={() => toggleSort("engagement")}
            >
              Engagement
            </th>
            <th
              className="py-2 pr-4 cursor-pointer"
              onClick={() => toggleSort("reach")}
            >
              Reach
            </th>
            <th
              className="py-2 pr-4 cursor-pointer hidden md:table-cell"
              onClick={() => toggleSort("date")}
            >
              Posted
            </th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((post, index) => (
            <tr
              key={post.id}
              className={`border-b border-slate-900 ${
                index === 0 ? "bg-indigo-500/10" : ""
              }`}
            >
              <td className="py-3 pr-4 font-semibold text-slate-100">
                {post.title.length > 40
                  ? `${post.title.slice(0, 40)}...`
                  : post.title}
              </td>
              <td className="py-3 pr-4">
                <div className="flex flex-wrap gap-2">
                  {post.platforms.map((platform) => (
                    <span
                      key={`${post.id}-${platform}`}
                      className="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-200"
                    >
                      {platformBadge(platform)}
                    </span>
                  ))}
                </div>
              </td>
              <td className="py-3 pr-4">{formatValue(post.engagement)}</td>
              <td className="py-3 pr-4">{formatValue(post.reach)}</td>
              <td className="py-3 pr-4 hidden md:table-cell">
                {post.postedAt
                  ? new Date(post.postedAt).toLocaleDateString()
                  : "N/A"}
              </td>
              <td className="py-3">
                <button
                  type="button"
                  onClick={() => onView?.(post.id)}
                  className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-200"
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
