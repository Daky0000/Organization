import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Loader2, Mic, MicOff, Phone, PhoneOff,
  RefreshCw, Sparkles, XCircle,
} from 'lucide-react';
import {
  formatDuration, salesService,
  type SalesLead, type TestCallRecord, type VapiStatus,
} from '../../services/salesService';

// ─────────────────────────────────────────────────────────────────────────────
// Developer test console.
//
// Two ways to hear the agent, and they exercise different halves of the Vapi
// setup on purpose:
//
//   Browser  — the Web SDK with the PUBLIC key over your mic. No phone number,
//              no telephony minutes, no carrier. Tests the prompt and the voice.
//   Phone    — a real outbound call placed server-side with the PRIVATE key.
//              Tests the phone number, the carrier leg, and the webhook.
//
// If the browser test works and the phone test does not, the problem is the
// phone number or the private key, not the prompt. That split is the whole
// point of having both.
// ─────────────────────────────────────────────────────────────────────────────

const ACCENT = '#2563EB';

const DEFAULT_CONTEXT = `You are a friendly sales representative for our company. You are on a live phone call, so keep every reply to one or two sentences and then let the other person talk.

Your goal on this call is to find out whether they have the problem we solve, and if so, to book a short follow-up meeting.

Do not:
- Pressure them or keep pushing after a clear no.
- Invent pricing, features or customer names. If you do not know, say you will find out.`;

type TranscriptLine = { role: 'user' | 'assistant'; text: string };
type WebState = 'idle' | 'connecting' | 'live' | 'ended';

/** Minimal surface of the lazily-loaded @vapi-ai/web client. */
type VapiClient = {
  start: (assistant: unknown) => Promise<unknown>;
  stop: () => void;
  setMuted: (muted: boolean) => void;
  on: (event: string, cb: (payload?: any) => void) => void;
  removeAllListeners?: () => void;
};

