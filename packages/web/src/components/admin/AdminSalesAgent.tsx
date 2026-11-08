import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Mic, Phone, Plus, RefreshCw, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { getApiBaseUrl } from '../../utils/apiBase';
import { OBJECTION_LABELS, salesService, type SalesLead } from '../../services/salesService';
import VapiTestConsole from '../sales/VapiTestConsole';

// Admin → Sales Voice Agent. One voice agent for the whole organisation:
// who it is, what it says first, what it knows about the company, and the
// provider / voice / model it runs on. Users' Sales → Settings keep only their
// calling hours, caps and compliance switches.

type AgentConfig = {
  businessName: string; agentName: string; disclosureText: string; greetingText: string;
  firstMessage: string; firstMessageNoName: string; persona: string; knowledge: string;
  playbook: { code: string; scenario: string; response: string }[];
  objectionHandling: string; defaultObjective: string; extraRules: string;
  endCallMessage: string; voicemailMessage: string; inboundFirstMessage: string;
  provider: 'vapi' | 'simulator'; voiceProvider: string; voiceId: string;
  modelProvider: string; model: string; temperature: number;
  maxCallDurationSec: number; silenceTimeoutSec: number;
};
type View = {
  success: boolean; error?: string; config: AgentConfig; defaults: AgentConfig; customised: boolean;
  vapi: { hasPrivateKey: boolean; hasPublicKey: boolean; hasWebhookSecret: boolean; phoneNumberId: string | null; inboundAssistantId: string | null };
  sync?: { ok: boolean; skipped?: string; error?: string; assistantId?: string };
};
type VapiStatus = {
  ok: boolean; error?: string; phoneNumberIdValid: boolean; hasPublicKey: boolean;
  phoneNumbers: { id: string; number: string | null; name: string | null }[];
};

const tok = () => localStorage.getItem('auth_token') ?? '';
const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]/20';
const btn = 'inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed';

