import type { LinkMetadata } from '../../../types/linkMetadata';
import LinkPreviewCard from './LinkPreviewCard';

type MockupProps = {
  caption: string;
  mediaUrls?: string[];
  linkMeta?: LinkMetadata | null;
  linkLoading?: boolean;
  linkError?: string | null;
};

const InstagramMockup = ({ caption, mediaUrls, linkMeta, linkLoading, linkError }: MockupProps) => {
  const mediaUrl = mediaUrls?.[0];
  const previewText = caption.length > 125 ? `${caption.slice(0, 125)}... more` : caption;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-slate-200" />
          <div className="text-sm font-semibold text-slate-900">contentflow</div>
        </div>
        <div className="text-slate-400">...</div>
      </div>

      <div className="mt-3 h-56 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        {mediaUrl ? <img src={mediaUrl} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full" />}
      </div>

      <div className="mt-3 flex items-center gap-4 text-sm text-slate-600">
        <span>Like</span>
        <span>Comment</span>
        <span>Share</span>
        <span className="ml-auto">Save</span>
      </div>

      <div className="mt-3 text-sm text-slate-800">
        <span className="font-semibold">contentflow </span>
        <span className="whitespace-pre-wrap">{previewText || 'Start typing to preview your post...'}</span>
      </div>

      {!linkError && <LinkPreviewCard metadata={linkMeta} loading={linkLoading} variant="subtle" />}
      {linkError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Unable to fetch link preview.
        </div>
      )}
    </div>
  );
};

export default InstagramMockup;
