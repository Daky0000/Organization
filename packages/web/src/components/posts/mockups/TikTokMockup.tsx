import type { LinkMetadata } from '../../../types/linkMetadata';

type MockupProps = {
  caption: string;
  mediaUrls?: string[];
  linkMeta?: LinkMetadata | null;
  linkLoading?: boolean;
  linkError?: string | null;
};

const renderCaption = (caption: string) =>
  caption.split(/(#[\p{L}0-9_]+)/gu).map((chunk, index) => {
    if (chunk.startsWith('#')) {
      return (
        <span key={`${chunk}-${index}`} className="text-pink-300">
          {chunk}
        </span>
      );
    }
    return <span key={`${chunk}-${index}`}>{chunk}</span>;
  });

const TikTokMockup = ({ caption, mediaUrls }: MockupProps) => {
  const mediaUrl = mediaUrls?.[0];

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 shadow-sm text-white">
      <div className="relative h-72 w-full overflow-hidden rounded-xl bg-slate-900">
        {mediaUrl ? (
          <img src={mediaUrl} alt="" className="h-full w-full object-cover opacity-90" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-slate-800 to-slate-900" />
        )}
        <div className="absolute bottom-4 left-4 right-16 text-sm">
          <div className="font-semibold">@contentflow</div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-slate-200">
            {caption ? renderCaption(caption) : 'Start typing to preview your post...'}
          </div>
        </div>
        <div className="absolute right-3 bottom-4 flex flex-col items-center gap-3 text-[10px] text-slate-200">
          <div className="h-9 w-9 rounded-full bg-slate-700" />
          <span>Like</span>
          <span>Comment</span>
          <span>Share</span>
          <span>Save</span>
        </div>
      </div>
    </div>
  );
};

export default TikTokMockup;
