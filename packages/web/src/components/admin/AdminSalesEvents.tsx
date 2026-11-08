import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Globe, KeyRound, Loader2, PhoneCall, RefreshCw, RotateCcw, Webhook, XCircle } from 'lucide-react';
import { formatDateTime } from '../../services/salesService';
import {
  CALL_SEGMENTS, SEGMENT_LABELS, salesEventsService, type CallSegment, type EventsConfigView,
} from '../../services/salesEventsService';

// Admin → Sales Events. How Africon's events reach the Sales OS (africon.ai
// read through Apify or directly, on a schedule), where bookings come in from
// Africon's backend, and whether the agent calls people automatically.

const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]/20';
const btn = 'inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed';

function Card({ title, icon, note, children }: { title: string; icon?: React.ReactNode; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">{icon}{title}</h2>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

const SAMPLE = {
  eventId: 'pAwwlow4K3W9PxmctogN',
  eventSlug: 'executive-ai-masterclass-for-ceos',
  bookingRef: 'AFR-2026-0193',
  status: 'payment_failed',
  userInfo: { name: 'Ama Mensah', email: 'ama@example.com', phone: '0244123456', company: 'Bloom Bank', role: 'Head of HR' },
  selectedCohortId: 'entry-1784574332064-5i9fs9sx9',
  selectedCohortLabel: 'Cohort 5',
  attendeeCount: 1,
  amount: 4250,
  currency: 'GHS',
  source: 'website',
  createdAt: '2026-11-08T10:12:00Z',
  updatedAt: '2026-11-08T10:15:00Z',
};

export default function AdminSalesEvents() {
  const [view, setView] = useState<EventsConfigView | null>(null);
  const [draft, setDraft] = useState<EventsConfigView['config'] | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const apply = (v: EventsConfigView) => { setView(v); setDraft(v.config); setApiKey(''); setOwnerEmail(''); };

  useEffect(() => {
    salesEventsService.getConfig().then(apply).catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);

  async function act(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Something went wrong' });
    } finally {
      setBusy(null);
    }
  }

  const save = () => act('save', async () => {
    if (!draft) return;
    apply(await salesEventsService.saveConfig({
      ...draft,
      ...(apiKey.trim() ? { bookingsApiKey: apiKey.trim() } : {}),
      ...(ownerEmail.trim() ? { ownerEmail: ownerEmail.trim() } : {}),
    }));
    return 'Saved.';
  });

  const sync = () => act('sync', async () => {
    const s = await salesEventsService.syncNow();
    apply(await salesEventsService.getConfig());
    if (s.status === 'failed') throw new Error(s.error || 'Sync failed');
    return `Read ${s.found} events via ${s.source === 'apify' ? 'Apify' : 'direct fetch'}: ${s.created} new, ${s.changed} changed, ${s.removed} removed${s.bookingsPulled ? `, ${s.bookingsPulled} bookings pulled` : ''}.${s.warnings.length ? ` Warnings: ${s.warnings.slice(0, 2).join(' ')}` : ''}`;
  });

  const copy = (text: string) => { void navigator.clipboard?.writeText(text); setMsg({ ok: true, text: 'Copied.' }); };

  if (!view || !draft) {
    return <div className="p-6 text-sm text-slate-400">{msg ? <span className="text-rose-600">{msg.text}</span> : 'Loading…'}</div>;
  }
  const set = <K extends keyof EventsConfigView['config']>(k: K, v: EventsConfigView['config'][K]) => setDraft({ ...draft, [k]: v });
  const curl = `curl -X POST '${view.webhook.url}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer ${showSecret ? view.webhook.secret : '<secret>'}' \\\n  -d '${JSON.stringify(SAMPLE)}'`;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-950">Sales Events</h1>
        <p className="mt-1 text-sm text-slate-500">
          Africon's events are read from {draft.siteUrl.replace(/^https:\/\//, '')} on a schedule. Bookings — who booked, who failed to pay, who chose pay later — come from Africon's own backend, because the website does not publish them. Sales → Events shows both, with a call strategy for each group.
        </p>
      </div>

      {msg && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{msg.text}</div>
      )}

      <Card title="Reading africon.ai" icon={<Globe size={16} />}
        note="Each run opens the events page and every event page on it, then reads dates, cohorts, prices, early-bird and registration deadlines, live seat counts, agenda and FAQs.">
        <Toggle checked={draft.enabled} onChange={(v) => set('enabled', v)} label="Read the site on a schedule" />
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-semibold text-slate-700">How
            <select className={`${inputCls} mt-1.5`} value={draft.source} onChange={(e) => set('source', e.target.value as any)}>
              <option value="auto">Apify when connected, else direct</option>
              <option value="apify">Apify only</option>
              <option value="direct">Direct fetch only</option>
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Every (hours)
            <input type="number" min={1} max={48} className={`${inputCls} mt-1.5`} value={draft.intervalHours} onChange={(e) => set('intervalHours', Number(e.target.value))} />
          </label>
          <label className="block text-sm font-semibold text-slate-700">Site
            <input className={`${inputCls} mt-1.5`} value={draft.siteUrl} onChange={(e) => set('siteUrl', e.target.value)} />
          </label>
        </div>
        <p className="flex items-center gap-1.5 text-xs">
          {view.apifyConnected
            ? <><CheckCircle2 size={13} className="text-emerald-600" /><span className="text-slate-600">Apify is connected. Runs use the <code>{draft.apifyActor}</code> actor (a few cents per run).</span></>
            : <><XCircle size={13} className="text-slate-400" /><span className="text-slate-500">Apify is not connected (Admin → Integrations → Apify). The site is read directly, which works today because the pages carry their event data.</span></>}
        </p>
        <div className="flex gap-2">
          <button type="button" disabled={busy === 'sync'} onClick={() => void sync()} className={`${btn} bg-[#2563EB] text-white hover:bg-blue-700`}>
            {busy === 'sync' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Read now
          </button>
        </div>
        {view.runs.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left font-semibold uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">How</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Events</th><th className="px-3 py-2">Notes</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {view.runs.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-slate-600">{formatDateTime(r.started_at)}<span className="text-slate-400"> · {r.trigger}</span></td>
                    <td className="px-3 py-2 text-slate-600">{r.source ?? '—'}</td>
                    <td className={`px-3 py-2 font-semibold ${r.status === 'failed' ? 'text-rose-600' : r.status === 'partial' ? 'text-amber-600' : r.status === 'running' ? 'text-slate-500' : 'text-emerald-600'}`}>{r.status}</td>
                    <td className="px-3 py-2 text-slate-600">{r.events_found} found · {r.events_new} new · {r.events_changed} changed{r.bookings_pulled ? ` · ${r.bookings_pulled} bookings` : ''}</td>
                    <td className="max-w-xs px-3 py-2 text-slate-500">{r.error ?? (r.warnings?.length ? r.warnings.slice(0, 2).join(' ') : '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Bookings from Africon" icon={<Webhook size={16} />}
        note="Give this to whoever builds the Africon dashboard. They POST each booking event as it happens — started, payment failed, paid, pay later, cancelled, interest — using the same booking object the site's booking form already sends.">
        <div>
          <p className="text-sm font-semibold text-slate-700">Bookings land on this account's leads</p>
          <p className="text-sm text-slate-600">{view.owner ? `${view.owner.name} (${view.owner.email})` : 'Not set'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input className={`${inputCls} max-w-xs`} placeholder="Another account's email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
            <button type="button" className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
              onClick={() => void act('me', async () => { apply(await salesEventsService.saveConfig({ ownerIsMe: true })); return 'Bookings now land on your account.'; })}>Use my account</button>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-700">Endpoint</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">POST {view.webhook.url}</code>
            <button type="button" onClick={() => copy(view.webhook.url)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Copy URL"><Copy size={14} /></button>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-700">Shared secret</p>
          <p className="text-xs text-slate-500">Send it as <code>Authorization: Bearer &lt;secret&gt;</code>, or sign the raw body: <code>X-Africon-Signature: sha256=&lt;hex HMAC-SHA256 of the body&gt;</code>.</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{showSecret ? view.webhook.secret : '•'.repeat(24)}</code>
            <button type="button" onClick={() => setShowSecret((s) => !s)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">{showSecret ? 'Hide' : 'Show'}</button>
            {view.webhook.secret && <button type="button" onClick={() => copy(view.webhook.secret!)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Copy secret"><Copy size={14} /></button>}
            <button type="button" disabled={!!busy} onClick={() => void act('rotate', async () => { if (!confirm('Replace the secret? The Africon side stops working until it uses the new one.')) return; apply(await salesEventsService.rotateSecret()); return 'New secret made. Update it on the Africon side.'; })}
              className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Rotate secret"><RotateCcw size={14} /></button>
          </div>
        </div>
        <details className="rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Example request</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{curl}</pre>
          <p className="mt-2 text-xs text-slate-500">
            One booking, an array, or <code>{'{ "bookings": [...] }'}</code> (up to 1,000). <code>status</code> can be any of: started, payment_failed, pay_later, pending_review, confirmed / paid, cancelled, attended, no_show, interested — or <code>paymentIntent: "pay_later"</code>.
            Send the event's site id (<code>eventId</code>) or its <code>eventSlug</code>, and an email or phone. Later messages for the same person and event update one booking; a late "started" never undoes "paid".
          </p>
        </details>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">Or poll Africon's bookings API (optional)
            <input className={`${inputCls} mt-1.5`} placeholder="https://…/api/sales-os/bookings" value={draft.bookingsApiUrl} onChange={(e) => set('bookingsApiUrl', e.target.value)} />
            <span className="mt-1 block text-xs font-normal text-slate-500">Called on each run as GET ?since=&lt;ISO time&gt;, expecting {'{ "bookings": [...] }'}.</span>
          </label>
          <label className="block text-sm font-semibold text-slate-700">API key {draft.hasBookingsApiKey && <span className="font-normal text-emerald-600">(saved)</span>}
            <input type="password" className={`${inputCls} mt-1.5`} placeholder={draft.hasBookingsApiKey ? 'Leave blank to keep' : 'Bearer token'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </label>
        </div>
      </Card>

      <Card title="Calling" icon={<PhoneCall size={16} />}
        note="Calls are planned for every booking: about 30 minutes after a failed booking, a few hours before a pay-later deadline, two days before a class, and soon after interest. Every call still passes calling hours, daily caps, consent, do-not-call and — when your Sales → Settings ask for it — the approval queue.">
        <Toggle checked={draft.autoCall} onChange={(v) => set('autoCall', v)} label="Queue planned calls automatically"
          hint="Off: calls go out only when someone presses Call in Sales → Events." />
        <div>
          <p className="text-sm font-semibold text-slate-700">Groups the agent calls automatically</p>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {CALL_SEGMENTS.map((s) => (
              <Toggle key={s} label={SEGMENT_LABELS[s]} checked={draft.callSegments.includes(s)}
                onChange={(v) => set('callSegments', (v ? [...draft.callSegments, s] : draft.callSegments.filter((x) => x !== s)) as CallSegment[])} />
            ))}
          </div>
        </div>
        <label className="block max-w-xs text-sm font-semibold text-slate-700">Calls per person per group (first call + retries)
          <input type="number" min={1} max={4} className={`${inputCls} mt-1.5`} value={draft.maxCallsPerSegment} onChange={(e) => set('maxCallsPerSegment', Number(e.target.value))} />
        </label>
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><KeyRound size={14} /> Consent</p>
          <Toggle checked={draft.bookingConsent} onChange={(v) => set('bookingConsent', v)}
            label="A booking counts as consent to be called about that booking"
            hint="They gave their number to book this event; the calls are about that booking. Recorded as consent source 'africon_event_booking'. An explicit consent: false in the record always wins." />
          <Toggle checked={draft.interestConsent} onChange={(v) => set('interestConsent', v)}
            label="Interest counts as consent"
            hint="Off by default: looking at an event is not asking to be called. Records that carry consent: true are always accepted." />
        </div>
      </Card>

      <div className="flex justify-end">
        <button type="button" disabled={busy === 'save'} onClick={() => void save()} className={`${btn} bg-slate-900 text-white hover:bg-slate-800`}>
          {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save settings
        </button>
      </div>
    </div>
  );
}
