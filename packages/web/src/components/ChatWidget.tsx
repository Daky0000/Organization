import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart2,
  Calendar,
  CheckCircle,
  ChevronDown,
  Clock,
  Edit2,
  ExternalLink,
  Mic,
  MicOff,
  Loader2,
  History,
  Palette,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiBase';
import { PlatformLogo } from './PlatformLogo';
import { FORMAT_LABEL as SOCIAL_FORMAT_LABEL, PLATFORM_META, platformId } from './social/socialMeta';
import ImageFeedback from './social/ImageFeedback';
import { notifyCreditsChanged } from './CreditBadge';

// ── Types ────────────────────────────────────────────────────────────────────

type AttachedImg = { id: string; name: string; dataUrl: string };

type TextMessage = {
  kind: 'text';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: AttachedImg[];
  /** The text as typed (user messages), so a failed turn can be sent again. */
  raw?: string;
  /** The reply failed; the bubble shows the error and a Retry button. */
  failed?: boolean;
  /** What happens next, in plain words (shown under a failed reply). */
  hint?: string;
  /** When set, the reply is sent again automatically at this time (ms). */
  autoRetryAt?: number;
  /** Sent again automatically when the browser is back online. */
  waitOnline?: boolean;
  /** Which try this was (0 = first). Caps the automatic retries. */
  attempt?: number;
  /** A link that fixes the problem, e.g. top up credits. */
  fix?: { label: string; href: string };
};
/** What the assistant is doing this turn: steps, thinking, posts made. */
type ActivityMessage = {
  kind: 'activity';
  id: string;
  status: 'working' | 'done' | 'failed';
  steps: string[];
  thinking: string;
  startedAt: number;
  endedAt?: number;
  postsDone: number;
  postsTotal?: number;
  /** The server job writing this reply: followed again after a drop or a reload. */
  turnId?: string;
  /** The last event received from it (resuming asks for the ones after). */
  seq?: number;
  /** A connection note while it reconnects ("still working on the server…"). */
  banner?: string;
};
type ToolMessage = {
  kind: 'tool';
  id: string;
  name: string;
  label: string;
  status: 'running' | 'done' | 'error';
  result?: any;
  error?: string;
};
type FormQuestion = {
  id: string;
  text: string;
  options: string[];
  answer: string | null;
  customText: string;
};
type FormMessage = {
  kind: 'form';
  id: string;
  intro: string;
  questions: FormQuestion[];
  submitted: boolean;
};
type SchedulerMessage = {
  kind: 'scheduler';
  id: string;
  postTitle?: string;
  postContent?: string;
  submitted: boolean;
};
type PlanAgent = {
  key: string;
  name: string;
  icon: string;
  color: string;
  task: string;
  enabled: boolean;
};
type PlanMessage = {
  kind: 'plan';
  id: string;
  summary: string;
  agents: PlanAgent[];
  status: 'pending' | 'executing' | 'done';
  agentStatuses?: Record<string, { running: boolean; analysis: string }>;
  /** The server job running the team, its summary bubble and the last event seen. */
  turnId?: string;
  synthId?: string;
  seq?: number;
};
/** A credit estimate the user must accept before a paid action runs. */
type EstimateMessage = {
  kind: 'estimate';
  id: string;
  actionId: string;
  label: string;
  credits: number;
  lines: string[];
  balance: number | null;
  status: 'pending' | 'running' | 'done' | 'cancelled' | 'failed' | 'interrupted';
  error?: string;
  /** Live connection note while the job runs on the server (reconnecting, offline…). */
  banner?: string;
  /** Not enough credits to start: show the top-up link; the card stays usable. */
  needsCredits?: boolean;
  /** For a batch of posts: every planned post, shown before anything is paid for. */
  plan?: PlannedPostPreview[];
  /** One line: "30 posts: 10 × Instagram carousel, … Pillars: …". */
  summary?: string;
  /** "Try again" / "Write the rest" priced first: nothing runs or is charged until the user confirms. */
  regenQuote?: RegenQuote;
  quoting?: boolean;
};
type RegenQuote = { credits: number; label: string; lines: string[]; balance: number | null };
type PlannedPostPreview = { platform: string; format: string; slides?: number; topic: string; pillar?: string; scheduled_at?: string | null };
type BatchItem = {
  index: number; topic: string; platform?: string; format?: string;
  status: 'queued' | 'writing' | 'media' | 'done' | 'failed';
  progress?: string; post?: any; error?: string; note?: string;
};
/** Posts being written one by one; each lands on the calendar as soon as it is done. */
type BatchMessage = {
  kind: 'batch';
  id: string;
  total: number;
  items: BatchItem[];
  creditsUsed: number;
  status: 'running' | 'done';
  stopped?: string;
  banner?: string;
};
type Message = TextMessage | ToolMessage | FormMessage | SchedulerMessage | PlanMessage | ActivityMessage | EstimateMessage | BatchMessage;
type SessionMeta = { id: string; title: string; updated_at: string };
const NO_MESSAGES: Message[] = [];

function sessionTitle(msgs: Message[]): string {
  const first = msgs.find((m): m is TextMessage => m.kind === 'text' && m.role === 'user');
  const text = (first?.raw || first?.content || 'New chat').replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text || 'New chat';
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Reads an SSE response, calling onEvent per JSON event. True when the server sent [DONE]. */
async function readEventStream(res: Response, onEvent: (ev: any) => void): Promise<boolean> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return false;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return true;
      let ev: any;
      try { ev = JSON.parse(payload); } catch { continue; }
      // Only a stream-level error stops it; a failed tool or post carries its own `error`.
      if (ev?.error && (!ev.type || ev.type === 'error')) throw new Error(ev.error);
      onEvent(ev);
    }
  }
}

// ── Replies that run on the server ───────────────────────────────────────────
//
// A reply is a job on the server (it keeps going whatever this tab does). The
// chat follows it: if the tab is hidden, the phone sleeps or the network
// blips, the connection may drop — that is not a failure. The chat waits
// until the tab is back and online, then asks for the events it missed.

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolves once the tab is visible and the browser is online (at once if it already is). */
function whenReachable(): Promise<void> {
  return new Promise((resolve) => {
    const ok = () => document.visibilityState === 'visible' && navigator.onLine !== false;
    if (ok()) { resolve(); return; }
    const check = () => { if (ok()) { document.removeEventListener('visibilitychange', check); window.removeEventListener('online', check); resolve(); } };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
  });
}

/** Reads one response of a reply's events. `finished`: the reply ended; `elsewhere`: another server has it, ask again soon. */
async function readTurnStream(res: Response, onEvent: (ev: any) => void): Promise<{ finished: boolean; elsewhere: boolean }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { finished: false, elsewhere: false };
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return { finished: true, elsewhere: false };
      let ev: any;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev?.type === 'turn_elsewhere') return { finished: false, elsewhere: true };
      onEvent(ev);
    }
  }
}

/** A reply's own error (sent by the server), as opposed to a dropped connection. */
class TurnError extends Error { turnError = true; retryable: boolean; constructor(message: string, retryable = true) { super(message); this.retryable = retryable; } }

/**
 * Follows a server reply to its end. `start` sends it (the first time);
 * afterwards, and after any drop, the missed events are asked for by number.
 * Throws only for a real failure: an HTTP error, or the reply's own error.
 */
