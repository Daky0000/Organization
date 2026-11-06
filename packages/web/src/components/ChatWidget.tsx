import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart2,
  Calendar,
  CheckCircle,
  Clock,
  Edit2,
  ExternalLink,
  Mic,
  MicOff,
  Paperclip,
  Send,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiBase';

// ── Types ────────────────────────────────────────────────────────────────────

type AttachedImg = { id: string; name: string; dataUrl: string };

type TextMessage = {
  kind: 'text';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: AttachedImg[];
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
};
type Message = TextMessage | ToolMessage | FormMessage | SchedulerMessage | PlanMessage;

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
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

  const send = useCallback(async (textOverride?: string, imgsOverride?: AttachedImg[]) => {
    const rawText = (textOverride ?? input).trim();
    const imgs = imgsOverride ?? attachedImages;

    // Client-side intercept: if user manually types "schedule it/the post" and there's a draft, show scheduler
    if (/^schedule\b/i.test(rawText) && !imgsOverride) {
      const lastDraft = [...messages].reverse().find(
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
    };
    const assistantId = crypto.randomUUID();

    setMessages((prev) => [...prev, userMsg, { kind: 'text', id: assistantId, role: 'assistant', content: '' }]);
    setInput('');
    setAttachedImages([]);
    setRecordingState('idle');
    setLoading(true);

    const token = localStorage.getItem('auth_token');
    // Build history with image refs included in content
    const history = [...messages, { ...userMsg, content: apiText }]
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
          ...prev.filter((m) => !(m.kind === 'text' && m.id === assistantId && m.content === '')),
          { kind: 'plan', id: assistantId, summary: planData.summary || '', agents: planAgents, status: 'pending' } satisfies PlanMessage,
        ]);
        setLoading(false);
        return;
      }

      const res = await fetch(`${getApiBaseUrl()}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: history, page: window.location.pathname }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any)?.error || 'Request failed');
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const ev = JSON.parse(payload) as any;
            if (ev.error) throw new Error(ev.error);
            if (ev.type === 'text' && ev.text) {
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId && m.kind === 'text' ? { ...m, content: m.content + ev.text } : m),
              );
            } else if (ev.type === 'tool_start') {
              const toolId = `tool-${ev.name}-${Date.now()}`;
              setMessages((prev) => [
                ...prev.filter((m) => !(m.kind === 'text' && m.id === assistantId && m.content === '')),
                { kind: 'tool', id: toolId, name: ev.name, label: ev.label, status: 'running' },
                { kind: 'text', id: assistantId, role: 'assistant', content: '' },
              ]);
            } else if (ev.type === 'tool_done') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.kind === 'tool' && m.name === ev.name && m.status === 'running'
                    ? { ...m, status: ev.success ? 'done' : 'error', result: ev.result, error: ev.error }
                    : m,
                ),
              );
            }
          } catch (parseErr: any) {
            if (parseErr?.name !== 'SyntaxError') throw parseErr;
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.kind === 'text' ? { ...m, content: err?.message || 'Something went wrong.' } : m,
        ),
      );
    } finally {
      setLoading(false);
      abortRef.current = null;
      // Detect form (3+ questions) in final AI text
      setTimeout(() => {
        setMessages((prev) => {
          const lastA = [...prev].reverse().find(
            (m): m is TextMessage => m.kind === 'text' && m.role === 'assistant' && !!m.content,
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
  }, [input, loading, messages, attachedImages]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  // ── Execute plan ──────────────────────────────────────────────────────────

  const executePlan = useCallback(async (planId: string, planAgents: PlanAgent[]) => {
    const planMsg = messages.find((m) => m.id === planId) as PlanMessage | undefined;
    if (!planMsg) return;
    const token = localStorage.getItem('auth_token');
    const history = messages.filter((m): m is TextMessage => m.kind === 'text').map(({ role, content }) => ({ role, content }));

    setMessages((prev) => prev.map((m) => m.id === planId && m.kind === 'plan' ? { ...m, status: 'executing', agents: planAgents } : m));
    setLoading(true);
    const synthId = crypto.randomUUID();
    setMessages((prev) => [...prev, { kind: 'text', id: synthId, role: 'assistant', content: '' } satisfies TextMessage]);

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const res = await fetch(`${getApiBaseUrl()}/api/ai/execute-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: history, plan: { summary: planMsg.summary, agents: planAgents } }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('Execute plan failed');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6).trim()) as any;
            if (ev.type === 'agent_start') {
              setMessages((prev) => prev.map((m) => m.id === planId && m.kind === 'plan'
                ? { ...m, agentStatuses: { ...(m.agentStatuses ?? {}), [ev.key]: { running: true, analysis: '' } } } : m));
            } else if (ev.type === 'agent_done') {
              setMessages((prev) => prev.map((m) => m.id === planId && m.kind === 'plan'
                ? { ...m, agentStatuses: { ...(m.agentStatuses ?? {}), [ev.key]: { running: false, analysis: ev.analysis || '' } } } : m));
            } else if (ev.type === 'text' && ev.text) {
              setMessages((prev) => prev.map((m) => m.id === synthId && m.kind === 'text' ? { ...m, content: m.content + ev.text } : m));
            } else if (ev.type === 'done') {
              setMessages((prev) => prev.map((m) => m.id === planId && m.kind === 'plan' ? { ...m, status: 'done' } : m));
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages((prev) => prev.map((m) => m.id === synthId && m.kind === 'text' ? { ...m, content: err?.message || 'Plan execution failed.' } : m));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [messages]);

  const cancelPlan = useCallback((planId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== planId));
  }, []);

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
            <button type="button" className="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-soft hover:text-ink" aria-label="Settings">
              <Settings size={13} />
            </button>
            <button type="button" onClick={() => setOpen(false)} className="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-soft hover:text-ink" aria-label="Close">
              <X size={13} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {!hasMessages ? (
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
                    {msg.kind === 'tool' ? (
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
                    ) : (
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
                  </div>
                ))}

                {loading && messages.length > 0 &&
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
