import { useEffect, useState } from 'react';
import { Card, SectionHeading, Toggle } from '../ui';
import { getApiBaseUrl } from '../../utils/apiBase';

type TasteSummary = {
  summary: string;
  examples: Array<{ id: string; url: string }>;
  rules: Array<{ id: string; directive: string }>;
  assets: Array<{ id: string; name: string }>;
  brand_kit: boolean;
  autopilot_style: boolean;
};

const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` });

/**
 * Autopilot uses the image style taught in the chat's Style panel (example
 * designs, "never in my images" rules, saved products/people/places, Brand Kit).
 * This card shows what it will follow and switches it on or off.
 */
export default function AutopilotStyleCard() {
  const [taste, setTaste] = useState<TasteSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/ai/taste`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTaste(d?.taste ?? null))
      .catch(() => setError('Could not load your image style.'));
  }, []);

  const toggle = async (on: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/ai/taste/settings`, { method: 'PUT', headers: headers(), body: JSON.stringify({ autopilot_style: on }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error();
      setTaste(d.taste);
    } catch {
      setError('Could not save — please try again.');
    } finally {
      setSaving(false);
    }
  };

  const taught = taste && (taste.examples.length + taste.rules.length + taste.assets.length > 0 || taste.summary);
  return (
    <Card>
      <SectionHeading
        title="Your image style"
        hint="Autopilot follows the style you taught in the chat (palette icon): your example designs, the things you never want in images, and your saved products, people and places. Approving or rejecting Autopilot images keeps teaching it."
      />
      {!taste ? (
        <p className="text-sm text-slate-500">{error ?? 'Loading…'}</p>
      ) : (
        <div className="space-y-3">
          <Toggle checked={taste.autopilot_style} onChange={(v) => { if (!saving) void toggle(v); }} label="Use my image style in Autopilot" />
          {taught ? (
            <div className="space-y-2 text-sm text-slate-700">
              {taste.summary && <p><span className="font-semibold">Style:</span> {taste.summary}</p>}
              {taste.examples.length > 0 && (
                <div className="flex gap-1.5">
                  {taste.examples.slice(0, 6).map((e) => <img key={e.id} src={e.url} alt="" className="h-12 w-12 rounded-lg border border-slate-200 object-cover" />)}
                </div>
              )}
              <p className="text-xs text-slate-500">
                {taste.examples.length} example{taste.examples.length === 1 ? '' : 's'} · {taste.rules.length} rule{taste.rules.length === 1 ? '' : 's'} · {taste.assets.length} saved item{taste.assets.length === 1 ? '' : 's'}
                {taste.brand_kit ? ' · saved in Magnific as your Brand Kit' : ''}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Nothing taught yet. Open the chat, tap the palette icon, and add a few designs you love — Autopilot will follow them.</p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Card>
  );
}
