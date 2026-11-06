import type { LinkMetadata } from '../../../types/linkMetadata';
import LinkPreviewCard from './LinkPreviewCard';

type MockupProps = {
  caption: string;
  mediaUrls?: string[];
  linkMeta?: LinkMetadata | null;
  linkLoading?: boolean;
  linkError?: string | null;
};

const FacebookMockup = ({ caption, mediaUrls, linkMeta, linkLoading, linkError }: MockupProps) => {
  const mediaUrl = mediaUrls?.[0];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-slate-200" />
        <div>
          <div className="text-sm font-semibold text-slate-900">Contentflow</div>
          <div className="text-xs text-slate-500">Just now - Public</div>
        </div>
      </div>

      <div className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{caption || 'Start typing to preview your post...'}</div>

      {mediaUrl && (
        <div className="mt-3 h-48 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
          <img src={mediaUrl} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      {!linkError && <LinkPreviewCard metadata={linkMeta} loading={linkLoading} variant="prominent" />}
      {linkError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Unable to fetch link preview.
        </div>
      )}

      <div className="mt-4 flex items-center gap-6 text-xs text-slate-400">
        <span>Like</span>
        <span>Comment</span>
        <span>Share</span>
      </div>
    </div>
  );
};

export default FacebookMockup;