export default function VapiTestConsole({ leads = [] }: { leads?: SalesLead[] }) {
  const [status, setStatus] = useState<VapiStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [context, setContext] = useState(DEFAULT_CONTEXT);
  const [firstMessage, setFirstMessage] = useState('');
  const [toNumber, setToNumber] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<string | null>(null);
  const [history, setHistory] = useState<TestCallRecord[]>([]);

  const [webState, setWebState] = useState<WebState>('idle');
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const vapiRef = useRef<VapiClient | null>(null);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await salesService.getVapiStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check Vapi');
    } finally {
      setChecking(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await salesService.listTestCalls());
    } catch {
      /* history is a convenience, not worth surfacing an error for */
    }
  }, []);

  useEffect(() => { void loadStatus(); void loadHistory(); }, [loadStatus, loadHistory]);

  // Always tear the call down on unmount — navigating away with a live mic
  // session running is the one bug users notice immediately.
  useEffect(() => () => { try { vapiRef.current?.stop(); } catch { /* already gone */ } }, []);

  const prefillFromLead = async (contactId: string) => {
    if (!contactId) return;
    try {
      const brief = await salesService.getTestBrief(contactId);
      setContext(brief.systemPrompt);
      setFirstMessage(brief.firstMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load that lead\'s brief');
    }
  };

  const startWebCall = async () => {
    setError(null);
    setTranscript([]);
    setWebState('connecting');
    try {
      const { publicKey, assistant } = await salesService.getWebTestConfig({
        context,
        first_message: firstMessage || undefined,
      });

      // Loaded on demand so the SDK stays out of the main bundle — most
      // sessions never open this panel.
      const { default: Vapi } = await import('@vapi-ai/web');
      const vapi = new Vapi(publicKey) as unknown as VapiClient;
      vapiRef.current = vapi;

      vapi.on('call-start', () => setWebState('live'));
      vapi.on('call-end', () => { setWebState('ended'); vapiRef.current = null; });
      vapi.on('error', (e: any) => {
        setError(e?.errorMsg || e?.message || 'The browser call failed');
        setWebState('idle');
        vapiRef.current = null;
      });
      vapi.on('message', (message: any) => {
        // Only final transcripts — partials would rewrite the last line on
        // every syllable and make the log unreadable.
        if (message?.type === 'transcript' && message?.transcriptType === 'final') {
          setTranscript((prev) => [
            ...prev,
            { role: message.role === 'user' ? 'user' : 'assistant', text: String(message.transcript) },
          ]);
        }
      });

      await vapi.start(assistant);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the browser call');
      setWebState('idle');
      vapiRef.current = null;
    }
  };

  const stopWebCall = () => {
    try { vapiRef.current?.stop(); } catch { /* already stopped */ }
    vapiRef.current = null;
    setWebState('ended');
  };

  const toggleMute = () => {
    const next = !muted;
    try { vapiRef.current?.setMuted(next); setMuted(next); } catch { /* no live call */ }
  };

  const placePhoneCall = async () => {
    setError(null);
    setPlaced(null);
    setPlacing(true);
    try {
      await salesService.placeTestCall({
        to_number: toNumber,
        context,
        first_message: firstMessage || undefined,
      });
      setPlaced(`Calling ${toNumber} now. The transcript appears below once the call ends.`);
      setTimeout(() => void loadHistory(), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place the test call');
    } finally {
      setPlacing(false);
    }
  };

  const ready = status?.ok === true;
  const canWebCall = ready && status?.hasPublicKey;
  const canPhoneCall = ready && status?.phoneNumberIdValid;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Sparkles size={16} className="text-slate-400" /> Test the agent
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Give it a context and hear it. Browser calls use the public key over your mic; phone calls use the
            private key and a real carrier leg.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadStatus()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw size={13} /> Recheck
        </button>
      </div>

      {/* Connection status — makes a bad key obvious here rather than mid-call */}
      <div className="mt-4 space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs">
        {checking && <p className="flex items-center gap-2 text-slate-500"><Loader2 size={13} className="animate-spin" /> Checking Vapi…</p>}
        {!checking && status && (
          <>
            <p className={`flex items-center gap-2 ${ready ? 'text-emerald-700' : 'text-rose-700'}`}>
              {ready ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              Private key {ready ? 'valid' : `rejected — ${status.error ?? 'not configured'}`}
            </p>
            <p className={`flex items-center gap-2 ${status.phoneNumberIdValid ? 'text-emerald-700' : 'text-amber-700'}`}>
              {status.phoneNumberIdValid ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              {status.phoneNumberIdValid
                ? `Phone number ID matches (${status.phoneNumbers.length} number${status.phoneNumbers.length === 1 ? '' : 's'} on the account)`
                : ready
                  ? 'Phone number ID missing or not on this account — phone tests will fail'
                  : 'Phone number unverified'}
            </p>
            <p className={`flex items-center gap-2 ${status.hasPublicKey ? 'text-emerald-700' : 'text-amber-700'}`}>
              {status.hasPublicKey ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              {status.hasPublicKey ? 'Public key set — browser calls available' : 'No public key — browser calls unavailable'}
            </p>
            {ready && status.phoneNumbers.length > 0 && !status.phoneNumberIdValid && (
              <p className="pt-1 text-slate-500">
                Available IDs: {status.phoneNumbers.map((p) => `${p.number ?? p.name ?? 'unnamed'} → ${p.id}`).join(' · ')}
              </p>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {/* Context */}
      <div className="mt-4 space-y-3">
        {leads.length > 0 && (
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Prefill from a real lead</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Loads the exact brief that lead would get, so you are testing the real prompt rather than a stand-in.
            </span>
            <select
              onChange={(e) => void prefillFromLead(e.target.value)}
              defaultValue=""
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            >
              <option value="">Write my own context…</option>
              {leads.slice(0, 50).map((l) => (
                <option key={l.contact_id} value={l.contact_id}>
                  {[l.first_name, l.last_name].filter(Boolean).join(' ') || l.phone || 'Unnamed'} — {l.stage ?? 'new'}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">Context (system prompt)</span>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={10}
            className="mt-1.5 w-full rounded-xl border border-slate-200 p-3 font-mono text-xs leading-relaxed focus:border-indigo-400 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">Opening line</span>
          <span className="mt-0.5 block text-xs text-slate-500">
            The AI disclosure is prepended automatically on every test, whatever your policy says.
          </span>
          <input
            value={firstMessage}
            onChange={(e) => setFirstMessage(e.target.value)}
            placeholder="Hi, do you have a quick minute?"
            className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          />
        </label>
      </div>

      {/* The two test paths */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-bold text-slate-900">Talk in your browser</h3>
          <p className="mt-1 text-xs text-slate-500">
            Uses your mic and the public key. No phone number, no telephony minutes.
          </p>
          <div className="mt-3 flex items-center gap-2">
            {webState !== 'live' && webState !== 'connecting' && (
              <button
                type="button"
                onClick={() => void startWebCall()}
                disabled={!canWebCall || !context.trim()}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                <Mic size={14} /> Start call
              </button>
            )}
            {webState === 'connecting' && (
              <span className="inline-flex items-center gap-2 text-sm text-slate-500">
                <Loader2 size={14} className="animate-spin" /> Connecting…
              </span>
            )}
            {webState === 'live' && (
              <>
                <button
                  type="button"
                  onClick={stopWebCall}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white"
                >
                  <PhoneOff size={14} /> End call
                </button>
                <button
                  type="button"
                  onClick={toggleMute}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
                >
                  {muted ? <MicOff size={14} /> : <Mic size={14} />} {muted ? 'Unmute' : 'Mute'}
                </button>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live
                </span>
              </>
            )}
          </div>
          {!canWebCall && !checking && (
            <p className="mt-2 text-xs text-amber-700">
              Add a Vapi public key under Admin → Integrations to enable this.
            </p>
          )}

          {transcript.length > 0 && (
            <div className="mt-3 max-h-60 space-y-1.5 overflow-y-auto rounded-lg bg-slate-50 p-3">
              {transcript.map((line, i) => (
                <p key={i} className="text-xs">
                  <span className={`font-bold ${line.role === 'user' ? 'text-slate-900' : 'text-indigo-600'}`}>
                    {line.role === 'user' ? 'You' : 'Agent'}:
                  </span>{' '}
                  <span className="text-slate-700">{line.text}</span>
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-bold text-slate-900">Call a real phone</h3>
          <p className="mt-1 text-xs text-slate-500">
            Placed server-side with the private key. Capped at 3 minutes, 5 tests an hour.
          </p>
          <input
            value={toNumber}
            onChange={(e) => setToNumber(e.target.value)}
            placeholder="+233201234567"
            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void placePhoneCall()}
            disabled={!canPhoneCall || placing || !toNumber.trim() || !context.trim()}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: ACCENT }}
          >
            <Phone size={14} /> {placing ? 'Dialling…' : 'Call this number'}
          </button>
          {!canPhoneCall && !checking && (
            <p className="mt-2 text-xs text-amber-700">
              Needs a valid private key and a phone number ID from this Vapi account.
            </p>
          )}
          {placed && (
            <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{placed}</p>
          )}
          <p className="mt-2 text-xs text-slate-400">
            Test calls skip the compliance gate — there is no consent record for a number you type in — so only
            call numbers you own. They are excluded from all statistics.
          </p>
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Recent test calls</h3>
            <button type="button" onClick={() => void loadHistory()} className="text-xs font-semibold text-slate-500 hover:text-slate-800">
              Refresh
            </button>
          </div>
          <ul className="mt-2 space-y-2">
            {history.map((call) => (
              <li key={call.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-800">{call.to_number ?? 'browser'}</span>
                  <span className="text-slate-500">
                    {call.started_at ? new Date(call.started_at).toLocaleString() : '—'} ·{' '}
                    {formatDuration(call.duration_sec)} · {call.outcome ?? call.status}
                    {call.ended_reason && ` (${call.ended_reason})`}
                  </span>
                </div>
                {call.last_error && <p className="mt-1 text-xs text-rose-600">{call.last_error}</p>}
                {call.transcript && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-500">Transcript</summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
                      {call.transcript}
                    </pre>
                  </details>
                )}
                {call.recording_url && (
                  <audio controls src={call.recording_url} className="mt-2 w-full">
                    <track kind="captions" />
                  </audio>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