async function followServerTurn(opts: {
  turnId: string;
  start?: () => Promise<Response>;
  after?: number;
  onEvent: (ev: any) => void;
  onBanner: (text?: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  let after = opts.after ?? 0;
  let drops = 0;
  let restarts = 0;
  let next: (() => Promise<Response>) | null = opts.start ?? null;
  const reconnect = () => fetch(`${getApiBaseUrl()}/api/ai/chat/turns/${encodeURIComponent(opts.turnId)}/events?after=${after}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
    signal: opts.signal,
  });
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let res: Response | null = null;
    try {
      res = await (next ?? reconnect)();
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
    }
    next = null;
    if (res) {
      // The first send never reached the server: send it again (same id, so never twice).
      if (res.status === 404 && opts.start && after === 0 && restarts < 2) { restarts++; next = opts.start; continue; }
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as any));
        const e: any = new Error(d?.error || 'Request failed');
        e.status = res.status;
        throw e;
      }
      try {
        const r = await readTurnStream(res, (ev) => {
          if (drops) { drops = 0; opts.onBanner(undefined); }
          if (typeof ev?.seq === 'number' && ev.seq > after) after = ev.seq;
          opts.onEvent(ev);
        });
        if (r.finished) { opts.onBanner(undefined); return; }
        if (r.elsewhere) { await sleep(2500); continue; }
      } catch (err: any) {
        if (err?.name === 'AbortError' || err?.turnError) throw err;
      }
    }
    drops++;
    const away = document.visibilityState !== 'visible' || navigator.onLine === false;
    opts.onBanner(away
      ? "Still working on the server — I'll catch up when you're back."
      : 'Connection dropped — your reply is still being written on the server. Reconnecting…');
    await whenReachable();
    await sleep(Math.min(500 * 2 ** Math.min(drops, 4), 6000));
  }
}

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
};

/** "Write 5 LinkedIn posts" → 5: how many posts the person asked for, when they said. */
export function requestedPostCount(text: string): number | undefined {
  const m = text.toLowerCase().match(/\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)\s+(?:[a-z-]+\s+){0,3}?(?:posts?|drafts?|captions?|tweets?|threads?)\b/);
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  return n && n > 1 && n <= 60 ? n : undefined;
}

const POST_TOOLS = new Set(['create_draft', 'schedule_post']);

// ── Form parsing ─────────────────────────────────────────────────────────────

function formatQuestion(text: string): string {
  const clean = text.trim().replace(/[?!.,]*$/, '').replace(/^(?:please\s+)?(?:let me know|tell me|specify|provide|upload|attach)\s+/i, '');
  return clean.charAt(0).toUpperCase() + clean.slice(1) + '?';
}

function getSmartOptions(question: string): string[] {
  const q = question.toLowerCase();
  let options: string[];
  if (/how many|number of|quantity/.test(q))
    options = ['1', '2–3', '5–10', '10+'];
  else if (/platform|channel|network|social|where/.test(q))
    options = ['LinkedIn', 'Instagram', 'Twitter/X', 'Facebook', 'All platforms'];
  else if (/purpose|goal|objective|want to|trying/.test(q))
    options = ['Engagement', 'Promotion', 'Education', 'Brand awareness'];
  else if (/message|cta|call to action|copy|text/.test(q))
    options = ['Let AI suggest', 'Promotional', 'Informational', 'Inspirational'];
  else if (/dimension|size|format|resolution|ratio/.test(q))
    options = ['Square 1:1', 'Portrait 4:5', 'Landscape 16:9', 'Story 9:16'];
  else if (/style|design|look|feel|aesthetic/.test(q))
    options = ['Modern', 'Minimal', 'Bold', 'Professional'];
  else if (/color|colour|palette|theme/.test(q))
    options = ['Brand colors', 'Monochrome', 'Vibrant', 'Muted/Pastel'];
  else if (/upload|attach|share|image|photo/.test(q))
    options = ['Already attached', "I'll describe it", 'Use a template'];
  else
    options = ['Yes', 'No', 'Let AI decide'];
  options.push('Custom');
  return options;
}

function parseFormFromText(text: string): { intro: string; questions: FormQuestion[] } | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  type Block = { header: string; bullets: string[] };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const introLines: string[] = [];
  let inForm = false;

  for (const line of lines) {
    const num = line.match(/^(\d+)\.\s+(.+)$/);
    const bul = line.match(/^[-•*]\s+(.+)$/);
    if (num) {
      if (cur) blocks.push(cur);
      cur = { header: num[2], bullets: [] };
      inForm = true;
    } else if (bul && cur) {
      cur.bullets.push(bul[1].replace(/[?!]$/, '').trim());
    } else if (!inForm) {
      introLines.push(line);
    }
  }
  if (cur) blocks.push(cur);
  // Fallback: catch unnumbered "Did you mean:" / "Which option?" + bullet list pattern
  if (blocks.length === 0) {
    let qIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.match(/^[-•*\d]/) && (l.endsWith('?') || l.endsWith(':'))) qIdx = i;
    }
    if (qIdx >= 0) {
      const bullets: string[] = [];
      for (let i = qIdx + 1; i < lines.length; i++) {
        const bm = lines[i].match(/^[-•*]\s+(.+)$/);
        if (bm) bullets.push(bm[1].replace(/[?!,]$/, '').trim());
      }
      if (bullets.length >= 2) {
        blocks.push({ header: lines[qIdx].replace(/:$/, '').trim(), bullets });
      }
    }
  }

  if (blocks.length === 0) return null;
  // Allow single-block forms only when the block has 3+ clear option bullets
  if (blocks.length < 2 && blocks[0].bullets.length < 2) return null;

  const questions: FormQuestion[] = [];

  for (const block of blocks) {
    const bulletIsSubQ = block.bullets.some((b) => b.includes('?') || b.length > 40);

    if (block.bullets.length >= 2 && !bulletIsSubQ) {
      const opts = block.bullets
        .map((b) => b.replace(/\s*\(.*?\)\s*$/, '').trim())
        .filter(Boolean);
      // Add Custom only if no option already implies it
      const hasCustomLike = opts.some((o) => /^custom$|^other$|^my own|^i'll type|^type your/i.test(o));
      if (!hasCustomLike) opts.push('Custom');
      questions.push({ id: `q${questions.length}`, text: formatQuestion(block.header), options: opts, answer: null, customText: '' });
    } else if (block.bullets.length >= 2 && bulletIsSubQ) {
      for (const bullet of block.bullets) {
        const opts = getSmartOptions(bullet);
        const hasC = opts.some((o) => /^custom$|^other$|^my own|^i'll type|^type your/i.test(o));
        if (!hasC) opts.push('Custom');
        questions.push({ id: `q${questions.length}`, text: formatQuestion(bullet), options: opts, answer: null, customText: '' });
      }
    } else {
      const opts = getSmartOptions(block.header);
      const hasC = opts.some((o) => /^custom$|^other$|^my own|^i'll type|^type your/i.test(o));
      if (!hasC) opts.push('Custom');
      questions.push({ id: `q${questions.length}`, text: formatQuestion(block.header), options: opts, answer: null, customText: '' });
    }
  }

  const intro =
    introLines.filter((l) => l.length > 20).slice(0, 2).join(' ').trim() ||
    "To create exactly what you need, answer these quick questions:";

  return { intro, questions };
}

// ── Sparkle logo ──────────────────────────────────────────────────────────────

function SparkleAvatar({ size = 32 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-[10px] bg-navy text-white overflow-hidden"
      style={{ width: size, height: size }}
    >
      <img src="/brand/mark-on-dark-96.png" alt="Daky" className="h-[68%] w-[68%] object-contain" />
    </div>
  );
}

// ── Waveform ──────────────────────────────────────────────────────────────────

function WaveformBars() {
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {[3, 5, 8, 5, 3, 7, 4, 6, 3].map((h, i) => (
        <span key={i} className="w-0.5 rounded-full bg-indigo-500 animate-pulse"
          style={{ height: `${h}px`, animationDelay: `${i * 0.07}s`, animationDuration: '0.6s' }} />
      ))}
    </span>
  );
}

// ── Markdown-lite ─────────────────────────────────────────────────────────────

function renderText(text: string) {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>,
    );
    return <p key={i} className={i > 0 ? 'mt-1' : ''}>{parts}</p>;
  });
}

// ── Form card ────────────────────────────────────────────────────────────────

function FormCard({ msg, onSubmit }: { msg: FormMessage; onSubmit: (formatted: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, { selected: string | null; custom: string }>>({});

  const pick = (qId: string, opt: string) =>
    setAnswers((prev) => ({ ...prev, [qId]: { selected: opt, custom: '' } }));
  const setCustomText = (qId: string, txt: string) =>
    setAnswers((prev) => ({ ...prev, [qId]: { selected: 'Custom', custom: txt } }));

  const canSubmit =
    !msg.submitted &&
    msg.questions.every((q) => {
      const a = answers[q.id];
      if (!a?.selected) return false;
      if (a.selected === 'Custom' && !a.custom.trim()) return false;
      return true;
    });

  const handleSubmit = () => {
    const parts = msg.questions.map((q) => {
      const a = answers[q.id];
      const ans = a?.selected === 'Custom' ? a.custom.trim() : (a?.selected ?? 'Not specified');
      return `${q.text} → ${ans}`;
    });
    onSubmit(parts.join('\n'));
  };

  return (
    <div className="rounded-xl border border-indigo-100 bg-white overflow-hidden shadow-sm text-xs">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-indigo-50" style={{ background: 'linear-gradient(135deg,#EAF1FF,#EAF1FF)' }}>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-100">
            <Sparkles size={12} className="text-indigo-600" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-indigo-800">Quick Setup</p>
            <p className="text-[10px] text-indigo-500 leading-snug">{msg.intro}</p>
          </div>
        </div>
      </div>

      {/* Questions */}
      <div className="px-3.5 py-3 space-y-4 max-h-64 overflow-y-auto">
        {msg.questions.map((q, i) => {
          const a = answers[q.id];
          const isCustom = a?.selected === 'Custom';
          return (
            <div key={q.id}>
              <p className="font-bold text-slate-600 mb-1.5">
                <span className="mr-1.5 text-indigo-400">{i + 1}.</span>
                {q.text}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const picked = a?.selected === opt;
                  const isC = opt === 'Custom';
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={msg.submitted}
                      onClick={() => pick(q.id, opt)}
                      className={`rounded-full border px-2.5 py-1 font-semibold transition-all disabled:opacity-60 ${
                        picked
                          ? isC
                            ? 'border-slate-600 bg-slate-700 text-white'
                            : 'border-indigo-600 bg-indigo-600 text-white'
                          : isC
                          ? 'border-slate-300 bg-white text-slate-500 hover:border-slate-400'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700'
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              {isCustom && (
                <input
                  type="text"
                  placeholder="Type your answer…"
                  value={a?.custom ?? ''}
                  onChange={(e) => setCustomText(q.id, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) handleSubmit(); }}
                  disabled={msg.submitted}
                  autoFocus
                  className="mt-2 w-full rounded-lg border border-indigo-200 bg-indigo-50/40 px-2.5 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-3.5 py-2.5 border-t border-slate-100">
        {msg.submitted ? (
          <div className="flex items-center gap-2">
            <CheckCircle size={13} className="text-emerald-500 shrink-0" />
            <p className="text-[11px] text-emerald-600 font-semibold">Generating your content…</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            Generate <Send size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Scheduler card ───────────────────────────────────────────────────────────

function SchedulerCard({
  msg,
  onSchedule,
}: {
  msg: SchedulerMessage;
  onSchedule: (isoDate: string, label: string) => void;
}) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [quickPicked, setQuickPicked] = useState<string | null>(null);

  const pad = (n: number) => String(n).padStart(2, '0');

  const quickOptions = (() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const saturday = new Date(now);
    saturday.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + ((1 - now.getDay() + 7) % 7 || 7));

    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    return [
      { label: 'Tonight 8 PM', date: fmt(now), time: '20:00' },
      { label: 'Tomorrow 9 AM', date: fmt(tomorrow), time: '09:00' },
      { label: 'This weekend', date: fmt(saturday), time: '10:00' },
      { label: 'Next Monday', date: fmt(nextMonday), time: '09:00' },
    ];
  })();

  const pickQuick = (opt: (typeof quickOptions)[0]) => {
    setDate(opt.date);
    setTime(opt.time);
    setQuickPicked(opt.label);
  };

  const previewLabel = (() => {
    if (!date) return null;
    const dt = new Date(`${date}T${time}`);
    return dt.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  })();

  const handleSchedule = () => {
    const iso = new Date(`${date}T${time}`).toISOString();
    onSchedule(iso, previewLabel ?? date);
  };

  return (
    <div className="rounded-xl border border-blue-100 bg-white overflow-hidden shadow-sm text-xs">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-blue-50" style={{ background: 'linear-gradient(135deg,#eff6ff,#EAF1FF)' }}>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-100">
            <Calendar size={12} className="text-blue-600" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-blue-800">Schedule Post</p>
            {msg.postTitle && (
              <p className="text-[10px] text-blue-400 truncate max-w-[220px]">"{msg.postTitle}"</p>
            )}
          </div>
        </div>
      </div>

      {msg.submitted ? (
        <div className="px-3.5 py-4 flex items-center gap-2">
          <CheckCircle size={14} className="text-emerald-500 shrink-0" />
          <p className="text-[11px] text-emerald-700 font-semibold">Post scheduled!</p>
        </div>
      ) : (
        <>
          {/* Quick presets */}
          <div className="px-3.5 pt-3 pb-2">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Quick pick</p>
            <div className="grid grid-cols-2 gap-1.5">
              {quickOptions.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => pickQuick(opt)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all text-left ${
                    quickPicked === opt.label
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-300 hover:bg-blue-50/60'
                  }`}
                >
                  <Clock size={10} className="shrink-0" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom date + time */}
          <div className="px-3.5 pb-2">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Or pick a date</p>
            <div className="flex gap-2">
              <input
                type="date"
                value={date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => { setDate(e.target.value); setQuickPicked(null); }}
                className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
              <input
                type="time"
                value={time}
                onChange={(e) => { setTime(e.target.value); setQuickPicked(null); }}
                className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
          </div>

          {/* Preview */}
          {previewLabel && (
            <div className="mx-3.5 mb-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 flex items-center gap-2">
              <Calendar size={11} className="text-blue-500 shrink-0" />
              <span className="text-[11px] text-blue-700 font-semibold">{previewLabel}</span>
            </div>
          )}

          {/* Confirm button */}
          <div className="px-3.5 pb-3">
            <button
              type="button"
              disabled={!date}
              onClick={handleSchedule}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              <Calendar size={11} /> Confirm Schedule
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Poll card ─────────────────────────────────────────────────────────────────

function PollCard({ title }: { title?: string }) {
  const [voted, setVoted] = useState<number | null>(null);
  const options = ['Option A', 'Option B', 'Option C'];
  const votes = [42, 35, 23];
  const total = votes.reduce((a, b) => a + b, 0);
  return (
    <div className="rounded-xl border border-indigo-100 bg-white overflow-hidden shadow-sm text-xs">
      <div className="px-3 py-2 border-b border-indigo-50 bg-indigo-50 flex items-center gap-2">
        <BarChart2 size={13} className="text-indigo-500" />
        <span className="font-semibold text-indigo-700">{title ?? 'Poll Preview'}</span>
      </div>
      <div className="px-3 py-2 space-y-2">
        {options.map((opt, i) => {
          const pct = Math.round((votes[i] / total) * 100);
          return (
            <button key={i} type="button" onClick={() => setVoted(i)}
              className={`w-full rounded-lg overflow-hidden border text-left transition-all ${voted === i ? 'border-indigo-400' : 'border-slate-200 hover:border-indigo-200'}`}>
              <div className="relative px-2.5 py-1.5">
                <div className="absolute inset-0 rounded-lg" style={{ width: `${pct}%`, background: voted === i ? 'rgba(37, 99, 235,0.15)' : 'rgba(148,163,184,0.1)' }} />
                <div className="relative flex items-center justify-between">
                  <span className={voted === i ? 'font-semibold text-indigo-700' : 'text-slate-700'}>{opt}</span>
                  <span className="text-slate-400">{pct}%</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="px-3 pb-3 flex gap-2">
        <button type="button" className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-center text-xs font-semibold text-white hover:bg-indigo-700">Create Poll</button>
        <button type="button" className="flex-1 rounded-lg border border-slate-200 py-1.5 text-center text-xs font-semibold text-slate-600 hover:bg-slate-50">Share with Team</button>
      </div>
    </div>
  );
}

// ── Post preview cards ────────────────────────────────────────────────────────

function PostPreviewCard({ content, title }: { content: string; title?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm text-xs">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <span className="font-semibold text-slate-700">Post Preview</span>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 font-medium">Draft</span>
      </div>
      {title && <p className="px-3 pt-2 font-semibold text-slate-800">{title}</p>}
      <p className="px-3 py-2 text-slate-700 leading-relaxed whitespace-pre-wrap">{content}</p>
      <div className="px-3 pb-3 flex gap-2">
        <a href="/posts" className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          <Edit2 size={11} /> Edit
        </a>
        <a href="/posts" className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">Post</a>
      </div>
    </div>
  );
}

function PostDraftedCard({ title, multiple }: { title?: string; multiple?: boolean }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <CheckCircle size={15} className="text-emerald-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-emerald-800">{multiple ? 'Posts Drafted' : 'Post Drafted'}</p>
          {title && <p className="truncate text-xs text-emerald-700">"{title}"</p>}
        </div>
        <a href="/posts" className="shrink-0 flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">
          {multiple ? 'Visit Posts' : 'View Post'} <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}

// ── Tool card ─────────────────────────────────────────────────────────────────

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function ActivityCard({ msg }: { msg: ActivityMessage }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (msg.status !== 'working') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [msg.status]);

  const elapsed = fmtElapsed((msg.endedAt ?? now) - msg.startedAt);
  const current = msg.steps[msg.steps.length - 1] ?? 'Starting';
  const working = msg.status === 'working';
  const hasDetail = msg.steps.length > 1 || Boolean(msg.thinking);
  // Only once a post exists: a batch reports its own progress in its card.
  const postLine = msg.postsDone === 0 ? ''
    : msg.postsTotal ? `${Math.min(msg.postsDone, msg.postsTotal)} of ${msg.postsTotal} posts`
      : `${msg.postsDone} post${msg.postsDone === 1 ? '' : 's'} saved`;

  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${msg.status === 'failed' ? 'border-red-100 bg-red-50/60' : 'border-slate-200 bg-white'}`}>
      <button type="button" onClick={() => hasDetail && setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
        {working
          ? <Loader2 size={13} className="shrink-0 animate-spin text-indigo-500" />
          : msg.status === 'failed'
            ? <X size={13} className="shrink-0 text-red-500" />
            : <CheckCircle size={13} className="shrink-0 text-emerald-500" />}
        <span className={`min-w-0 flex-1 truncate ${working ? 'text-slate-700' : msg.status === 'failed' ? 'text-red-600' : 'text-slate-500'}`}>
          {working ? `${current}…` : msg.status === 'failed' ? `Stopped after ${elapsed}` : `Worked for ${elapsed}${postLine ? ` · ${postLine}` : ''}`}
        </span>
        {working && <span className="shrink-0 tabular-nums text-slate-400">{elapsed}</span>}
        {hasDetail && <ChevronDown size={13} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {working && msg.banner && <p className="mt-1.5 text-[11px] text-amber-700">{msg.banner}</p>}

      {working && postLine && (
        <div className="mt-2">
          <div className="mb-1 flex justify-between text-[10.5px] text-slate-500"><span>Posts</span><span className="tabular-nums">{postLine}</span></div>
          {msg.postsTotal && (
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${Math.min(100, (msg.postsDone / msg.postsTotal) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {open && hasDetail && (
        <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
          <ol className="space-y-1">
            {msg.steps.map((step, i) => {
              const live = working && i === msg.steps.length - 1;
              return (
                <li key={`${i}-${step}`} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                  {live ? <Loader2 size={11} className="mt-0.5 shrink-0 animate-spin text-indigo-400" /> : <CheckCircle size={11} className="mt-0.5 shrink-0 text-slate-300" />}
                  <span>{step}</span>
                </li>
              );
            })}
          </ol>
          {msg.thinking && (
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] italic leading-relaxed text-slate-500">
              {msg.thinking}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Asks before anything is made again: what it makes, what it costs, and the balance after. */
function RegenConfirm({ quote, busy, onConfirm, onDismiss }: { quote: RegenQuote; busy: boolean; onConfirm: () => void; onDismiss: () => void }) {
  const short = quote.balance !== null && quote.balance < quote.credits;
  return (
    <div className="mt-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-2 text-[11px]">
      <p className="font-semibold text-slate-800">{quote.label} — about {quote.credits} credits</p>
      {quote.lines.map((l) => <p key={l} className="text-slate-500">{l}</p>)}
      {quote.balance !== null && (
        <p className={short ? 'text-red-600' : 'text-slate-500'}>Balance {quote.balance} → {Math.max(0, quote.balance - quote.credits)} after this{short ? ' — not enough to finish everything' : ''}</p>
      )}
      <p className="text-slate-500">What's already made is kept and not charged again. Nothing runs until you confirm.</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={onConfirm}
          className="rounded-lg bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">Yes, make them</button>
        <button type="button" disabled={busy} onClick={onDismiss}
          className="rounded-lg bg-white px-3 py-1 font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">Not now</button>
        {short && <a href="/credits" className="font-semibold text-indigo-600 hover:underline">Top up credits →</a>}
      </div>
    </div>
  );
}

function EstimateCard({ msg, busy, onProceed, onCancel, onResume, onConfirmResume, onDismissResume }: { msg: EstimateMessage; busy: boolean; onProceed: () => void; onCancel: () => void; onResume: () => void; onConfirmResume: () => void; onDismissResume: () => void }) {
  const short = msg.needsCredits || (msg.balance !== null && msg.balance < msg.credits);
  const [showPlan, setShowPlan] = useState(false);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800">{msg.label}</p>
          {msg.lines.map((l) => <p key={l} className={`text-[11px] ${l.startsWith('⚠') ? 'text-amber-700' : 'text-slate-500'}`}>{l}</p>)}
          {msg.summary && /Pillars:/.test(msg.summary) && (
            <p className="mt-0.5 text-[11px] text-slate-500">Content pillars: {msg.summary.split('Pillars:')[1]?.trim()}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold tabular-nums text-slate-900">{msg.credits}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">credits</p>
        </div>
      </div>
      {msg.balance !== null && (
        <p className={`mt-1 text-[11px] ${short ? 'text-red-600' : 'text-slate-500'}`}>
          Balance {msg.balance} → {Math.max(0, msg.balance - msg.credits)} after this{short ? ' — not enough credits to finish' : ''}
        </p>
      )}
      {msg.plan && msg.plan.length > 0 && (
        <div className="mt-1.5">
          <button type="button" onClick={() => setShowPlan((v) => !v)} className="text-[11px] font-semibold text-indigo-600 hover:underline">
            {showPlan ? 'Hide the plan' : `See the plan (${msg.plan.length} post${msg.plan.length === 1 ? '' : 's'})`}
          </button>
          {showPlan && (
            <ul className="mt-1 max-h-56 divide-y divide-amber-100 overflow-y-auto rounded-lg bg-white/70 ring-1 ring-amber-100">
              {msg.plan.map((p, i) => {
                const pid = platformId(p.platform);
                const meta = pid ? PLATFORM_META[pid] : null;
                return (
                  <li key={i} className="flex items-start gap-2 px-2 py-1.5">
                    {pid && <span className="mt-0.5 shrink-0"><PlatformLogo platform={pid} size={13} /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] text-slate-700">{p.topic}</span>
                      <span className="block text-[10px]" style={{ color: meta?.color ?? '#94a3b8' }}>
                        {meta ? `${meta.label} ` : ''}{SOCIAL_FORMAT_LABEL[p.format] ?? p.format}{p.slides ? ` · ${p.slides} slides` : ''}{p.pillar ? ` · ${p.pillar}` : ''}
                      </span>
                    </span>
                    {p.scheduled_at && (
                      <span className="shrink-0 text-[10px] text-slate-400">
                        {new Date(p.scheduled_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {msg.banner && <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-700"><Loader2 size={11} className="animate-spin" />{msg.banner}</p>}
      {msg.status === 'pending' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={onProceed}
            className="rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">Proceed</button>
          <button type="button" disabled={busy} onClick={onCancel}
            className="rounded-lg bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          {short && <a href="/credits" className="text-[11px] font-semibold text-indigo-600 hover:underline">Top up credits →</a>}
        </div>
      ) : msg.status === 'running' ? (
        <p className="mt-1.5 text-[11px] font-medium text-indigo-700">Running — it keeps going even if you close the chat or lose connection.</p>
      ) : msg.status === 'done' ? (
        <p className="mt-1.5 text-[11px] font-medium text-emerald-700">✓ Approved and run</p>
      ) : msg.status === 'cancelled' ? (
        <p className="mt-1.5 text-[11px] text-slate-500">Cancelled — nothing was charged. Tell me what to change and I'll price it again.</p>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          <p className="text-[11px] font-medium text-red-600">
            {msg.status === 'interrupted' ? 'Stopped part-way when the server restarted. What was finished is saved and charged; the rest was not.' : msg.error || 'This did not finish — nothing more was charged.'}
          </p>
          {msg.regenQuote ? (
            <RegenConfirm quote={msg.regenQuote} busy={busy} onConfirm={onConfirmResume} onDismiss={onDismissResume} />
          ) : (
            <button type="button" disabled={busy || msg.quoting} onClick={onResume}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {msg.quoting ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} {msg.status === 'interrupted' ? 'Finish the rest' : 'Try again'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BatchCard({ msg, busy, onResume, quote, quoting, onConfirmResume, onDismissResume }: { msg: BatchMessage; busy: boolean; onResume: () => void; quote?: RegenQuote; quoting?: boolean; onConfirmResume: () => void; onDismissResume: () => void }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const done = msg.items.filter((i) => i.status === 'done').length;
  const failed = msg.items.filter((i) => i.status === 'failed').length;
  // A big batch is worked in parts of 10 (three posts at a time): each part's progress.
  const parts = msg.total > 10 ? Array.from({ length: Math.ceil(msg.total / 10) }, (_, p) => {
    const inPart = msg.items.filter((i) => Math.floor(i.index / 10) === p);
    return {
      n: p + 1, size: Math.min(10, msg.total - p * 10),
      done: inPart.filter((i) => i.status === 'done').length,
      failed: inPart.filter((i) => i.status === 'failed').length,
      active: inPart.some((i) => i.status === 'writing' || i.status === 'media'),
    };
  }) : [];
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-xs">
      <div className="border-b border-slate-100 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-slate-700">
            {msg.status === 'running' ? 'Creating posts' : 'Posts on your calendar'} · {done} of {msg.total}
          </span>
          <span className="tabular-nums text-slate-500">{msg.creditsUsed} credits used</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${msg.total ? ((done + failed) / msg.total) * 100 : 0}%` }} />
        </div>
        {parts.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {parts.map((p) => (
              <span key={p.n} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${p.done === p.size ? 'bg-emerald-50 text-emerald-700' : p.active ? 'bg-indigo-50 text-indigo-700' : p.failed ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                Part {p.n} {p.done === p.size ? '✓' : p.active ? `· ${p.done}/${p.size}` : p.done || p.failed ? `· ${p.done}/${p.size}` : '· waiting'}
              </span>
            ))}
          </div>
        )}
        {msg.banner && <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-700"><Loader2 size={11} className="shrink-0 animate-spin" />{msg.banner}</p>}
        {msg.status === 'running' && !msg.banner && (
          <p className="mt-1 text-[10.5px] text-slate-400">Each post goes on your calendar the moment it's written. You can close the chat — this keeps going.</p>
        )}
        {msg.stopped && <p className="mt-1 text-[11px] text-red-600">{msg.stopped}</p>}
      </div>
      <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
        {msg.items.map((item) => {
          const pid = platformId(item.platform ?? item.post?.social_platform);
          const meta = pid ? PLATFORM_META[pid] : null;
          const fmt = item.format ?? item.post?.post_format;
          const media: any[] = Array.isArray(item.post?.media_assets) ? item.post.media_assets : [];
          const busy = item.status === 'writing' || item.status === 'media';
          return (
            <li key={item.index} className="px-3 py-1.5">
              <button type="button" className="flex w-full items-center gap-2 text-left" disabled={item.status !== 'done' && !media.length}
                onClick={() => setOpenIdx((o) => (o === item.index ? null : item.index))}>
                {busy ? <Loader2 size={12} className="shrink-0 animate-spin text-indigo-500" />
                  : item.status === 'done' ? <CheckCircle size={12} className="shrink-0 text-emerald-500" />
                    : item.status === 'failed' ? <X size={12} className="shrink-0 text-red-500" />
                      : <Clock size={12} className="shrink-0 text-slate-300" />}
                {pid && <PlatformLogo platform={pid} size={14} />}
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${item.status === 'done' ? 'font-medium text-slate-800' : 'text-slate-500'}`}>{item.post?.title || item.topic || 'Waiting…'}</span>
                  <span className="block truncate text-[10px]" style={{ color: meta?.color ?? '#94a3b8' }}>
                    {meta ? `${meta.label} ${SOCIAL_FORMAT_LABEL[fmt] ?? ''}` : ''}{busy && item.progress ? ` · ${item.progress}` : ''}
                  </span>
                </span>
                {media[0]?.url && (
                  <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded bg-slate-100">
                    {media[0].type === 'video' ? <video src={media[0].url} className="h-full w-full object-cover" muted /> : <img src={media[0].url} alt="" className="h-full w-full object-cover" />}
                    {media.length > 1 && <span className="absolute bottom-0 right-0 bg-black/60 px-0.5 text-[8px] font-bold text-white">{media.length}</span>}
                  </span>
                )}
                {item.post?.scheduled_at && (
                  <span className="shrink-0 text-[10.5px] text-slate-400">
                    {new Date(item.post.scheduled_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </button>
              {item.status === 'failed' && item.error && <p className="pl-5 text-[10.5px] text-red-500">{item.error}</p>}
              {item.status === 'done' && item.note && <p className="pl-5 text-[10.5px] text-amber-700">{item.note}</p>}
              {item.status === 'done' && (
                <div className="pl-5"><FeedbackButtons subject="post" about={`${meta ? `${meta.label} ${SOCIAL_FORMAT_LABEL[fmt] ?? ''}: ` : ''}${item.post?.title || item.topic}`} refId={item.post?.id} /></div>
              )}
              {openIdx === item.index && (
                <div className="mt-1 space-y-1.5 rounded-lg bg-slate-50 p-2">
                  {media.length > 0 && (
                    <div className="flex gap-1 overflow-x-auto">
                      {media.map((m, k) => (
                        <span key={m.url + k} className="h-20 w-16 shrink-0 overflow-hidden rounded-md bg-slate-200">
                          {m.type === 'video' ? <video src={m.url} className="h-full w-full object-cover" controls /> : <img src={m.url} alt="" className="h-full w-full object-cover" />}
                        </span>
                      ))}
                    </div>
                  )}
                  {media.find((m) => m.type !== 'video') && (
                    <div className="text-[10.5px] text-slate-500">
                      Images for this post: <ImageFeedback compact url={media.find((m) => m.type !== 'video')!.url} about={`${meta ? `${meta.label} ${SOCIAL_FORMAT_LABEL[fmt] ?? ''}: ` : ''}${item.post?.title || item.topic}`} />
                    </div>
                  )}
                  {item.post?.content && <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">{item.post.content}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {msg.status === 'done' && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
          <span className="text-[11px] text-slate-500">
            {failed === 0 ? `All ${done} posts are scheduled — review or edit them any time before they publish.` : `${done} scheduled, ${failed} not written (not charged).`}
          </span>
          <span className="flex items-center gap-2">
            {failed > 0 && !quote && (
              <button type="button" disabled={busy || quoting} onClick={onResume}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {quoting ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} Write the rest ({failed})
              </button>
            )}
            {msg.stopped && <a href="/credits" className="text-[11px] font-semibold text-indigo-600 hover:underline">Top up</a>}
            {done > 0 && <a href="/posts/automation?tab=calendar" className="text-[11px] font-semibold text-indigo-600 hover:underline">Open calendar →</a>}
          </span>
          {quote && <div className="w-full"><RegenConfirm quote={quote} busy={busy} onConfirm={onConfirmResume} onDismiss={onDismissResume} /></div>}
        </div>
      )}
    </div>
  );
}

const INSTRUCTION_EXAMPLES = [
  'Every post needs an image.',
  'Write in British English and keep a warm, witty tone.',
  'Post to Instagram and LinkedIn unless I say otherwise.',
  'We are a new account — focus on growing followers.',
  'Never use more than 5 hashtags.',
];

/** The user's standing orders: every agent checks and obeys them on every task. */
function CustomInstructionsPanel({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [mode, setMode] = useState<'economy' | 'quality'>('economy');
  const [savedMode, setSavedMode] = useState<'economy' | 'quality'>('economy');
  const [prices, setPrices] = useState<{ economy_image: number; quality_image: number; video: number; quality_video?: number } | null>(null);
  const [max, setMax] = useState(4000);
  const [state, setState] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/ai/custom-instructions`, { headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const t = String(d?.instructions || ''); setText(t); setSaved(t);
        const m = d?.media_mode === 'quality' ? 'quality' : 'economy'; setMode(m); setSavedMode(m);
        if (d?.prices) setPrices(d.prices);
        if (d?.max) setMax(d.max);
        setState('idle');
      })
      .catch(() => setState('idle'));
  }, []);
  const save = async () => {
    setState('saving');
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/ai/custom-instructions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify({ instructions: text, media_mode: mode }),
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      setSaved(String(d?.instructions ?? text));
      setSavedMode(d?.media_mode === 'quality' ? 'quality' : 'economy');
      setState('saved');
    } catch { setState('error'); }
  };
  const dirty = text !== saved || mode !== savedMode;
  return (
    <div className="space-y-2.5 px-3 py-3">
      <div>
        <p className="text-xs font-semibold text-ink">Custom instructions</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">Rules every agent follows on every task — posts, calendars, images, replies. Write them like you'd brief a new team member.</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold text-ink">Images &amp; video</p>
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          {([
            { id: 'economy' as const, title: 'Lowest cost', note: prices ? `~${prices.economy_image} credits an image, ~${prices.video} per 5 s of video` : 'Good images and video at a lower price' },
            { id: 'quality' as const, title: 'Best quality', note: prices ? `~${prices.quality_image} credits an image, ~${prices.quality_video ?? prices.video * 2} per 5 s of video` : 'Magnific One images, Kling 3.0 video' },
          ]).map((o) => (
            <button key={o.id} type="button" onClick={() => { setMode(o.id); if (state === 'saved') setState('idle'); }}
              className={`rounded-[10px] border px-2.5 py-2 text-left ${mode === o.id ? 'border-blue bg-pale/60' : 'border-line hover:border-blue'}`}>
              <span className="block text-[11.5px] font-semibold text-ink">{o.title}{o.id === 'economy' ? ' · default' : ''}</span>
              <span className="block text-[10px] leading-snug text-muted">{o.note}</span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-faint">A model you name in chat always wins.</p>
      </div>
      <textarea value={text} onChange={(e) => { setText(e.target.value.slice(0, max)); if (state === 'saved') setState('idle'); }} rows={6}
        placeholder={'e.g.\n• Every post needs an image.\n• We are a brand-new account.\n• Keep captions under 100 words.'}
        disabled={state === 'loading'}
        className="w-full resize-y rounded-[10px] border border-line bg-soft px-2.5 py-2 text-xs leading-relaxed text-ink outline-none focus:border-blue" />
      <div className="flex flex-wrap gap-1">
        {INSTRUCTION_EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setText((t) => (t.includes(ex) ? t : `${t.trim() ? `${t.trim()}\n` : ''}${ex}`))}
            className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-muted hover:border-blue hover:text-ink">+ {ex}</button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={!dirty || state === 'saving'}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          {state === 'saving' && <Loader2 size={11} className="animate-spin" />} Save
        </button>
        <button type="button" onClick={onDone} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-muted hover:bg-soft">Back to chat</button>
        <span className="ml-auto text-[10.5px] tabular-nums text-faint">{text.length}/{max}</span>
      </div>
      {state === 'saved' && <p className="text-[11px] font-medium text-emerald-700">✓ Saved — every agent will follow these from your next task.</p>}
      {state === 'error' && <p className="text-[11px] text-red-600">Couldn't save — check your connection and press Save again.</p>}
      <DesignSystemSection />
      <LearnedPreferences />
    </div>
  );
}

/** Shrinks a picked image to at most 1600 px (JPEG) before upload, then uploads it; returns its public address. */
async function uploadImage(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) throw new Error('Choose a PNG, JPG or WebP image.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => reject(new Error('That file is not a readable image.'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
  const r = await fetch(`${getApiBaseUrl()}/api/ai/taste/upload`, { method: 'POST', headers: authJson(), body: JSON.stringify({ data_url: dataUrl }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d?.url) throw new Error(d?.error || 'Upload failed — please try again.');
  return String(d.url);
}

type TasteView = {
  summary: string;
  examples: Array<{ id: string; url: string; note: string; source: string; saved_in_magnific: boolean }>;
  rules: Array<{ id: string; directive: string; avoid_term: string; source: string; enforced_by_magnific: boolean }>;
  assets: Array<{ id: string; type: 'product' | 'character' | 'locations'; name: string; description: string; images: string[]; saved_in_magnific: boolean }>;
  brand_kit: boolean;
  autopilot_style: boolean;
  uploads: boolean;
  limits: { examples: number; rules: number; assets: number };
};

const ASSET_TYPES = [
  { id: 'product', label: 'Product' },
  { id: 'character', label: 'Person' },
  { id: 'locations', label: 'Place' },
] as const;

/** Teach the image generators: example designs, rules from 👎, and saved products/people/places. */
function StylePanel({ onDone }: { onDone: () => void }) {
  const [taste, setTaste] = useState<TasteView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [rule, setRule] = useState('');
  const [adding, setAdding] = useState(false);
  const [asset, setAsset] = useState<{ type: 'product' | 'character' | 'locations'; name: string; description: string; images: string[] }>({ type: 'product', name: '', description: '', images: [] });
  const exampleInput = useRef<HTMLInputElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${getApiBaseUrl()}/api/ai/taste${path}`, { method, headers: authJson(), body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || 'Something went wrong — please try again.');
    if (d?.taste) setTaste(d.taste);
    return d;
  };
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e: any) { setError(e?.message || 'Something went wrong.'); } finally { setBusy(null); }
  };
  useEffect(() => { void run('load', () => call('GET', '')); }, []);

  const addExamples = (files: FileList | null) => run('examples', async () => {
    for (const f of Array.from(files ?? []).slice(0, 12)) {
      const url = await uploadImage(f);
      await call('POST', '/examples', { url, note: f.name.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 80) });
    }
  });
  const addAssetImages = (files: FileList | null) => run('asset-images', async () => {
    const urls: string[] = [];
    for (const f of Array.from(files ?? []).slice(0, 6 - asset.images.length)) urls.push(await uploadImage(f));
    setAsset((a) => ({ ...a, images: [...a.images, ...urls].slice(0, 6) }));
  });

  const examplesFull = (taste?.examples.length ?? 0) >= (taste?.limits.examples ?? 12);
  const small = 'text-[10.5px] leading-snug';

  return (
    <div className="space-y-3 px-3 py-3">
      <div>
        <p className="text-xs font-semibold text-ink">Teach your image style</p>
        <p className={`${small} mt-0.5 text-muted`}>Show examples you love, say what to avoid, and save the products, people and places that must look right. Every image the agents make follows this.</p>
      </div>

      {taste?.summary ? (
        <div className="rounded-[10px] border border-blue/30 bg-pale/50 px-2.5 py-2">
          <p className="text-[10.5px] font-semibold text-ink">Your style, as we understand it</p>
          <p className={`${small} mt-0.5 text-ink`}>{taste.summary}</p>
        </div>
      ) : taste && taste.examples.length > 0 ? (
        <p className={`${small} text-muted`}>Reading your examples… the style summary appears here in a moment.</p>
      ) : null}

      {/* 1. Example designs */}
      <section className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[11.5px] font-semibold text-ink">Example designs you love</p>
          <span className="text-[10px] tabular-nums text-faint">{taste?.examples.length ?? 0}/{taste?.limits.examples ?? 12}</span>
        </div>
        {taste && taste.examples.length > 0 ? (
          <div className="grid grid-cols-4 gap-1.5">
            {taste.examples.map((e) => (
              <div key={e.id} className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-soft" title={e.note || (e.source === 'liked' ? 'You liked this image' : 'Example')}>
                <img src={e.url} alt={e.note || 'Example design'} className="h-full w-full object-cover" />
                {e.source === 'liked' && <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">👍</span>}
                <button type="button" onClick={() => void run('remove', () => call('DELETE', `/examples/${e.id}`))} aria-label="Remove example"
                  className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex"><X size={10} /></button>
              </div>
            ))}
          </div>
        ) : <p className={`${small} text-faint`}>No examples yet. Add 3–6 designs (yours or ones you admire) for the best results.</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <input ref={exampleInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { void addExamples(e.target.files); e.target.value = ''; }} />
          <button type="button" disabled={busy !== null || examplesFull || taste?.uploads === false} title={taste?.uploads === false ? 'Uploads are unavailable right now — paste an image link instead' : undefined} onClick={() => exampleInput.current?.click()}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
            {busy === 'examples' ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add images
          </button>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="or paste an image link"
            className="min-w-0 flex-1 rounded-lg border border-line bg-soft px-2 py-1 text-[11px] outline-none focus:border-blue" />
          <button type="button" disabled={!link.trim() || busy !== null || examplesFull} onClick={() => void run('link', async () => { await call('POST', '/examples', { url: link.trim() }); setLink(''); })}
            className="rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-40">Add</button>
        </div>
        <p className={`${small} text-faint`}>Tip: 👍 on any image the agents make adds it here.</p>
      </section>

      {/* 2. Rules */}
      <section className="space-y-1.5 border-t border-line pt-2.5">
        <p className="text-[11.5px] font-semibold text-ink">Never in my images</p>
        {taste && taste.rules.length > 0 ? (
          <ul className="space-y-1">
            {taste.rules.map((r) => (
              <li key={r.id} className="group flex items-start gap-1.5 rounded-lg bg-soft px-2 py-1">
                <span className="min-w-0 flex-1">
                  <span className={`${small} block text-ink`}>{r.directive}</span>
                  <span className="text-[9.5px] text-faint">bans “{r.avoid_term}”{r.enforced_by_magnific ? ' · enforced by Magnific' : ''}</span>
                </span>
                <button type="button" onClick={() => void run('remove', () => call('DELETE', `/rules/${r.id}`))} aria-label="Remove rule" className="shrink-0 text-faint hover:text-red-500"><X size={11} /></button>
              </li>
            ))}
          </ul>
        ) : <p className={`${small} text-faint`}>No rules yet. 👎 an image and say what's wrong, or add one here.</p>}
        <div className="flex gap-1">
          <input value={rule} onChange={(e) => setRule(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && rule.trim()) void run('rule', async () => { await call('POST', '/rules', { reason: rule.trim() }); setRule(''); }); }}
            placeholder="e.g. No dark backgrounds, no stock-photo people"
            className="min-w-0 flex-1 rounded-lg border border-line bg-soft px-2 py-1 text-[11px] outline-none focus:border-blue" />
          <button type="button" disabled={!rule.trim() || busy !== null} onClick={() => void run('rule', async () => { await call('POST', '/rules', { reason: rule.trim() }); setRule(''); })}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-40">
            {busy === 'rule' && <Loader2 size={11} className="animate-spin" />}Add
          </button>
        </div>
      </section>

      {/* 3. Products, people and places */}
      <section className="space-y-1.5 border-t border-line pt-2.5">
        <div className="flex items-center justify-between">
          <p className="text-[11.5px] font-semibold text-ink">Products, people &amp; places to keep consistent</p>
          {!adding && <button type="button" onClick={() => setAdding(true)} className="text-[11px] font-semibold text-indigo-600">+ Add</button>}
        </div>
        {taste && taste.assets.length > 0 ? (
          <ul className="space-y-1">
            {taste.assets.map((a) => (
              <li key={a.id} className="group flex items-center gap-2 rounded-lg bg-soft px-2 py-1">
                {a.images[0] && <img src={a.images[0]} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-ink">@{a.name} <span className="font-normal text-faint">· {ASSET_TYPES.find((t) => t.id === a.type)?.label} · {a.images.length} photo{a.images.length === 1 ? '' : 's'}</span></span>
                  {a.description && <span className="block truncate text-[10px] text-muted">{a.description}</span>}
                </span>
                <button type="button" onClick={() => void run('remove', () => call('DELETE', `/assets/${a.id}`))} aria-label="Remove item" className="shrink-0 text-faint hover:text-red-500"><X size={11} /></button>
              </li>
            ))}
          </ul>
        ) : !adding ? <p className={`${small} text-faint`}>Save a product, mascot, team member or location once; mention it (e.g. “a post about @coffee_bag”) and it looks the same every time.</p> : null}
        {adding && (
          <div className="space-y-1.5 rounded-[10px] border border-line p-2">
            <div className="flex gap-1">
              {ASSET_TYPES.map((t) => (
                <button key={t.id} type="button" onClick={() => setAsset((a) => ({ ...a, type: t.id }))}
                  className={`rounded-full border px-2 py-0.5 text-[10.5px] ${asset.type === t.id ? 'border-blue bg-pale text-ink' : 'border-line text-muted'}`}>{t.label}</button>
              ))}
            </div>
            <input value={asset.name} onChange={(e) => setAsset((a) => ({ ...a, name: e.target.value }))} placeholder="Name, e.g. coffee_bag"
              className="w-full rounded-lg border border-line bg-soft px-2 py-1 text-[11px] outline-none focus:border-blue" />
            <input value={asset.description} onChange={(e) => setAsset((a) => ({ ...a, description: e.target.value }))} placeholder="Short description, e.g. kraft-paper bag with a blue label"
              className="w-full rounded-lg border border-line bg-soft px-2 py-1 text-[11px] outline-none focus:border-blue" />
            <div className="flex flex-wrap items-center gap-1">
              {asset.images.map((u) => <img key={u} src={u} alt="" className="h-9 w-9 rounded object-cover" />)}
              <input ref={assetInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { void addAssetImages(e.target.files); e.target.value = ''; }} />
              {asset.images.length < 6 && (
                <button type="button" disabled={busy !== null} onClick={() => assetInput.current?.click()}
                  className="inline-flex h-9 items-center gap-1 rounded border border-dashed border-line px-2 text-[10.5px] text-muted">
                  {busy === 'asset-images' ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Photos ({asset.images.length}/6)
                </button>
              )}
            </div>
            <div className="flex gap-1.5">
              <button type="button" disabled={!asset.name.trim() || !asset.images.length || busy !== null}
                onClick={() => void run('asset', async () => { await call('POST', '/assets', asset); setAsset({ type: 'product', name: '', description: '', images: [] }); setAdding(false); })}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
                {busy === 'asset' && <Loader2 size={11} className="animate-spin" />} Save
              </button>
              <button type="button" onClick={() => { setAdding(false); setAsset({ type: 'product', name: '', description: '', images: [] }); }} className="rounded-lg px-2 py-1 text-[11px] text-muted">Cancel</button>
            </div>
          </div>
        )}
      </section>

      {taste && (
        <label className="flex cursor-pointer items-start gap-2 border-t border-line pt-2.5">
          <input type="checkbox" checked={taste.autopilot_style} disabled={busy !== null}
            onChange={(e) => void run('settings', () => call('PUT', '/settings', { autopilot_style: e.target.checked }))} className="mt-0.5" />
          <span className={small}>
            <span className="block font-semibold text-ink">Use my style in Autopilot too</span>
            <span className="text-muted">Autopilot's images follow these examples, rules and saved items. Approving or rejecting its images keeps teaching it.</span>
          </span>
        </label>
      )}
      {error && <p className="rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-600">{error}</p>}
      {taste && (taste.examples.length > 0 || taste.rules.length > 0 || taste.assets.length > 0) && (
        <p className={`${small} text-faint`}>{taste.brand_kit ? '✓ Saved in Magnific with your Brand Kit — used on every image.' : 'Saved — sent to Magnific with your next image, then reused.'}</p>
      )}
      <button type="button" onClick={onDone} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-muted hover:bg-soft">Back to chat</button>
    </div>
  );
}

const authJson = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` });

type DesignSystemView = {
  brand_name: string; website_url: string; colors: Array<{ hex: string; role: string }>; typography: Array<{ family: string; use: string }>;
  logos: Array<{ url: string }>; rules: string[]; magnific_kit_id?: string | null; magnific_synced?: boolean;
};

/** The design system captured from the website, and whether Magnific already has it as a Brand Kit. */
function DesignSystemSection() {
  const [design, setDesign] = useState<DesignSystemView | null>(null);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rule, setRule] = useState('');
  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/ai/design-system`, { headers: authJson() })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { setDesign(d?.design ?? null); setUrl(d?.design?.website_url ?? ''); })
      .catch(() => undefined).finally(() => setLoading(false));
  }, []);
  const scan = async () => {
    setScanning(true); setError(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/ai/design-system/scan`, { method: 'POST', headers: authJson(), body: JSON.stringify({ url }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'Could not scan that site.');
      setDesign(d.design);
    } catch (e: any) { setError(e?.message || 'Could not scan that site.'); } finally { setScanning(false); }
  };
  const addRule = async () => {
    const text = rule.trim();
    if (!text || !design) return;
    const r = await fetch(`${getApiBaseUrl()}/api/ai/design-system`, { method: 'PUT', headers: authJson(), body: JSON.stringify({ rules: [...(design.rules ?? []), text] }) });
    const d = await r.json().catch(() => null);
    if (d?.design) { setDesign(d.design); setRule(''); }
  };
  return (
    <div className="space-y-1.5 border-t border-line pt-2.5">
      <p className="text-xs font-semibold text-ink">Design system</p>
      {loading ? <p className="text-[11px] text-muted">Loading…</p> : design ? (
        <div className="space-y-1.5">
          <p className="text-[10.5px] text-muted">From {design.website_url || 'your website'} — every image and agent uses it.</p>
          <div className="flex flex-wrap gap-1">
            {design.colors.map((c) => (
              <span key={c.hex + c.role} title={`${c.role} ${c.hex}`} className="flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink">
                <span className="h-3 w-3 rounded-full border border-black/10" style={{ background: c.hex }} />{c.hex}
              </span>
            ))}
          </div>
          {design.typography.length > 0 && <p className="text-[10.5px] text-ink">Fonts: {design.typography.map((f) => `${f.family} (${f.use})`).join(', ')}</p>}
          {design.rules?.length > 0 && <ul className="list-disc pl-4 text-[10.5px] text-ink">{design.rules.map((r) => <li key={r}>{r}</li>)}</ul>}
          <p className={`text-[10.5px] ${design.magnific_synced ? 'text-emerald-700' : 'text-muted'}`}>
            {design.magnific_synced ? '✓ Saved in Magnific as your Brand Kit — reused for every Magnific image.' : 'Sent to Magnific as a Brand Kit the first time you make a Magnific image, then reused.'}
          </p>
          <div className="flex gap-1">
            <input value={rule} onChange={(e) => setRule(e.target.value)} placeholder="Add a design rule, e.g. Always dark backgrounds"
              className="min-w-0 flex-1 rounded-lg border border-line bg-soft px-2 py-1 text-[11px] outline-none focus:border-blue" />
            <button type="button" onClick={() => void addRule()} disabled={!rule.trim()} className="rounded-lg border border-line px-2 text-[11px] font-semibold text-ink disabled:opacity-40">Add</button>
          </div>
        </div>
      ) : <p className="text-[10.5px] text-muted">Not captured yet. Scan your website to save your colours, fonts and logo.</p>}
      <div className="flex gap-1">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourwebsite.com"
          className="min-w-0 flex-1 rounded-lg border border-line bg-soft px-2 py-1 text-[11px] outline-none focus:border-blue" />
        <button type="button" onClick={() => void scan()} disabled={!url.trim() || scanning}
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 text-[11px] font-semibold text-white disabled:opacity-50">
          {scanning && <Loader2 size={11} className="animate-spin" />}{design ? 'Rescan' : 'Scan'}
        </button>
      </div>
      {error && <p className="text-[10.5px] text-red-600">{error}</p>}
    </div>
  );
}

type LearnedItem = { id: string; kind: string; subject: string; note: string; created_at: string };

/** What the agents have learned from the user's edits, deletions, reviews and feedback — removable. */
function LearnedPreferences() {
  const [items, setItems] = useState<LearnedItem[] | null>(null);
  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/ai/preferences`, { headers: authJson() })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setItems(Array.isArray(d?.preferences) ? d.preferences : [])).catch(() => setItems([]));
  }, []);
  const forget = (id: string) => {
    setItems((list) => (list ?? []).filter((x) => x.id !== id));
    void fetch(`${getApiBaseUrl()}/api/ai/preferences/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authJson() }).catch(() => undefined);
  };
  const icon: Record<string, string> = { like: '👍', dislike: '👎', change: '✏️', rule: '📌' };
  return (
    <div className="space-y-1.5 border-t border-line pt-2.5">
      <p className="text-xs font-semibold text-ink">What I've learned about you</p>
      <p className="text-[10.5px] text-muted">From your edits, deletions, reviews and 👍/👎 — every agent checks this before working. Remove anything that's wrong.</p>
      {items === null ? <p className="text-[11px] text-muted">Loading…</p> : items.length === 0 ? (
        <p className="text-[10.5px] text-faint">Nothing yet. Edit or delete a post, rate a reply, or tell me what you like.</p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {items.map((it) => (
            <li key={it.id} className="group flex items-start gap-1.5 rounded-lg bg-soft px-2 py-1 text-[10.5px] text-ink">
              <span className="shrink-0">{icon[it.kind] ?? '•'}</span>
              <span className="min-w-0 flex-1 break-words">{it.note}</span>
              <button type="button" onClick={() => forget(it.id)} aria-label="Forget this" className="shrink-0 text-faint hover:text-red-500"><X size={11} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 👍 / 👎 under a reply or a post; 👎 asks what to change. Saved to the user's preference memory. */
function FeedbackButtons({ subject, about, refId }: { subject: 'reply' | 'post'; about: string; refId?: string }) {
  const [sent, setSent] = useState<'up' | 'down' | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const send = (rating: 'up' | 'down', why = '') => {
    setSent(rating); setAsking(false);
    void fetch(`${getApiBaseUrl()}/api/ai/feedback`, { method: 'POST', headers: authJson(), body: JSON.stringify({ rating, subject, about: about.slice(0, 240), reason: why, ref_id: refId }) }).catch(() => undefined);
  };
  if (sent) return <span className="text-[10px] text-faint">{sent === 'up' ? '👍 Noted — I\'ll do more like this.' : '👎 Noted — I\'ll avoid this next time.'}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button type="button" onClick={() => send('up')} aria-label="I like this" className="rounded px-1 text-[11px] text-faint hover:bg-soft hover:text-ink">👍</button>
      <button type="button" onClick={() => setAsking(true)} aria-label="I don't like this" className="rounded px-1 text-[11px] text-faint hover:bg-soft hover:text-ink">👎</button>
      {asking && (
        <span className="flex items-center gap-1">
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send('down', reason); }}
            placeholder="What should change? (optional)" className="w-44 rounded border border-line bg-white px-1.5 py-0.5 text-[10.5px] outline-none focus:border-blue" />
          <button type="button" onClick={() => send('down', reason)} className="text-[10.5px] font-semibold text-indigo-600">Save</button>
        </span>
      )}
    </span>
  );
}

/** A failed reply: what happened, what happens next, and the one button that fixes it. */
function FailedReply({ msg, busy, onRetry, onStopAuto }: { msg: TextMessage; busy: boolean; onRetry: () => void; onStopAuto: () => void }) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  useEffect(() => {
    if (!msg.autoRetryAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [msg.autoRetryAt]);
  useEffect(() => {
    if (fired.current || busy || !msg.autoRetryAt || now < msg.autoRetryAt) return;
    fired.current = true;
    onRetry();
  }, [now, msg.autoRetryAt, busy, onRetry]);
  useEffect(() => {
    if (!msg.waitOnline) return;
    const back = () => { if (!fired.current) { fired.current = true; onRetry(); } };
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [msg.waitOnline, onRetry]);

  const secs = msg.autoRetryAt ? Math.max(0, Math.ceil((msg.autoRetryAt - now) / 1000)) : 0;
  return (
    <div className="flex justify-start gap-1.5">
      <SparkleAvatar size={22} />
      <div className="max-w-[80%] space-y-1.5 rounded-2xl rounded-bl-sm border border-red-100 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
        <p className="font-medium">{msg.content}</p>
        {msg.hint && <p className="text-[11px] text-red-600/90">{msg.hint}</p>}
        {msg.autoRetryAt && (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-600"><Loader2 size={11} className="animate-spin" />Trying again automatically in {secs}s…</p>
        )}
        {msg.waitOnline && (
          <p className="flex items-center gap-1.5 text-[11px] text-slate-600"><Loader2 size={11} className="animate-spin" />Waiting for your connection — I'll send it the moment you're back online.</p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {msg.fix ? (
            <a href={msg.fix.href} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700">{msg.fix.label}</a>
          ) : null}
          <button type="button" disabled={busy} onClick={() => { fired.current = true; onRetry(); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-100 disabled:opacity-50">
            <RotateCcw size={11} /> {msg.autoRetryAt || msg.waitOnline ? 'Retry now' : 'Retry'}
          </button>
          {(msg.autoRetryAt || msg.waitOnline) && (
            <button type="button" onClick={() => { fired.current = true; onStopAuto(); }} className="text-[11px] text-slate-500 underline hover:text-slate-700">Don't retry</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Turns a failure into plain words, a next step, and whether to retry on its own. */
function describeFailure(err: any, attempt: number): Pick<TextMessage, 'content' | 'hint' | 'autoRetryAt' | 'waitOnline' | 'fix'> {
  const raw = String(err?.message || '');
  const status: number | undefined = err?.status;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const network = !status && (err instanceof TypeError || /network|failed to fetch|load failed|dropped|connection|ERR_/i.test(raw));
  if (offline) {
    return { content: "You're offline.", hint: 'Anything already started is still running on the server and is saved.', waitOnline: true };
  }
  if (status === 402 || /out of (ai )?credits|not enough credits|insufficient/i.test(raw)) {
    return { content: raw || "You're out of credits.", hint: 'Top up, then press Retry — your message is kept.', fix: { label: 'Top up credits', href: '/credits' } };
  }
  if (status === 429 || /rate limit|too many/i.test(raw)) {
    return { content: "You're sending messages faster than I can take them.", hint: 'I\'ll send this one again in a moment.', autoRetryAt: Date.now() + 20_000 };
  }
  if (network) {
    return attempt < 2
      ? { content: 'The connection dropped before my reply finished.', hint: "Anything already created is saved, and trying again won't make duplicates.", autoRetryAt: Date.now() + 4_000 }
      : { content: 'The connection keeps dropping.', hint: "Check your internet, then press Retry. Anything already created is saved, and trying again won't make duplicates." };
  }
  return attempt < 1
    ? { content: raw || 'Something went wrong.', hint: 'The AI models are busy right now.', autoRetryAt: Date.now() + 20_000 }
    : { content: raw || 'Something went wrong.', hint: 'Still busy. Press Retry in a minute, or try a shorter request.' };
}

function ToolCard({ msg }: { msg: ToolMessage }) {
  if (msg.status === 'running') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-purple-100 bg-purple-50 px-3 py-2 text-xs text-purple-700">
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (<span key={i} className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />))}
        </span>
        {msg.label}
      </div>
    );
  }
  if (msg.status === 'error') {
    return <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">✗ {msg.error || 'Action failed'}</div>;
  }
  if (msg.name === 'get_recent_posts') {
    const posts: any[] = msg.result?.posts ?? [];
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
        <div className="border-b border-slate-100 px-3 py-2 font-semibold text-slate-700">{posts.length} post{posts.length !== 1 ? 's' : ''} found</div>
        {posts.length === 0 ? <p className="px-3 py-2 text-slate-400">No posts yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {posts.slice(0, 5).map((p: any) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate text-slate-800 font-medium">{p.title || 'Untitled'}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold capitalize ${p.status === 'published' ? 'bg-emerald-50 text-emerald-700' : p.status === 'scheduled' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (msg.name === 'get_connected_platforms') {
    const platforms: any[] = msg.result?.connected ?? [];
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
        <span className="font-semibold text-slate-700">Connected: </span>
        {platforms.length === 0 ? <span className="text-slate-400">None connected</span> : platforms.map((p: any) => (
          <span key={p.platform} className="mr-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 capitalize text-slate-700">{p.platform}</span>
        ))}
      </div>
    );
  }
  if (msg.name === 'create_draft') {
    const post = msg.result?.post;
    const posts: any[] = msg.result?.posts ?? (post ? [post] : []);
    const isMultiple = posts.length > 1;
    const content = post?.content ?? '';
    const title = post?.title;
    if (!isMultiple && content && content.length < 400) return <PostPreviewCard content={content} title={title} />;
    return <PostDraftedCard title={isMultiple ? undefined : title} multiple={isMultiple} />;
  }
  if (msg.name === 'schedule_post') {
    const post = msg.result?.post;
    const scheduledAt = post?.scheduled_at;
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <CheckCircle size={15} className="text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-emerald-800">Post scheduled</p>
            {post?.title && <p className="truncate text-xs text-emerald-700">"{post.title}"</p>}
            {scheduledAt && <p className="text-xs text-emerald-600 mt-0.5">{new Date(scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>}
          </div>
          <a href="/posts" className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700">View</a>
        </div>
      </div>
    );
  }
  // Images and videos made by the chat: shown, with 👍 / 👎 to teach the style.
  if (msg.name.startsWith('magnific_') && msg.result?.url) {
    const url = String(msg.result.url);
    const isVideo = msg.name.includes('video') || msg.name.includes('lip_sync') || /\.(mp4|mov|webm)(\?|$)/i.test(url);
    if (msg.name.includes('audio')) return <audio src={url} controls className="w-full" />;
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {isVideo ? <video src={url} controls className="max-h-72 w-full bg-black object-contain" /> : <img src={url} alt="" className="max-h-72 w-full object-contain bg-slate-50" />}
        {!isVideo && <div className="px-2 py-1"><ImageFeedback compact url={url} about={String(msg.label || '').replace(/…$/, '')} /></div>}
      </div>
    );
  }
  if (msg.name === 'create_poll' || msg.label?.toLowerCase().includes('poll')) {
    return <PollCard title={msg.result?.poll?.title} />;
  }
  return null;
}

// ── Plan card ─────────────────────────────────────────────────────────────────

function PlanCard({
  msg,
  onExecute,
  onCancel,
}: {
  msg: PlanMessage;
  onExecute: (planId: string, agents: PlanAgent[]) => void;
  onCancel: (planId: string) => void;
}) {
  const [agents, setAgents] = useState<PlanAgent[]>(msg.agents);
  const enabledCount = agents.filter((a) => a.enabled).length;
  const isExecuting = msg.status === 'executing';
  const isDone = msg.status === 'done';

  const toggle = (key: string) => {
    if (isExecuting || isDone) return;
    setAgents((prev) => prev.map((a) => (a.key === key ? { ...a, enabled: !a.enabled } : a)));
  };

  return (
    <div className="rounded-xl border border-indigo-100 bg-white overflow-hidden shadow-sm text-xs">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-indigo-50" style={{ background: 'linear-gradient(135deg,#EAF1FF,#EAF1FF)' }}>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-base">✦</div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-indigo-800">Team Analysis</p>
            <p className="text-[10px] text-indigo-500 leading-snug">{msg.summary}</p>
          </div>
        </div>
      </div>

      {/* Agents */}
      <div className="px-3.5 py-3 space-y-2">
        {agents.map((agent) => {
          const status = msg.agentStatuses?.[agent.key];
          const isRunning = status?.running;
          const hasResult = status?.analysis;
          return (
            <div
              key={agent.key}
              className={`flex items-start gap-2.5 rounded-lg border p-2 transition-all ${
                agent.enabled ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-50'
              }`}
            >
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                style={{ background: `${agent.color}18`, color: agent.color }}
              >
                {agent.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold" style={{ color: agent.color }}>{agent.name}</span>
                  {isRunning && (
                    <span className="flex gap-0.5">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="h-1 w-1 rounded-full animate-bounce"
                          style={{ background: agent.color, animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </span>
                  )}
                  {hasResult && !isRunning && <span className="text-emerald-500 text-[10px]">✓</span>}
                </div>
                <p className="text-[10px] text-slate-500 leading-snug">{agent.task}</p>
                {hasResult && (
                  <p className="mt-1 text-[10px] text-slate-700 leading-snug line-clamp-2">{hasResult}</p>
                )}
              </div>
              {!isExecuting && !isDone && (
                <button
                  type="button"
                  onClick={() => toggle(agent.key)}
                  className={`shrink-0 flex h-4 w-7 items-center rounded-full transition-colors ${
                    agent.enabled ? 'bg-indigo-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                      agent.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      {!isDone && (
        <div className="px-3.5 pb-3 flex gap-2">
          {isExecuting ? (
            <div className="flex items-center gap-2 text-[11px] text-indigo-600 font-medium">
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
              Team at work…
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={enabledCount === 0}
                onClick={() => onExecute(msg.id, agents)}
                className="flex-1 rounded-xl bg-indigo-600 py-2 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                Execute Plan
              </button>
              <button
                type="button"
                onClick={() => onCancel(msg.id)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Suggestion cards ──────────────────────────────────────────────────────────

const SUGGESTIONS = [
  { icon: '📢', title: 'Draft a social post', subtitle: 'Engaging content in seconds.', prompt: 'Draft an engaging social media post for my brand' },
  { icon: '🎤', title: 'Transcribe audio', subtitle: 'Voice to structured notes.', prompt: 'Help me transcribe and structure audio notes' },
  { icon: '📊', title: 'Create a poll', subtitle: 'Gather data quickly.', prompt: 'Create a poll to gather feedback from my audience' },
] as const;

// ── Main Widget ───────────────────────────────────────────────────────────────

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  // Every chat session's messages, keyed by session id; the open one is `activeId`.
  // A session keeps running (and updating its own messages) while another is open.
  const [activeId, setActiveId] = useState<string>(() => {
    try { return localStorage.getItem('daky_chat_active') || crypto.randomUUID(); } catch { return crypto.randomUUID(); }
  });
  const [store, setStore] = useState<Record<string, Message[]>>({});
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});
  const [sessionList, setSessionList] = useState<SessionMeta[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const savedRef = useRef<Record<string, string>>({});
  const loadedRef = useRef<Record<string, boolean>>({});

  const setMessagesFor = useCallback((sid: string) => (u: Message[] | ((prev: Message[]) => Message[])) =>
    setStore((st) => ({ ...st, [sid]: typeof u === 'function' ? u(st[sid] ?? []) : u })), []);
  const setLoadingFor = useCallback((sid: string) => (v: boolean) => setRunningIds((r) => ({ ...r, [sid]: v })), []);
  const messages = store[activeId] ?? NO_MESSAGES;
  const setMessages = setMessagesFor(activeId);
  const loading = Boolean(runningIds[activeId]);

  /**
   * What one chat reply's events do to the conversation — the same for the
   * live stream, a reconnect, and a reply resumed after a reload. Replays are
   * safe: cards are matched by id, and "turn_reset" (a reply rebuilt from its
   * saved copy) starts its text and steps over.
   */
  const makeChatHandler = useCallback((setMsgs: (u: (prev: Message[]) => Message[]) => void, assistantId: string) => {
    const activityId = `activity-${assistantId}`;
    const updateActivity = (fn: (a: ActivityMessage) => ActivityMessage) =>
      setMsgs((prev) => prev.map((m) => (m.id === activityId && m.kind === 'activity' ? fn(m) : m)));
    const addStep = (step: string) =>
      updateActivity((a) => (a.steps[a.steps.length - 1] === step ? a : { ...a, steps: [...a.steps, step].slice(-30) }));
    /** A card goes before the reply bubble; text already written stays where it was (with its own id). */
    const insertCard = (card: Message, seq: number) => setMsgs((prev) => {
      if (prev.some((m) => m.id === card.id)) return prev.map((m) => (m.id === card.id ? { ...m, ...card } as Message : m));
      const kept = prev.map((m) => (m.kind === 'text' && m.id === assistantId && m.content ? { ...m, id: `${assistantId}:${seq}` } : m))
        .filter((m) => !(m.kind === 'text' && m.id === assistantId));
      return [...kept, card, { kind: 'text', id: assistantId, role: 'assistant', content: '' } satisfies TextMessage];
    });
    return (ev: any) => {
      const seq = typeof ev?.seq === 'number' ? ev.seq : null;
      if (seq !== null) updateActivity((a) => (seq > (a.seq ?? 0) ? { ...a, seq } : a));
      if (ev?.error && (!ev.type || ev.type === 'error')) throw new TurnError(String(ev.error), ev.retryable !== false);
      if (ev.type === 'turn_reset') {
        setMsgs((prev) => prev
          .filter((m) => !(m.kind === 'text' && m.id.startsWith(`${assistantId}:`)))
          .map((m) => (m.kind === 'text' && m.id === assistantId ? { ...m, content: '' } : m)));
        updateActivity((a) => ({ ...a, steps: ['Picking up where it left off'], thinking: '', seq: 0 }));
      } else if (ev.type === 'status' && ev.text) {
        addStep(String(ev.text));
      } else if (ev.type === 'thinking' && ev.text) {
        updateActivity((a) => ({ ...a, thinking: `${a.thinking ? `${a.thinking}\n\n` : ''}${ev.text}`.slice(-6000) }));
      } else if (ev.type === 'text' && ev.text) {
        setMsgs((prev) => prev.map((m) => (m.id === assistantId && m.kind === 'text' ? { ...m, content: m.content + ev.text } : m)));
      } else if (ev.type === 'text_reset') {
        // The server corrected the reply (e.g. it claimed work no tool did): start the bubble again.
        setMsgs((prev) => prev
          .filter((m) => !(m.kind === 'text' && m.id.startsWith(`${assistantId}:`)))
          .map((m) => (m.id === assistantId && m.kind === 'text' ? { ...m, content: '' } : m)));
      } else if (ev.type === 'estimate') {
        addStep(`Estimated ${ev.credits} credits — waiting for your OK`);
        insertCard({
          kind: 'estimate', id: `estimate-${ev.action_id}`, actionId: String(ev.action_id), label: String(ev.label || 'Paid action'),
          credits: Number(ev.credits) || 0, lines: Array.isArray(ev.lines) ? ev.lines.map(String) : [],
          balance: typeof ev.balance === 'number' ? ev.balance : null, status: 'pending',
          ...(Array.isArray(ev.plan) ? { plan: ev.plan.slice(0, 60), summary: ev.summary ? String(ev.summary) : undefined } : {}),
        } satisfies EstimateMessage, seq ?? Date.now());
      } else if (ev.type === 'tool_start') {
        addStep(String(ev.label || ev.name).replace(/…$/, ''));
        insertCard({ kind: 'tool', id: String(ev.tool_id || `tool-${ev.name}-${Date.now()}`), name: ev.name, label: ev.label, status: 'running' } satisfies ToolMessage, seq ?? Date.now());
      } else if (ev.type === 'tool_done') {
        if (ev.success && POST_TOOLS.has(ev.name)) {
          const made = Array.isArray(ev.result?.posts) ? ev.result.posts.length : 1;
          updateActivity((a) => ({ ...a, postsDone: a.postsDone + made }));
        }
        setMsgs((prev) => {
          const target = ev.tool_id && prev.some((m) => m.id === ev.tool_id)
            ? (m: Message) => m.id === ev.tool_id
            : (m: Message) => m.kind === 'tool' && m.name === ev.name && m.status === 'running';
          let hit = false;
          return prev.map((m) => {
            if (hit || m.kind !== 'tool' || !target(m)) return m;
            hit = true;
            return { ...m, status: ev.success ? 'done' : 'error', result: ev.result, error: ev.error };
          });
        });
      }
    };
  }, []);

  /** What a team plan's events do: agent progress on the plan card, the summary in its bubble. */
  const makePlanHandler = useCallback((setMsgs: (u: (prev: Message[]) => Message[]) => void, planId: string, synthId: string) => {
    const patchPlan = (fn: (p: PlanMessage) => PlanMessage) => setMsgs((prev) => prev.map((m) => (m.id === planId && m.kind === 'plan' ? fn(m) : m)));
    return (ev: any) => {
      if (typeof ev?.seq === 'number') patchPlan((p) => (ev.seq > (p.seq ?? 0) ? { ...p, seq: ev.seq } : p));
      if (ev?.type === 'error' && ev.error) throw new TurnError(String(ev.error), ev.retryable !== false);
      if (ev.type === 'turn_reset') {
        patchPlan((p) => ({ ...p, agentStatuses: {}, seq: 0 }));
        setMsgs((prev) => prev.map((m) => (m.id === synthId && m.kind === 'text' ? { ...m, content: '' } : m)));
      } else if (ev.type === 'agent_start') {
        patchPlan((p) => ({ ...p, agentStatuses: { ...(p.agentStatuses ?? {}), [ev.key]: { running: true, analysis: '' } } }));
      } else if (ev.type === 'agent_done') {
        patchPlan((p) => ({ ...p, agentStatuses: { ...(p.agentStatuses ?? {}), [ev.key]: { running: false, analysis: ev.analysis || '' } } }));
      } else if (ev.type === 'text' && ev.text) {
        setMsgs((prev) => prev.map((m) => (m.id === synthId && m.kind === 'text' ? { ...m, content: m.content + ev.text } : m)));
      } else if (ev.type === 'done') {
        patchPlan((p) => ({ ...p, status: 'done' }));
      }
    };
  }, []);
  const [input, setInput] = useState('');
  const [attachedImages, setAttachedImages] = useState<AttachedImg[]>([]);

  // recording: 'idle' | 'recording' | 'pending'
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'pending'>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 80); }, [open]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  // ── Send ──────────────────────────────────────────────────────────────────

  const send = useCallback(async (textOverride?: string, imgsOverride?: AttachedImg[], base?: Message[], attempt = 0) => {
    const rawText = (textOverride ?? input).trim();
    const imgs = imgsOverride ?? attachedImages;
    // A retry sends from the conversation as it was before the failed turn.
    const prior = base ?? messages;
    // Bound to the session this message was sent in, so switching chats mid-reply is safe.
    const sid = activeId;
    const setMessages = setMessagesFor(sid);
    const setLoading = setLoadingFor(sid);

    // Client-side intercept: if user manually types "schedule it/the post" and there's a draft, show scheduler
    if (/^schedule\b/i.test(rawText) && !imgsOverride) {
      const lastDraft = [...prior].reverse().find(
        (m): m is ToolMessage => m.kind === 'tool' && m.name === 'create_draft' && (m.status === 'done' || m.status === 'error'),
      );
      if (lastDraft) {
        setInput('');
        setAttachedImages([]);
        setMessages((prev) => [
          ...prev,
          { kind: 'text', id: crypto.randomUUID(), role: 'user', content: rawText } satisfies TextMessage,
          { kind: 'scheduler', id: `sched-${Date.now()}`, postTitle: lastDraft.result?.post?.title, submitted: false } satisfies SchedulerMessage,
        ]);
        return;
      }
    }

    // Build the text to show in the user bubble (clean)
    // Build the text to send to API (with image refs if any)
    const apiText = imgs.length
      ? `${rawText}${rawText ? '\n' : ''}[Attached images: ${imgs.map((i) => i.name).join(', ')}]`
      : rawText;

    if (!apiText || loading) return;

    const userMsg: TextMessage = {
      kind: 'text',
      id: crypto.randomUUID(),
      role: 'user',
      content: rawText || `[Attached: ${imgs.map((i) => i.name).join(', ')}]`,
      images: imgs.length > 0 ? imgs : undefined,
      raw: rawText,
    };
    const assistantId = crypto.randomUUID();
    const activityId = `activity-${assistantId}`;
    // The reply runs on the server under this id; the chat can leave and come back to it.
    const turnId = crypto.randomUUID();
    const activity: ActivityMessage = {
      kind: 'activity', id: activityId, status: 'working', steps: ['Understanding your request'], thinking: '',
      startedAt: Date.now(), postsDone: 0, postsTotal: requestedPostCount(rawText), turnId, seq: 0,
    };
    const updateActivity = (fn: (a: ActivityMessage) => ActivityMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === activityId && m.kind === 'activity' ? fn(m) : m)));
    const addStep = (step: string) =>
      updateActivity((a) => (a.steps[a.steps.length - 1] === step ? a : { ...a, steps: [...a.steps, step].slice(-30) }));

    setMessages([...prior, userMsg, activity, { kind: 'text', id: assistantId, role: 'assistant', content: '' }]);
    setSessionList((list) => {
      const meta = { id: sid, title: sessionTitle([...prior, userMsg]), updated_at: new Date().toISOString() };
      return [meta, ...list.filter((x) => x.id !== sid)];
    });
    setInput('');
    setAttachedImages([]);
    setRecordingState('idle');
    setLoading(true);

    const token = localStorage.getItem('auth_token');
    // Build history with image refs included in content
    const history = [...prior, { ...userMsg, content: apiText }]
      .filter((m): m is TextMessage => m.kind === 'text')
      .map(({ role, content }) => ({ role, content }));

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Quick intent check — haiku classifies in ~200ms
      let usePlan = false;
      let planData: any = null;
      try {
        const orchRes = await fetch(`${getApiBaseUrl()}/api/ai/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ messages: history }),
          signal: ctrl.signal,
        });
        if (orchRes.ok) {
          const orchJson = await orchRes.json();
          if (orchJson.type === 'plan' && Array.isArray(orchJson.agents) && orchJson.agents.length >= 2) {
            usePlan = true;
            planData = orchJson;
          }
        }
      } catch { /* proceed direct on any error */ }

      if (usePlan) {
        const planAgents: PlanAgent[] = planData.agents.map((a: any) => ({ ...a, enabled: true }));
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== activityId && !(m.kind === 'text' && m.id === assistantId && m.content === '')),
          { kind: 'plan', id: assistantId, summary: planData.summary || '', agents: planAgents, status: 'pending' } satisfies PlanMessage,
        ]);
        setLoading(false);
        return;
      }

      const body = JSON.stringify({
        messages: history, page: window.location.pathname, turn_id: turnId,
        timezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })(),
      });
      addStep('Connecting to the AI');
      // The reply is written on the server; this only follows it. Leaving the tab, a sleeping
      // phone or a network blip just pauses following — it picks up where it stopped.
      await followServerTurn({
        turnId,
        start: () => fetch(`${getApiBaseUrl()}/api/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body,
          signal: ctrl.signal,
        }),
        onEvent: makeChatHandler(setMessages, assistantId),
        onBanner: (banner) => updateActivity((a) => ({ ...a, banner })),
        signal: ctrl.signal,
      });
      // The reply has been charged by now; the header badge re-reads the balance.
      notifyCreditsChanged();
      updateActivity((a) => ({ ...a, status: 'done', endedAt: Date.now(), banner: undefined }));
    } catch (err: any) {
      if (err?.name === 'AbortError') { updateActivity((a) => (a.status === 'working' ? { ...a, status: 'done', endedAt: Date.now() } : a)); return; }
      updateActivity((a) => ({ ...a, status: 'failed', endedAt: Date.now(), banner: undefined }));
      setMessages((prev) => {
        const failed: TextMessage = { kind: 'text', id: assistantId, role: 'assistant', failed: true, attempt, ...describeFailure(err, attempt) };
        return prev.some((m) => m.id === assistantId)
          ? prev.map((m) => (m.id === assistantId && m.kind === 'text' ? failed : m))
          : [...prev, failed];
      });
    } finally {
      setLoading(false);
      abortRef.current = null;
      // Detect form (3+ questions) in final AI text
      setTimeout(() => {
        setMessages((prev) => {
          const lastA = [...prev].reverse().find(
            (m): m is TextMessage => m.kind === 'text' && m.role === 'assistant' && !!m.content && !m.failed,
          );
          if (!lastA) return prev;
          const formId = `form-${lastA.id}`;
          if (prev.some((m) => m.id === formId)) return prev;
          const parsed = parseFormFromText(lastA.content);
          if (!parsed || parsed.questions.length < 1) return prev;
          // Trim the assistant text to just the intro
          return [
            ...prev.map((m) =>
              m.id === lastA.id && m.kind === 'text'
                ? { ...m, content: parsed.intro }
                : m,
            ),
            {
              kind: 'form',
              id: formId,
              intro: parsed.intro,
              questions: parsed.questions,
              submitted: false,
            } satisfies FormMessage,
          ];
        });
      }, 60);
    }
  }, [input, loading, messages, attachedImages, activeId, setMessagesFor, setLoadingFor, makeChatHandler]);

  /** Sends the user message behind a failed reply again, from the conversation as it was before it. */
  const retry = useCallback((failedId: string) => {
    if (loading) return;
    const idx = messages.findIndex((m) => m.id === failedId);
    let u = idx - 1;
    while (u >= 0 && !(messages[u].kind === 'text' && (messages[u] as TextMessage).role === 'user')) u--;
    if (u < 0) return;
    const original = messages[u] as TextMessage;
    const failed = messages[idx] as TextMessage;
    void send(original.raw ?? original.content, original.images ?? [], messages.slice(0, u), (failed?.attempt ?? 0) + 1);
  }, [loading, messages, send]);

  const stopAutoRetry = useCallback((failedId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === failedId && m.kind === 'text'
      ? { ...m, autoRetryAt: undefined, waitOnline: false, hint: 'Press Retry when you are ready — your message is kept.' } : m)));
  }, [setMessages]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  // ── Execute plan ──────────────────────────────────────────────────────────

  const executePlan = useCallback(async (planId: string, planAgents: PlanAgent[]) => {
    const planMsg = messages.find((m) => m.id === planId) as PlanMessage | undefined;
    if (!planMsg) return;
    const setMessages = setMessagesFor(activeId);
    const setLoading = setLoadingFor(activeId);
    const token = localStorage.getItem('auth_token');
    const history = messages.filter((m): m is TextMessage => m.kind === 'text').map(({ role, content }) => ({ role, content }));
    // The team runs on the server under this id; the chat can leave and come back to it.
    const turnId = crypto.randomUUID();
    const synthId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev.map((m) => m.id === planId && m.kind === 'plan' ? { ...m, status: 'executing' as const, agents: planAgents, turnId, synthId, seq: 0 } : m),
      { kind: 'text', id: synthId, role: 'assistant', content: '' } satisfies TextMessage,
    ]);
    setLoading(true);
    followingRef.current.add(turnId);

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      await followServerTurn({
        turnId,
        start: () => fetch(`${getApiBaseUrl()}/api/ai/execute-plan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ messages: history, plan: { summary: planMsg.summary, agents: planAgents }, turn_id: turnId }),
          signal: ctrl.signal,
        }),
        onEvent: makePlanHandler(setMessages, planId, synthId),
        onBanner: () => undefined,
        signal: ctrl.signal,
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages((prev) => prev.map((m) => m.id === synthId && m.kind === 'text' ? { ...m, content: m.content || err?.message || 'Plan execution failed.' } : m));
      }
    } finally {
      setMessages((prev) => prev.map((m) => (m.id === planId && m.kind === 'plan' && m.status === 'executing' ? { ...m, status: 'done' } : m)));
      followingRef.current.delete(turnId);
      setLoading(false);
      abortRef.current = null;
    }
  }, [messages, activeId, setMessagesFor, setLoadingFor, makePlanHandler]);

  const cancelPlan = useCallback((planId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== planId));
  }, [setMessages]);

  // ── Credit estimates: Proceed runs the parked action, Cancel drops it ───────

  /**
   * Runs (or resumes, or just follows) a paid action and keeps its cards up to
   * date. The job lives on the server: if the stream drops, this says so,
   * reconnects by polling, and picks up the progress — it never leaves the
   * card silent.
   */
  const driveAction = useCallback(async (sid: string, actionId: string, mode: 'run' | 'resume' | 'follow') => {
    const setMessages = setMessagesFor(sid);
    const setLoading = setLoadingFor(sid);
    const estimateId = `estimate-${actionId}`;
    const batchId = `batch-${actionId}`;
    const patchEstimate = (patch: Partial<EstimateMessage>) =>
      setMessages((prev) => prev.map((m) => (m.id === estimateId && m.kind === 'estimate' ? { ...m, ...patch } : m)));
    const patchBatch = (fn: (b: BatchMessage) => BatchMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === batchId && m.kind === 'batch' ? fn(m) : m)));
    const setBanner = (banner?: string) => { patchEstimate({ banner }); patchBatch((b) => ({ ...b, banner })); };
    const applySnapshot = (snap: any) => {
      if (!snap) return;
      if (snap.kind === 'batch') {
        const batch: BatchMessage = {
          kind: 'batch', id: batchId, total: Number(snap.total) || 0, items: Array.isArray(snap.items) ? snap.items : [],
          creditsUsed: Number(snap.credits) || 0, status: snap.finished ? 'done' : 'running', stopped: snap.stopped,
        };
        setMessages((prev) => (prev.some((m) => m.id === batchId)
          ? prev.map((m) => (m.id === batchId && m.kind === 'batch' ? { ...batch, banner: m.banner } : m))
          : [...prev, batch]));
      } else if (snap.kind === 'tool' && snap.finished) {
        const toolId = `tool-${actionId}`;
        const tool: ToolMessage = { kind: 'tool', id: toolId, name: snap.tool, label: '', status: snap.success ? 'done' : 'error', result: snap.result, error: snap.error };
        setMessages((prev) => (prev.some((m) => m.id === toolId) ? prev.map((m) => (m.id === toolId ? tool : m)) : [...prev.filter((m) => !(m.kind === 'tool' && m.name === snap.tool && m.status === 'running')), tool]));
      }
    };
    const handle = (ev: any) => {
      if (ev.type === 'batch_snapshot' || ev.type === 'batch_done') {
        applySnapshot(ev.snapshot);
        if (ev.type === 'batch_done') notifyCreditsChanged();
      } else if (ev.type === 'batch_item') {
        setMessages((prev) => (prev.some((m) => m.id === batchId) ? prev : [...prev, { kind: 'batch', id: batchId, total: 0, items: [], creditsUsed: 0, status: 'running' } satisfies BatchMessage]));
        patchBatch((b) => {
          const items = [...b.items];
          const prev = items[ev.index];
          items[ev.index] = {
            ...prev, index: ev.index, topic: ev.topic ?? prev?.topic ?? '', status: ev.status,
            platform: ev.platform ?? prev?.platform, format: ev.format ?? prev?.format,
            progress: ev.progress, post: ev.post ?? prev?.post, error: ev.error, note: ev.note,
          };
          return { ...b, total: Math.max(b.total, items.length), items, creditsUsed: b.creditsUsed + (Number(ev.credits_used) || 0) };
        });
        // Each post is charged as it is saved: the header balance follows along.
        if (ev.status === 'done') notifyCreditsChanged();
      } else if (ev.type === 'tool_start') {
        setMessages((prev) => (prev.some((m) => m.id === `tool-${actionId}`) ? prev
          : [...prev, { kind: 'tool', id: `tool-${actionId}`, name: ev.name, label: ev.label, status: 'running' } satisfies ToolMessage]));
      } else if (ev.type === 'tool_done') {
        applySnapshot({ kind: 'tool', tool: ev.name, success: ev.success, result: ev.result, error: ev.error, finished: true });
      } else if (ev.type === 'job_error') {
        patchEstimate({ status: 'failed', error: ev.error });
      } else if (ev.type === 'credits_changed') {
        notifyCreditsChanged();
      }
    };
    /** Reads where the action stands and sets the final card states. True when it is over. */
    const settle = async (): Promise<boolean> => {
      const r = await fetch(`${getApiBaseUrl()}/api/ai/chat/actions/${encodeURIComponent(actionId)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` } });
      if (!r.ok) throw new TypeError('status check failed');
      const a = (await r.json())?.action;
      if (!a) return true;
      applySnapshot(a.snapshot);
      if (a.status === 'pending') { patchEstimate({ status: 'pending', banner: undefined }); return true; }
      if (a.status === 'cancelled') { patchEstimate({ status: 'cancelled', banner: undefined }); return true; }
      if (a.status === 'interrupted') { setBanner(undefined); patchEstimate({ status: 'interrupted' }); patchBatch((b) => ({ ...b, status: 'done' })); return true; }
      if (a.status === 'done') { setBanner(undefined); patchEstimate({ status: 'done' }); return true; }
      if (a.status === 'failed') {
        setBanner(undefined);
        const snap = a.snapshot;
        patchEstimate({ status: 'failed', error: snap?.kind === 'tool' ? snap.error : snap?.stopped || 'None of it could be finished — nothing was charged.' });
        return true;
      }
      patchEstimate({ status: 'running' });
      return false;
    };

    setLoading(true);
    patchEstimate({ status: 'running', error: undefined, needsCredits: false, banner: mode === 'follow' ? 'Checking progress…' : undefined });
    if (mode === 'resume') patchBatch((b) => ({ ...b, status: 'running', stopped: undefined }));
    let follow = mode === 'follow';
    try {
      if (!follow) {
        try {
          const res = await fetch(`${getApiBaseUrl()}/api/ai/chat/actions/${encodeURIComponent(actionId)}/${mode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
            // Making something again always follows the user's own "Yes" on the quote.
            body: JSON.stringify(mode === 'resume' ? { confirm: true } : {}),
          });
          if (res.status === 402) {
            const d = await res.json().catch(() => ({}));
            patchEstimate({ status: mode === 'run' ? 'pending' : 'failed', needsCredits: true, error: d?.error, balance: typeof d?.balance === 'number' ? d.balance : null });
            if (mode === 'resume') patchBatch((b) => ({ ...b, status: 'done', stopped: d?.error }));
            return;
          }
          if (res.status === 409) {
            follow = true;
          } else if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            const e: any = new Error(d?.error || 'Could not start this');
            e.status = res.status;
            throw e;
          } else {
            await readEventStream(res, handle);
          }
        } catch (err: any) {
          // Only a lost connection is followed up; anything else is a real failure.
          if (err?.status || !(err instanceof TypeError || /network|fetch|load failed|dropped/i.test(String(err?.message)))) throw err;
        }
      }
      // Settle from the server's record; poll while it is still running.
      for (let tries = 0; ; tries++) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          setBanner("You're offline. The work carries on on the server — I'll catch up when you're back online.");
          await new Promise<void>((resolve) => window.addEventListener('online', () => resolve(), { once: true }));
        }
        try {
          if (await settle()) break;
          setBanner(tries === 0 && !follow ? undefined : 'Connection dropped — still working on the server. Following along…');
        } catch {
          setBanner('Connection dropped — the work continues on the server. Reconnecting…');
        }
        await new Promise((r) => setTimeout(r, Math.min(3000 + tries * 500, 8000)));
      }
    } catch (err: any) {
      setBanner(undefined);
      patchEstimate({ status: 'failed', error: err?.message || 'This could not be started — nothing was charged.' });
      patchBatch((b) => ({ ...b, status: 'done' }));
    } finally {
      setLoading(false);
      notifyCreditsChanged();
    }
  }, [setMessagesFor, setLoadingFor]);

  const runAction = useCallback((estimateId: string, mode: 'run' | 'resume' = 'run') => {
    const est = messages.find((m): m is EstimateMessage => m.id === estimateId && m.kind === 'estimate');
    if (!est || loading) return;
    if (mode === 'resume') setMessages((prev) => prev.map((m) => (m.id === estimateId && m.kind === 'estimate' ? { ...m, regenQuote: undefined } : m)));
    void driveAction(activeId, est.actionId, mode);
  }, [messages, loading, activeId, driveAction, setMessages]);

  /**
   * "Try again" / "Finish the rest" / "Write the rest": the server prices what
   * is left first; the user sees the credits and confirms before anything runs.
   */
  const askResume = useCallback(async (estimateId: string) => {
    const est = messages.find((m): m is EstimateMessage => m.id === estimateId && m.kind === 'estimate');
    if (!est || loading) return;
    const sid = activeId;
    const patch = (p: Partial<EstimateMessage>) => setMessagesFor(sid)((prev) => prev.map((m) => (m.id === estimateId && m.kind === 'estimate' ? { ...m, ...p } : m)));
    patch({ quoting: true, regenQuote: undefined });
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/ai/chat/actions/${encodeURIComponent(est.actionId)}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify({}),
      });
      const d = await r.json().catch(() => ({} as any));
      if (r.ok && d?.running) { patch({ quoting: false }); void driveAction(sid, est.actionId, 'follow'); return; }
      if (r.ok && d?.needs_confirmation) {
        patch({ quoting: false, regenQuote: { credits: Number(d.credits) || 0, label: String(d.label || 'Make it again'), lines: Array.isArray(d.lines) ? d.lines.map(String) : [], balance: typeof d.balance === 'number' ? d.balance : null } });
        return;
      }
      patch({ quoting: false, error: d?.error || 'This cannot be made again right now.' });
    } catch {
      patch({ quoting: false, error: 'Could not check the cost — please try again.' });
    }
  }, [messages, loading, activeId, setMessagesFor, driveAction]);

  const dismissResume = useCallback((estimateId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === estimateId && m.kind === 'estimate' ? { ...m, regenQuote: undefined } : m)));
  }, [setMessages]);

  const cancelAction = useCallback((estimateId: string) => {
    const est = messages.find((m): m is EstimateMessage => m.id === estimateId && m.kind === 'estimate');
    if (!est || est.status !== 'pending') return;
    setMessages((prev) => prev.map((m) => (m.id === estimateId && m.kind === 'estimate' ? { ...m, status: 'cancelled' } : m)));
    void fetch(`${getApiBaseUrl()}/api/ai/chat/actions/${encodeURIComponent(est.actionId)}/cancel`, {
      method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
    }).catch(() => undefined);
  }, [messages, setMessages]);

  // ── Sessions: history list, open, new, delete, autosave ──────────────────

  const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` });

  /** Follows again the replies (and team plans) of a reopened chat that were still running. */
  const followingRef = useRef<Set<string>>(new Set());
  const resumeTurns = useCallback((sid: string, msgs: Message[]) => {
    const setMsgs = setMessagesFor(sid);
    for (const m of msgs) {
      if (m.kind === 'activity' && m.status === 'working' && m.turnId && !followingRef.current.has(m.turnId)) {
        const turnId = m.turnId;
        const assistantId = m.id.slice('activity-'.length);
        followingRef.current.add(turnId);
        const setLoading = setLoadingFor(sid);
        const updateActivity = (fn: (a: ActivityMessage) => ActivityMessage) =>
          setMsgs((prev) => prev.map((x) => (x.id === m.id && x.kind === 'activity' ? fn(x) : x)));
        setLoading(true);
        updateActivity((a) => ({ ...a, banner: 'Picking up your reply…' }));
        void followServerTurn({
          turnId,
          after: m.seq ?? 0,
          onEvent: makeChatHandler(setMsgs, assistantId),
          onBanner: (banner) => updateActivity((a) => ({ ...a, banner })),
        })
          .then(() => { notifyCreditsChanged(); updateActivity((a) => ({ ...a, status: 'done', endedAt: Date.now(), banner: undefined })); })
          .catch((err) => {
            updateActivity((a) => ({ ...a, status: 'failed', endedAt: Date.now(), banner: undefined }));
            setMsgs((prev) => {
              const failed: TextMessage = { kind: 'text', id: assistantId, role: 'assistant', failed: true, attempt: 1, ...describeFailure(err, 1) };
              return prev.some((x) => x.id === assistantId) ? prev.map((x) => (x.id === assistantId && x.kind === 'text' ? failed : x)) : [...prev, failed];
            });
          })
          .finally(() => { followingRef.current.delete(turnId); setLoading(false); });
      }
      if (m.kind === 'plan' && m.status === 'executing' && m.turnId && m.synthId && !followingRef.current.has(m.turnId)) {
        const turnId = m.turnId;
        followingRef.current.add(turnId);
        const setLoading = setLoadingFor(sid);
        setLoading(true);
        void followServerTurn({ turnId, after: m.seq ?? 0, onEvent: makePlanHandler(setMsgs, m.id, m.synthId), onBanner: () => undefined })
          .catch((err) => setMsgs((prev) => prev.map((x) => (x.id === m.synthId && x.kind === 'text' ? { ...x, content: x.content || err?.message || 'The team could not finish.' } : x))))
          .finally(() => {
            setMsgs((prev) => prev.map((x) => (x.id === m.id && x.kind === 'plan' ? { ...x, status: 'done' } : x)));
            followingRef.current.delete(turnId);
            setLoading(false);
          });
      }
    }
  }, [setMessagesFor, setLoadingFor, makeChatHandler]);

  const openSession = useCallback(async (sid: string) => {
    setActiveId(sid);
    setShowHistory(false);
    if (store[sid] || loadedRef.current[sid]) return;
    loadedRef.current[sid] = true;
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/ai/chat/sessions/${encodeURIComponent(sid)}`, { headers: authHeaders() });
      if (!r.ok) return;
      const data = await r.json();
      const msgs: Message[] = Array.isArray(data?.session?.messages) ? data.session.messages : [];
      savedRef.current[sid] = JSON.stringify(msgs);
      setStore((st) => (st[sid] ? st : { ...st, [sid]: msgs }));
      // Paid work that was running (or never confirmed) when this chat was last
      // open: ask the server where it stands, and keep following it if it runs.
      for (const m of msgs) {
        if (m.kind === 'estimate' && (m.status === 'running' || m.status === 'pending')) void driveAction(sid, m.actionId, 'follow');
      }
      // Replies still being written when the chat was closed carry on from where they were.
      resumeTurns(sid, msgs);
    } catch { loadedRef.current[sid] = false; }
  }, [store, driveAction, resumeTurns]);

  const newChat = useCallback(() => {
    setActiveId(crypto.randomUUID());
    setShowHistory(false);
    setInput('');
    setAttachedImages([]);
  }, []);

  const deleteSession = useCallback((sid: string) => {
    setSessionList((list) => list.filter((x) => x.id !== sid));
    setStore((st) => { const next = { ...st }; delete next[sid]; return next; });
    if (sid === activeId) setActiveId(crypto.randomUUID());
    void fetch(`${getApiBaseUrl()}/api/ai/chat/sessions/${encodeURIComponent(sid)}`, { method: 'DELETE', headers: authHeaders() }).catch(() => undefined);
  }, [activeId]);

  useEffect(() => { try { localStorage.setItem('daky_chat_active', activeId); } catch { /* private mode */ } }, [activeId]);

  // The history list loads once the chat is first opened; the last open chat is reopened.
  const listLoaded = useRef(false);
  useEffect(() => {
    if (!open || listLoaded.current) return;
    listLoaded.current = true;
    void openSession(activeId);
    fetch(`${getApiBaseUrl()}/api/ai/chat/sessions`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.sessions)) setSessionList((cur) => [...cur, ...d.sessions.filter((x: SessionMeta) => !cur.some((c) => c.id === x.id))]); })
      .catch(() => undefined);
  }, [open, activeId, openSession]);

  // Autosave: a session is saved shortly after it changes. Mid-reply it is saved every few
  // seconds as well, so a reply that runs on after the browser closes is found again.
  const saveSession = useCallback((sid: string, msgs: Message[]) => {
    if (!msgs.length) return;
    const json = JSON.stringify(msgs);
    if (savedRef.current[sid] === json) return;
    savedRef.current[sid] = json;
    const body = JSON.stringify({ title: sessionTitle(msgs), messages: msgs });
    void fetch(`${getApiBaseUrl()}/api/ai/chat/sessions/${encodeURIComponent(sid)}`, {
      // keepalive lets a save started as the page closes finish (browsers allow it under 64 KB).
      method: 'PUT', headers: authHeaders(), body, keepalive: body.length < 60_000,
    }).catch(() => { delete savedRef.current[sid]; });
  }, []);
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => {
    const t = setTimeout(() => {
      for (const [sid, msgs] of Object.entries(store)) if (!runningIds[sid]) saveSession(sid, msgs);
    }, 800);
    return () => clearTimeout(t);
  }, [store, runningIds, saveSession]);
  useEffect(() => {
    const running = Object.entries(runningIds).filter(([, on]) => on).map(([sid]) => sid);
    if (!running.length) return;
    const save = () => { for (const sid of running) saveSession(sid, storeRef.current[sid] ?? []); };
    const iv = setInterval(save, 4000);
    // Leaving the page: save what there is now (the reply goes on on the server).
    const onHide = () => { if (document.visibilityState === 'hidden') save(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', save);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', save); };
  }, [runningIds, saveSession]);

  // ── Form submit ───────────────────────────────────────────────────────────

  const submitForm = (formId: string, formatted: string) => {
    const isSchedule = /schedule it/i.test(formatted);
    if (isSchedule) {
      setMessages((prev) => {
        const lastDraft = [...prev].reverse().find(
          (m): m is ToolMessage => m.kind === 'tool' && m.name === 'create_draft' && m.status === 'done',
        );
        return [
          ...prev.map((m) => m.id === formId && m.kind === 'form' ? { ...m, submitted: true } : m),
          {
            kind: 'scheduler',
            id: `sched-${Date.now()}`,
            postTitle: lastDraft?.result?.post?.title,
            submitted: false,
          } satisfies SchedulerMessage,
        ];
      });
      return;
    }
    setMessages((prev) =>
      prev.map((m) => m.id === formId && m.kind === 'form' ? { ...m, submitted: true } : m),
    );
    void send(formatted);
  };

  // ── Audio recording ───────────────────────────────────────────────────────

  const startRecording = () => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Speech recognition is not supported in this browser.'); return; }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    let finalT = '';
    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalT += t; else interim += t;
      }
      setInput((finalT + interim).trim());
    };
    recognition.onend = () => stopRecording();
    recognition.onerror = () => stopRecording();
    recognitionRef.current = recognition;
    recognition.start();
    setRecordingState('recording');
    setRecordingSeconds(0);
    timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecordingSeconds(0);
    setRecordingState('pending');
  };

  const cancelVoice = () => { setInput(''); setRecordingState('idle'); };
  const sendVoice = () => {
    const t = input.trim();
    const imgs = [...attachedImages];
    if (t || imgs.length) void send(t || undefined, imgs);
    else setRecordingState('idle');
  };

  const fmtTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // ── File attach ───────────────────────────────────────────────────────────

  const onFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? [])) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => setAttachedImages((p) => [...p, { id: crypto.randomUUID(), name: file.name, dataUrl: ev.target?.result as string }]);
        reader.readAsDataURL(file);
      } else {
        setInput((p) => p ? `${p} [File: ${file.name}]` : `[File: ${file.name}]`);
      }
    }
    e.target.value = '';
  };

  const hasMessages = messages.length > 0;

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        data-tour-id="chat-widget-button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center rounded-[14px] bg-navy text-white shadow-menu transition-all hover:bg-blue focus:outline-none"
        style={{ width: 48, height: 48 }}
        aria-label="Open Daky AI assistant"
      >
        <Sparkles size={20} className="text-white" />
        {!open && Object.values(runningIds).some(Boolean) && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow" aria-label="Daky is working">
            <Loader2 size={11} className="animate-spin text-indigo-600" />
          </span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-[4.5rem] right-5 z-50 flex flex-col overflow-hidden rounded-[16px] border border-line bg-white shadow-menu"
          style={{ width: 340, height: 500, maxWidth: 'calc(100vw - 1.25rem)' }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3.5 py-2.5">
            <SparkleAvatar size={26} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-ink leading-none">Daky</div>
              <div className="flex items-center gap-1 text-[10px] font-mono text-muted mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-positive" /> ACTIVE
              </div>
            </div>
            <button type="button" onClick={() => { setShowStyle((v) => !v); setShowInstructions(false); setShowHistory(false); }} title="Teach your image style"
              className={`flex h-6 w-6 items-center justify-center rounded-md hover:bg-soft hover:text-ink ${showStyle ? 'bg-soft text-ink' : 'text-faint'}`} aria-label="Image style">
              <Palette size={13} />
            </button>
            <button type="button" onClick={() => { setShowInstructions((v) => !v); setShowHistory(false); setShowStyle(false); }} title="Custom instructions"
              className={`flex h-6 w-6 items-center justify-center rounded-md hover:bg-soft hover:text-ink ${showInstructions ? 'bg-soft text-ink' : 'text-faint'}`} aria-label="Custom instructions">
              <SlidersHorizontal size={13} />
            </button>
            <button type="button" onClick={() => { setShowHistory((v) => !v); setShowInstructions(false); setShowStyle(false); }} title="Chat history"
              className={`relative flex h-6 w-6 items-center justify-center rounded-md hover:bg-soft hover:text-ink ${showHistory ? 'bg-soft text-ink' : 'text-faint'}`} aria-label="Chat history">
              <History size={13} />
              {Object.entries(runningIds).some(([id, on]) => on && id !== activeId) && (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
              )}
            </button>
            <button type="button" onClick={newChat} title="New chat" className="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-soft hover:text-ink" aria-label="New chat">
              <Plus size={13} />
            </button>
            <button type="button" onClick={() => setOpen(false)} className="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-soft hover:text-ink" aria-label="Close">
              <X size={13} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {showStyle ? (
              <StylePanel onDone={() => setShowStyle(false)} />
            ) : showInstructions ? (
              <CustomInstructionsPanel onDone={() => setShowInstructions(false)} />
            ) : showHistory ? (
              <div className="px-2 py-2">
                <button type="button" onClick={newChat}
                  className="mb-2 flex w-full items-center gap-2 rounded-[10px] border border-dashed border-line px-3 py-2 text-xs font-medium text-ink hover:border-blue hover:bg-pale/50">
                  <Plus size={13} /> New chat
                </button>
                {(() => {
                  const list = [...sessionList];
                  if (store[activeId]?.length && !list.some((x) => x.id === activeId)) list.unshift({ id: activeId, title: sessionTitle(store[activeId]), updated_at: new Date().toISOString() });
                  if (!list.length) return <p className="px-2 py-6 text-center text-xs text-muted">No chats yet.</p>;
                  return (
                    <ul className="space-y-0.5">
                      {list.map((x) => {
                        const running = Boolean(runningIds[x.id]);
                        return (
                          <li key={x.id} className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${x.id === activeId ? 'bg-pale' : 'hover:bg-soft'}`}>
                            <button type="button" onClick={() => void openSession(x.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                              {running
                                ? <Loader2 size={12} className="shrink-0 animate-spin text-indigo-500" aria-label="Working" />
                                : <span className="h-3 w-3 shrink-0" />}
                              <span className="min-w-0 flex-1 truncate text-xs text-ink">{x.title}</span>
                              <span className="shrink-0 text-[10px] text-faint">{running ? 'working' : relativeTime(x.updated_at)}</span>
                            </button>
                            {!running && (
                              <button type="button" onClick={() => deleteSession(x.id)} aria-label="Delete chat"
                                className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-faint hover:text-red-500 group-hover:flex">
                                <Trash2 size={11} />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
              </div>
            ) : !hasMessages ? (
              <div className="flex flex-col items-center px-4 pt-5 pb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-pale mb-3">
                  <Sparkles size={18} className="text-blue" />
                </div>
                <h2 className="text-base font-medium text-ink mb-1">How can I help?</h2>
                <p className="text-center text-xs text-muted leading-relaxed mb-4">I'm Daky, your AI companion for writing, content, and brainstorming.</p>
                <div className="w-full space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s.title} type="button"
                      onClick={() => { setInput(s.prompt); inputRef.current?.focus(); }}
                      className="flex w-full items-center gap-2.5 rounded-[10px] border border-line bg-soft px-3 py-2 text-left hover:border-blue hover:bg-pale/50 transition-colors">
                      <span className="text-base shrink-0">{s.icon}</span>
                      <div className="min-w-0">
                        <p className="text-[11.5px] font-medium text-ink">{s.title}</p>
                        <p className="text-[10.5px] text-muted">{s.subtitle}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-3 py-2.5 space-y-2">
                {messages.map((msg) => (
                  <div key={msg.id}>
                    {msg.kind === 'activity' ? (
                      <div className="pl-8"><ActivityCard msg={msg} /></div>
                    ) : msg.kind === 'estimate' ? (
                      <div className="pl-8">
                        <EstimateCard msg={msg} busy={loading} onProceed={() => runAction(msg.id)} onCancel={() => cancelAction(msg.id)}
                          onResume={() => void askResume(msg.id)} onConfirmResume={() => runAction(msg.id, 'resume')} onDismissResume={() => dismissResume(msg.id)} />
                      </div>
                    ) : msg.kind === 'batch' ? (
                      <div className="pl-8">{(() => {
                        const estimateId = `estimate-${msg.id.slice('batch-'.length)}`;
                        const est = messages.find((m): m is EstimateMessage => m.id === estimateId && m.kind === 'estimate');
                        return (
                          <BatchCard msg={msg} busy={loading} quote={est?.regenQuote} quoting={est?.quoting}
                            onResume={() => void askResume(estimateId)} onConfirmResume={() => runAction(estimateId, 'resume')} onDismissResume={() => dismissResume(estimateId)} />
                        );
                      })()}</div>
                    ) : msg.kind === 'tool' ? (
                      <div className="pl-8"><ToolCard msg={msg} /></div>
                    ) : msg.kind === 'form' ? (
                      <div className="pl-8">
                        <FormCard msg={msg} onSubmit={(f) => submitForm(msg.id, f)} />
                      </div>
                    ) : msg.kind === 'scheduler' ? (
                      <div className="pl-8">
                        <SchedulerCard
                          msg={msg}
                          onSchedule={(iso, label) => {
                            setMessages((prev) =>
                              prev.map((m) => m.id === msg.id ? { ...m, submitted: true } : m),
                            );
                            void send(`Schedule for ${iso} (${label})`);
                          }}
                        />
                      </div>
                    ) : msg.kind === 'plan' ? (
                      <div className="pl-8">
                        <PlanCard
                          msg={msg}
                          onExecute={(planId, agents) => void executePlan(planId, agents)}
                          onCancel={cancelPlan}
                        />
                      </div>
                    ) : msg.role === 'assistant' && msg.failed ? (
                      <FailedReply msg={msg} busy={loading} onRetry={() => retry(msg.id)} onStopAuto={() => stopAutoRetry(msg.id)} />
                    ) : msg.role === 'assistant' && !msg.content && messages.some((m) => m.kind === 'activity' && m.id === `activity-${msg.id}`) ? null : (
                      <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-1.5`}>
                        {msg.role === 'assistant' && <SparkleAvatar size={22} />}
                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                          msg.role === 'user' ? 'rounded-br-sm bg-indigo-600 text-white' : 'rounded-bl-sm bg-slate-100 text-slate-800'
                        }`}>
                          {msg.role === 'user' && msg.images && msg.images.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1.5">
                              {msg.images.map((img) => (
                                <div key={img.id} className="group/thumb relative">
                                  <img src={img.dataUrl} alt={img.name} className="h-12 w-12 rounded-lg object-cover border border-white/30" />
                                  <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-1.5 hidden group-hover/thumb:block">
                                    <img src={img.dataUrl} alt={img.name} className="max-h-40 max-w-48 rounded-xl border border-slate-200 shadow-2xl object-contain bg-white p-1" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {msg.content
                            ? renderText(msg.content)
                            : <span className="inline-block h-3 w-7 animate-pulse rounded bg-slate-300" />}
                        </div>
                      </div>
                    )}
                    {msg.kind === 'text' && msg.role === 'assistant' && !msg.failed && msg.content && !(loading && msg.id === messages[messages.length - 1]?.id) && (
                      <div className="pl-8 pt-0.5"><FeedbackButtons subject="reply" about={msg.content} refId={msg.id} /></div>
                    )}
                  </div>
                ))}

                {loading && messages.length > 0 &&
                  !messages.some((m) => m.kind === 'activity' && m.status === 'working') &&
                  messages[messages.length - 1]?.kind === 'text' &&
                  (messages[messages.length - 1] as TextMessage).content === '' && (
                    <div className="flex items-start gap-1.5">
                      <SparkleAvatar size={22} />
                      <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2">
                        <span className="flex gap-1 items-center">
                          {[0, 1, 2].map((i) => (<span key={i} className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />))}
                        </span>
                      </div>
                    </div>
                  )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="shrink-0 border-t border-slate-100 px-2.5 py-2">
            {recordingState === 'recording' ? (
              <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-2">
                <WaveformBars />
                <span className="flex-1 text-[11px] font-semibold text-indigo-600 tabular-nums">{fmtTime(recordingSeconds)}</span>
                <button type="button" onClick={stopRecording}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white" aria-label="Stop recording">
                  <MicOff size={11} />
                </button>
              </div>
            ) : recordingState === 'pending' ? (
              <div className="space-y-1.5">
                {attachedImages.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {attachedImages.map((img) => (
                      <div key={img.id} className="group/att relative">
                        <img src={img.dataUrl} alt={img.name} className="h-8 w-8 rounded-lg object-cover border border-indigo-200" />
                        <button type="button" onClick={() => setAttachedImages((p) => p.filter((x) => x.id !== img.id))}
                          className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-800 text-white text-[8px] opacity-0 group-hover/att:opacity-100 transition-opacity">×</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5">
                  <Mic size={11} className="text-indigo-500 shrink-0" />
                  <p className="flex-1 text-[11px] text-indigo-800 leading-snug line-clamp-2">{input || '(no transcript)'}</p>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={cancelVoice}
                    className="flex-1 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                    Cancel
                  </button>
                  <button type="button" onClick={sendVoice} disabled={!input.trim() && attachedImages.length === 0}
                    className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-indigo-600 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                    <Send size={10} /> Send
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {attachedImages.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {attachedImages.map((img) => (
                      <div key={img.id} className="group/chip relative">
                        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                          <img src={img.dataUrl} alt={img.name} className="h-8 w-8 object-cover" />
                          <button type="button"
                            onClick={() => setAttachedImages((p) => p.filter((x) => x.id !== img.id))}
                            className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-900 text-white text-[8px] opacity-0 group-hover/chip:opacity-100 transition-opacity">×</button>
                        </div>
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 group-hover/chip:block">
                          <img src={img.dataUrl} alt={img.name} className="max-h-36 max-w-48 rounded-xl border border-slate-200 shadow-xl object-contain bg-white p-1" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-1">
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Attach file">
                    <Paperclip size={13} />
                  </button>
                  <input ref={fileInputRef} type="file" className="hidden" multiple accept="image/*,*" onChange={onFileAttach} />
                  <textarea ref={inputRef} rows={1} value={input}
                    onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
                    disabled={loading} placeholder="Ask Daky anything..."
                    className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 disabled:opacity-50"
                    style={{ maxHeight: 72, overflowY: 'auto' }} />
                  <button type="button" onClick={startRecording}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-500" aria-label="Voice input">
                    <Mic size={13} />
                  </button>
                  <button type="button" onClick={() => void send()} disabled={(!input.trim() && attachedImages.length === 0) || loading}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
                    aria-label="Send message">
                    <Send size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
