import { useState } from 'react';
import { getApiBaseUrl } from '../../utils/apiBase';

/**
 * 👍 / 👎 on a generated image. 👍 adds it to the user's example designs (the
 * style future images follow); 👎 asks what's wrong and turns the answer into
 * a rule every future image obeys.
 */
export default function ImageFeedback({ url, about, compact = false }: { url: string; about?: string; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'asking' | 'saving' | 'liked' | 'ruled' | 'noted' | 'error'>('idle');
  const [reason, setReason] = useState('');

  const send = async (rating: 'up' | 'down', why = '') => {
    setState('saving');
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/ai/image-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify({ rating, image_url: url, about, reason: why }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error();
      setState(rating === 'up' ? 'liked' : d?.learned === 'rule' ? 'ruled' : 'noted');
    } catch {
      setState('error');
    }
  };

  const text = 'text-[10.5px]';
  if (state === 'liked') return <span className={`${text} text-emerald-700`}>👍 Saved as an example — new images will follow this style.</span>;
  if (state === 'ruled') return <span className={`${text} text-emerald-700`}>👎 Got it — every new image will avoid that.</span>;
  if (state === 'noted') return <span className={`${text} text-slate-500`}>👎 Noted. Say what's wrong next time and it becomes a rule.</span>;
  if (state === 'error') return <button type="button" onClick={() => setState('idle')} className={`${text} text-red-600 underline`}>Couldn't save — try again</button>;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${compact ? '' : 'mt-1'}`}>
      <button type="button" disabled={state === 'saving'} onClick={() => void send('up')} title="I like this — make more like it"
        aria-label="Like this image" className="rounded px-1 text-[12px] hover:bg-slate-100 disabled:opacity-50">👍</button>
      <button type="button" disabled={state === 'saving'} onClick={() => setState('asking')} title="Not this — tell me what to avoid"
        aria-label="Dislike this image" className="rounded px-1 text-[12px] hover:bg-slate-100 disabled:opacity-50">👎</button>
      {state === 'asking' && (
        <span className="flex items-center gap-1">
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send('down', reason); }}
            placeholder="What's wrong? e.g. too dark, no stock people"
            className="w-52 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10.5px] outline-none focus:border-indigo-400" />
          <button type="button" onClick={() => void send('down', reason)} className="text-[10.5px] font-semibold text-indigo-600">Save</button>
        </span>
      )}
    </span>
  );
}
