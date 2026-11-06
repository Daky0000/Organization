import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { PlatformLogo } from '../PlatformLogo';
import SocialPostPreview from './SocialPostPreview';
import ImageFeedback from './ImageFeedback';
import { FORMAT_LABEL, PLATFORM_META, mediaOf, type SocialPlatformId } from './socialMeta';

export type SocialPostLike = {
  id: string;
  title: string;
  content?: string | null;
  status: string;
  scheduled_at: string | null;
  social_platform?: string | null;
  post_format?: string | null;
  media_assets?: unknown;
  featured_image?: string | null;
  video_url?: string | null;
};

const toInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Opens a social post the way it will appear on its platform, next to the
 * fields that change it. Edits show in the preview as they are typed.
 */
export default function SocialPostModal({
  post, platform, connected, onClose, onSave, onDelete,
}: {
  post: SocialPostLike;
  platform: SocialPlatformId;
  connected: boolean;
  onClose: () => void;
  onSave: (patch: { content: string; scheduled_at: string | null; status: string }) => Promise<void>;
  onDelete: () => void;
}) {
  const meta = PLATFORM_META[platform];
  const media = useMemo(() => mediaOf(post), [post]);
  const format = String(post.post_format || 'single_image');
  const [text, setText] = useState(String(post.content || '').replace(/<[^>]+>/g, ''));
  const [when, setWhen] = useState(toInput(post.scheduled_at));
  const [status, setStatus] = useState(post.status === 'published' ? 'published' : when ? 'scheduled' : 'draft');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const over = text.length - meta.limit;
  const published = post.status === 'published';
  const needsMedia = (format === 'single_image' || format === 'carousel' || format === 'reel' || format === 'video' || format === 'story') && media.length === 0;

  const save = async () => {
    if (over > 0) { setError(`${meta.label} allows ${meta.limit.toLocaleString()} characters — shorten by ${over}.`); return; }
    if (status === 'scheduled' && !when) { setError('Pick a date and time, or save it as a draft.'); return; }
    const iso = status === 'draft' ? null : when ? new Date(when).toISOString() : null;
    setSaving(true);
    setError(null);
    try {
      await onSave({ content: text, scheduled_at: iso, status });
    } catch (e: any) {
      setError(e?.message || 'Could not save — please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3" style={{ background: meta.soft }}>
          <PlatformLogo platform={platform} size={26} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">{meta.label} · {FORMAT_LABEL[format] ?? format}{format === 'carousel' && media.length ? ` (${media.length} slides)` : ''}</p>
            <p className="truncate text-xs text-slate-500">{post.title}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/70" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="grid flex-1 gap-0 overflow-y-auto md:grid-cols-[1fr_1fr]">
          <div className="flex justify-center bg-slate-50 p-4">
            <SocialPostPreview platform={platform} format={format} text={text} media={media} />
          </div>

          <div className="space-y-4 p-4">
            {!connected && (
              <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">{meta.label} isn't connected yet.</p>
                  <p>This post stays on your calendar but won't publish until you connect {meta.label}.</p>
                  <a href="/integrations" className="mt-1 inline-block font-semibold text-amber-900 underline">Connect {meta.label} →</a>
                </div>
              </div>
            )}
            {needsMedia && (
              <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <p>This {FORMAT_LABEL[format]?.toLowerCase() ?? 'post'} has no {format === 'reel' || format === 'video' ? 'video' : 'image'} yet — {meta.label} needs one to publish it. Ask Daky to create it, or add it in Posts.</p>
              </div>
            )}

            <label className="block">
              <span className="flex items-center justify-between text-xs font-semibold text-slate-700">
                {platform === 'pinterest' ? 'Title and description' : 'Caption'}
                <span className={`tabular-nums ${over > 0 ? 'text-red-600' : 'text-slate-400'}`}>{text.length.toLocaleString()} / {meta.limit.toLocaleString()}</span>
              </span>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} disabled={published}
                className={`mt-1 w-full resize-y rounded-xl border px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none focus:ring-2 ${over > 0 ? 'border-red-300 focus:ring-red-200' : 'border-slate-200 focus:ring-indigo-200'}`} />
            </label>

            {media.some((m) => m.type !== 'video') && (
              <div className="text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Like these visuals?</span>{' '}
                <ImageFeedback compact url={media.find((m) => m.type !== 'video')!.url} about={`${meta.label} ${FORMAT_LABEL[format] ?? ''}: ${post.title}`} />
              </div>
            )}

            {media.length > 1 && (
              <div>
                <p className="text-xs font-semibold text-slate-700">{format === 'carousel' ? 'Slides' : 'Media'}</p>
                <div className="mt-1 flex gap-1.5 overflow-x-auto pb-1">
                  {media.map((m, k) => (
                    <div key={m.url + k} className="relative h-16 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                      {m.type === 'video' ? <video src={m.url} className="h-full w-full object-cover" /> : <img src={m.url} alt="" className="h-full w-full object-cover" />}
                      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] font-semibold text-white">{k + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {published ? (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">Published — it can't be edited here any more.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">Status</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
                    <option value="scheduled">Scheduled</option>
                    <option value="draft">Draft (not published)</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">Publish at</span>
                  <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={status === 'draft'}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400" />
                </label>
              </div>
            )}

            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
          <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">
            <Trash2 size={14} /> Delete
          </button>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Close</button>
          {!published && (
            <button type="button" onClick={() => void save()} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {saving && <Loader2 size={13} className="animate-spin" />} Save changes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
