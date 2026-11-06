import { formatCompactNumber, formatPercent, formatShortDate } from './analyticsUtils';

type TopPost = {
  id: string;
  title: string;
  publishedAt: string | null;
  platforms: string[];
  type: 'image' | 'text';
  successfulPublishes: number;
  failedPublishes: number;
  reach: number | null;
  engagement: number | null;
  engagementRate: number | null;
  score: number;
  scoreLabel: string;
};

type TopPostsTableProps = {
  posts: TopPost[];
  performanceMode: boolean;
};

const TopPostsTable = ({ posts, performanceMode }: TopPostsTableProps) => {
  if (posts.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        No published posts landed in this date range.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6" data-testid="top-posts-table">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-950">Top Posts</h3>
          <p className="text-sm text-slate-500">
            {performanceMode
              ? 'Ranked by logged engagement rate where metrics exist.'
              : 'Ranked by distribution score using publish success, platform spread, and content richness.'}
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-400">
            <tr>
              <th className="pb-3 text-left font-semibold">Post</th>
              <th className="pb-3 text-left font-semibold">Type</th>
              <th className="pb-3 text-right font-semibold">{posts[0]?.scoreLabel || 'Score'}</th>
              <th className="pb-3 text-right font-semibold">Publishes</th>
              <th className="pb-3 text-right font-semibold">{performanceMode ? 'Reach' : 'Engagement'}</th>
              <th className="pb-3 text-left font-semibold">Platforms</th>
              <th className="pb-3 text-right font-semibold">Date</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr key={post.id} className="border-b border-slate-100 align-top">
                <td className="py-4 pr-4">
                  <div className="font-semibold text-slate-900">{post.title}</div>
                </td>
                <td className="py-4 pr-4 capitalize text-slate-600">{post.type}</td>
                <td className="py-4 pr-4 text-right font-semibold text-slate-900">
                  {performanceMode ? formatPercent(post.score) : formatCompactNumber(post.score)}
                </td>
                <td className="py-4 pr-4 text-right text-slate-600">
                  {post.successfulPublishes}
                  {post.failedPublishes > 0 ? ` / ${post.failedPublishes} failed` : ''}
                </td>
                <td className="py-4 pr-4 text-right text-slate-600">
                  {performanceMode ? formatCompactNumber(post.reach) : formatCompactNumber(post.engagement)}
                </td>
                <td className="py-4 pr-4">
                  <div className="flex flex-wrap justify-end gap-2">
                    {post.platforms.length > 0 ? (
                      post.platforms.map((platform) => (
                        <span key={`${post.id}-${platform}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                          {platform}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-400">N/A</span>
                    )}
                  </div>
                </td>
                <td className="py-4 text-right text-slate-500">{formatShortDate(post.publishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TopPostsTable;