const VOICE_PROVIDERS = [
  { id: '11labs', label: 'ElevenLabs' },
  { id: 'vapi', label: 'Vapi voices' },
  { id: 'cartesia', label: 'Cartesia' },
  { id: 'azure', label: 'Azure' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'playht', label: 'PlayHT' },
  { id: 'deepgram', label: 'Deepgram' },
];
const MODEL_PROVIDERS = ['anthropic', 'openai', 'google', 'groq'];
// ElevenLabs premade voices, available on every Vapi account.
const VOICE_PRESETS = [
  { provider: '11labs', id: 'EXAVITQu4vr4xnAyMBLR', label: 'Sarah — warm, professional (female)' },
  { provider: '11labs', id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel — calm, clear (female)' },
  { provider: '11labs', id: 'XrExE9yKIg1WjnnlVkGX', label: 'Matilda — friendly (female)' },
  { provider: '11labs', id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam — deep, confident (male)' },
  { provider: '11labs', id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh — young, upbeat (male)' },
];

function fill(text: string, c: AgentConfig, firstName: string) {
  return text.replace(/\{agentName\}/g, c.agentName).replace(/\{businessName\}/g, c.businessName)
    .replace(/\{firstName\}/g, firstName).replace(/\s{2,}/g, ' ').trim();
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Card({ title, icon, note, children }: { title: string; icon?: React.ReactNode; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">{icon}{title}</h2>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export default function AdminSalesAgent() {
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<AgentConfig | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [vapi, setVapi] = useState<VapiStatus | null>(null);
  const [leads, setLeads] = useState<SalesLead[]>([]);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` };
  const base = `${getApiBaseUrl()}/api/admin/sales-agent`;

  const apply = (d: View) => {
    if (!d?.success) { setMsg({ ok: false, text: d?.error ?? 'Failed to load' }); return; }
    setView(d); setDraft(d.config); setPhoneNumberId(d.vapi.phoneNumberId ?? '');
  };
  const syncText = (d: View) => !d.sync ? '' : d.sync.ok
    ? ' Synced to Vapi — calling the number reaches the agent.'
    : d.sync.error ? ` Vapi sync failed: ${d.sync.error}` : ` Not synced to Vapi: ${d.sync.skipped}.`;

  async function checkVapi() {
    setChecking(true);
    try {
      const d = await (await fetch(`${base}/vapi`, { headers })).json();
      setVapi(d.success ? d.status : { ok: false, error: d.error, phoneNumbers: [], phoneNumberIdValid: false, hasPublicKey: false });
    } catch (e: any) {
      setVapi({ ok: false, error: e.message, phoneNumbers: [], phoneNumberIdValid: false, hasPublicKey: false });
    } finally { setChecking(false); }
  }

  useEffect(() => {
    fetch(base, { headers }).then((r) => r.json()).then((d) => {
      apply(d);
      if (d?.vapi?.hasPrivateKey) void checkVapi();
    }).catch((e) => setMsg({ ok: false, text: e.message }));
    salesService.listLeads({ limit: 50 }).then((p) => setLeads(p.leads)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preview = useMemo(() => {
    if (!draft) return null;
    const disclosure = fill(draft.disclosureText, draft, '');
    return {
      named: `${disclosure} This call is being recorded. ${fill(draft.firstMessage, draft, 'Kwame')}`,
      unnamed: `${disclosure} This call is being recorded. ${fill(draft.firstMessageNoName, draft, '')}`,
    };
  }, [draft]);

  async function save() {
    if (!draft) return;
    setSaving(true); setMsg(null);
    try {
      const d = await (await fetch(base, { method: 'PUT', headers, body: JSON.stringify({ ...draft, phoneNumberId }) })).json();
      if (d.success) { apply(d); setMsg({ ok: !d.sync?.error, text: `Voice agent saved.${syncText(d)}` }); }
      else setMsg({ ok: false, text: d.error ?? 'Save failed' });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setSaving(false); }
  }

  async function reset() {
    if (!window.confirm('Replace every field with the Africon defaults? Your edits will be lost.')) return;
    setSaving(true); setMsg(null);
    try {
      const d = await (await fetch(`${base}/reset`, { method: 'POST', headers })).json();
      if (d.success) { apply(d); setMsg({ ok: !d.sync?.error, text: `Restored the Africon defaults.${syncText(d)}` }); }
      else setMsg({ ok: false, text: d.error ?? 'Reset failed' });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setSaving(false); }
  }

  if (!view || !draft) {
    return (
      <div className="flex flex-col items-center gap-2 py-12">
        <Loader2 size={20} className="animate-spin text-slate-300" />
        {msg && <p className="text-xs text-red-500">{msg.text}</p>}
      </div>
    );
  }

  const set = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) => setDraft({ ...draft, [k]: v });
  const setEntry = (i: number, patch: Partial<AgentConfig['playbook'][number]>) =>
    set('playbook', draft.playbook.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const text = (k: keyof AgentConfig, rows?: number) => rows
    ? <textarea rows={rows} value={String(draft[k])} onChange={(e) => set(k, e.target.value as any)} className={`${inputCls} font-mono text-xs leading-relaxed`} />
    : <input value={String(draft[k])} onChange={(e) => set(k, e.target.value as any)} className={inputCls} />;

  const StatusLine = ({ ok, label }: { ok: boolean; label: string }) => (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      {ok ? <CheckCircle2 size={13} className="text-green-500" /> : <XCircle size={13} className="text-red-500" />}{label}
    </span>
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={saving} onClick={() => void save()} className={`${btn} bg-[#2563EB] text-white hover:bg-[#1D4ED8]`}>
        {saving && <Loader2 size={14} className="animate-spin" />}Save voice agent
      </button>
      <button type="button" disabled={saving} onClick={() => void reset()} className={`${btn} border border-slate-200 text-slate-600 hover:bg-slate-50`}>
        <RotateCcw size={14} /> Restore Africon defaults
      </button>
      {msg && <span className={`text-xs ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</span>}
    </div>
  );

  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-2xl border-2 border-[#2563EB]/30 bg-[#2563EB]/5 p-6">
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Mic size={18} className="text-[#2563EB]" /> Sales voice agent</h1>
        <p className="mt-1 text-xs text-slate-500">
          The one AI caller every sales call uses: who it is, what it says first, what it knows about {draft.businessName}, and the voice and model it runs on.
          Pre-filled from africon.ai{view.customised ? ' and since edited here' : ''}. Calling hours, caps and consent rules stay in each user's Sales → Settings.
        </p>
        <div className="mt-4">{actions}</div>
      </div>

      <Card title="Vapi connection" icon={<Phone size={16} className="text-slate-500" />}
        note="Keys live in Admin → Integrations → Vapi. The phone number is picked here, using those keys.">
        <div className="flex flex-wrap gap-4">
          <StatusLine ok={view.vapi.hasPrivateKey} label="Private key" />
          <StatusLine ok={view.vapi.hasPublicKey} label="Public key (browser tests)" />
          <StatusLine ok={view.vapi.hasWebhookSecret} label="Webhook secret" />
          {vapi && <StatusLine ok={vapi.ok} label={vapi.ok ? 'Vapi accepted the key' : (vapi.error ?? 'Vapi check failed')} />}
          <StatusLine ok={Boolean(view.vapi.inboundAssistantId)} label={view.vapi.inboundAssistantId ? 'Answers incoming calls' : 'Not answering incoming calls yet — save to sync'} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Calls are placed from" hint={vapi?.ok && !vapi.phoneNumbers.length ? 'This Vapi account has no phone numbers yet — buy or import one at dashboard.vapi.ai.' : 'The Vapi phone number outbound calls dial from.'}>
            {vapi?.ok && vapi.phoneNumbers.length ? (
              <select value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} className={inputCls}>
                <option value="">— choose a number —</option>
                {vapi.phoneNumbers.map((p) => (
                  <option key={p.id} value={p.id}>{p.number ?? p.id}{p.name ? ` · ${p.name}` : ''}</option>
                ))}
                {phoneNumberId && !vapi.phoneNumbers.some((p) => p.id === phoneNumberId) && (
                  <option value={phoneNumberId}>{phoneNumberId} (not found in this Vapi account)</option>
                )}
              </select>
            ) : (
              <input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="Vapi phone number ID" className={inputCls} />
            )}
          </Field>
          <button type="button" disabled={checking || !view.vapi.hasPrivateKey} onClick={() => void checkVapi()} className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
            {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Load from Vapi
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Provider">
            <select value={draft.provider} onChange={(e) => set('provider', e.target.value as AgentConfig['provider'])} className={inputCls}>
              <option value="vapi">Vapi (real calls)</option>
              <option value="simulator">Simulator (no real calls)</option>
            </select>
          </Field>
          <Field label="Max call length (sec)">
            <input type="number" min={60} max={1800} value={draft.maxCallDurationSec} onChange={(e) => set('maxCallDurationSec', Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Hang up after silence (sec)">
            <input type="number" min={10} max={120} value={draft.silenceTimeoutSec} onChange={(e) => set('silenceTimeoutSec', Number(e.target.value))} className={inputCls} />
          </Field>
        </div>
        {draft.provider === 'vapi' && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Vapi bills per minute. Telephony minutes are not metered by the credit system — watch the Vapi dashboard.
          </p>
        )}
      </Card>

      <Card title="Voice and model" note="Leave the voice ID blank to use Vapi's default voice.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Voice provider">
            <select value={draft.voiceProvider} onChange={(e) => set('voiceProvider', e.target.value)} className={inputCls}>
              {VOICE_PROVIDERS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Voice" hint="Pick a ready voice, or paste any voice ID from that provider.">
            <select
              value={VOICE_PRESETS.some((v) => v.id === draft.voiceId) ? draft.voiceId : ''}
              onChange={(e) => {
                const v = VOICE_PRESETS.find((p) => p.id === e.target.value);
                if (v) setDraft({ ...draft, voiceProvider: v.provider, voiceId: v.id });
              }}
              className={`${inputCls} mb-2`}
            >
              <option value="">Custom voice ID…</option>
              {VOICE_PRESETS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            {text('voiceId')}
          </Field>
          <Field label="Conversation model provider">
            <select value={draft.modelProvider} onChange={(e) => set('modelProvider', e.target.value)} className={inputCls}>
              {MODEL_PROVIDERS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Model" hint="A fast model keeps replies quick on a live call.">{text('model')}</Field>
          <Field label="Temperature" hint="Lower = more consistent; 0.3–0.5 suits sales calls.">
            <input type="number" min={0} max={1} step={0.1} value={draft.temperature} onChange={(e) => set('temperature', Number(e.target.value))} className={inputCls} />
          </Field>
        </div>
      </Card>

      <Card title="Identity and opening line"
        note="{agentName}, {businessName} and {firstName} are filled in on each call. The AI disclosure is added in code, so it cannot be talked away mid-call.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name (spoken)">{text('businessName')}</Field>
          <Field label="Agent name">{text('agentName')}</Field>
        </div>
        <Field label="Opening with AI disclosure" hint="Used when the user's policy requires disclosing the AI (the default, and always for test calls).">{text('disclosureText')}</Field>
        <Field label="Opening without AI disclosure">{text('greetingText')}</Field>
        <Field label="First line — lead's name known">{text('firstMessage', 2)}</Field>
        <Field label="First line — name unknown">{text('firstMessageNoName', 2)}</Field>
        {preview && (
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">What the lead hears</p>
            <p className="mt-1">“{preview.named}”</p>
            <p className="mt-1 text-slate-400">No name: “{preview.unnamed}”</p>
          </div>
        )}
      </Card>

      <Card title="Training" note="Everything below goes into the agent's brief on every call, alongside that lead's history.">
        <Field label="Persona and speaking style">{text('persona', 5)}</Field>
        <Field label="Goal of a first call" hint="Later pipeline stages keep their own goals.">{text('defaultObjective', 2)}</Field>
        <Field label="Company knowledge" hint="Services, prices, events, contacts. The agent may say only what is written here — update prices and event dates as they change.">{text('knowledge', 22)}</Field>
        <Field label="Extra rules" hint="One per line. Added to the agent's DO NOT list.">{text('extraRules', 4)}</Field>
      </Card>

      <Card title="Objection playbook"
        note="How the agent answers each objection and other situations. Every entry goes into every call; when a lead has an open objection, its entry is also attached to that objection.">
        <ul className="space-y-3">
          {draft.playbook.map((entry, i) => (
            <li key={i} className="rounded-xl border border-slate-200 p-3">
              <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                <select value={entry.code} onChange={(e) => setEntry(i, { code: e.target.value })} className={inputCls}>
                  {Object.entries(OBJECTION_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>{code === 'other' ? 'Other scenario' : label}</option>
                  ))}
                </select>
                <input value={entry.scenario} onChange={(e) => setEntry(i, { scenario: e.target.value })}
                  placeholder="What they say, or the situation" className={inputCls} />
                <button type="button" aria-label="Remove entry" onClick={() => set('playbook', draft.playbook.filter((_, j) => j !== i))}
                  className="rounded-lg border border-slate-200 p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 size={14} />
                </button>
              </div>
              <textarea rows={2} value={entry.response} onChange={(e) => setEntry(i, { response: e.target.value })}
                placeholder="How the agent should respond" className={`${inputCls} mt-2`} />
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => set('playbook', [...draft.playbook, { code: 'other', scenario: '', response: '' }])}
          className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
          <Plus size={14} /> Add scenario
        </button>
        <Field label="Additional notes on objections" hint="Optional free text, added after the playbook.">{text('objectionHandling', 3)}</Field>
      </Card>

      <Card title="Incoming calls" note="When someone rings the Vapi number, the agent answers with this line and the same persona, knowledge and rules. Saving pushes it to Vapi.">
        <Field label="Answering line">{text('inboundFirstMessage', 2)}</Field>
      </Card>

      <Card title="Ending the call">
        <Field label="Goodbye line">{text('endCallMessage')}</Field>
        <Field label="Voicemail message">{text('voicemailMessage', 3)}</Field>
      </Card>

      {actions}

      <VapiTestConsole leads={leads} />
    </div>
  );
}
