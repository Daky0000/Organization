import type { LinkMetadata } from '../../../types/linkMetadata';

type LinkPreviewCardProps = {
  metadata?: LinkMetadata | null;
  loading?: boolean;
  variant?: 'prominent' | 'subtle';
};

const LinkPreviewCard = ({ metadata, loading, variant = 'prominent' }: LinkPreviewCardProps) => {
  if (loading) {
    return (
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 animate-pulse" role="status" aria-live="polite">
        <div className="h-24 rounded-md bg-slate-200" />
        <div className="mt-3 h-3 w-3/4 rounded bg-slate-200" />
        <div className="mt-2 h-3 w-2/3 rounded bg-slate-200" />
      </div>
    );
  }

  if (!metadata) return null;

  const host = (() => {
    try {
      return new URL(metadata.url).hostname.replace('www.', '');
    } catch {
      return metadata.url;
    }
  })();

  return (
    <div
      className={`mt-3 overflow-hidden rounded-lg border border-slate-200 ${
        variant === 'prominent' ? 'bg-white' : 'bg-slate-50'
      }`}
    >
      {metadata.image && (
        <div className="h-32 w-full overflow-hidden bg-slate-100">
          <img src={metadata.image} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="p-3">
        <div className="text-xs font-semibold text-slate-800">{metadata.title}</div>
        <div className="mt-1 text-[11px] text-slate-500 line-clamp-2">{metadata.description}</div>
        <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-slate-400">{host}</div>
      </div>
    </div>
  );
};

export default LinkPreviewCard;
