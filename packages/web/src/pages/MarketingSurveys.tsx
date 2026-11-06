import { useState, useEffect, useRef } from 'react';
import {
  ClipboardList, Plus, Trash2, BarChart2, ChevronRight, Star,
  ArrowLeft, Copy, ExternalLink, Check, TrendingUp, Users, Eye,
  Play, Smile, Mail, User, FileText, Type, Image as ImageIcon,
  Bold, Italic, Underline as UnderlineIcon, Link2, List, ListOrdered,
  ChevronDown, X,
} from 'lucide-react';
import {
  surveysService, Survey, SurveyQuestion, SurveyAnalytics, QuestionAnalytics,
} from '../services/surveysService';
import { campaignService, type Campaign } from '../services/campaignService';

const SURVEY_PURPOSES = [
  { value: 'nps', label: 'Net Promoter Score (NPS)', description: 'Measure customer loyalty' },
  { value: 'csat', label: 'Customer Satisfaction (CSAT)', description: 'Rate a recent interaction' },
  { value: 'ces', label: 'Customer Effort Score (CES)', description: 'How easy was it to get help?' },
  { value: 'lead_qualification', label: 'Lead Qualification', description: 'Qualify leads before follow-up' },
  { value: 'product_feedback', label: 'Product Feedback', description: 'Understand user needs' },
  { value: 'market_research', label: 'Market Research', description: 'Gather audience insights' },
  { value: 'event_feedback', label: 'Event Feedback', description: 'Post-event satisfaction' },
];

// ── Block type definitions ──────────────────────────────────────────────────

type BlockTypeId = SurveyQuestion['type'];
type IntroSubType = 'video' | 'text' | 'image';

function RadioSVG() {
  return (
    <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none">
      <circle cx="5" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5" cy="6" r="2" fill="currentColor" />
      <circle cx="14" cy="14" r="4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function CheckboxSVG() {
  return (
    <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none">
      <rect x="1" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 5l1.5 1.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="11" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 5l1.5 1.5L18 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="1" y="11" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function RangeSVG() {
  return (
    <svg viewBox="0 0 20 12" className="w-5 h-5" fill="none">
      <rect x="0" y="4" width="20" height="4" rx="2" fill="currentColor" opacity=".25" />
      <rect x="0" y="4" width="11" height="4" rx="2" fill="currentColor" opacity=".7" />
      <circle cx="11" cy="6" r="4" fill="currentColor" />
    </svg>
  );
}

const BLOCK_DEFS: { type: BlockTypeId; icon: React.ReactNode; label: string; desc: string }[] = [
  { type: 'introduction', icon: <Smile size={18} />, label: 'Introduction', desc: 'Welcome text, video, or image explaining how feedback will be used' },
  { type: 'radio', icon: <RadioSVG />, label: 'Radio buttons', desc: 'Select a single answer from a list of options' },
  { type: 'checkbox', icon: <CheckboxSVG />, label: 'Checkboxes', desc: 'Select multiple answers from a list of options' },
  { type: 'range', icon: <RangeSVG />, label: 'Range', desc: 'Select a score from a range' },
  { type: 'text', icon: <Type size={18} />, label: 'Open text', desc: 'Provide an open-text response' },
  { type: 'email', icon: <Mail size={18} />, label: 'Email', desc: 'Provide an email to be added to your audience' },
  { type: 'contact', icon: <User size={18} />, label: 'Contact information', desc: 'Provide user-specific data like name, address, age and gender' },
  { type: 'content', icon: <FileText size={18} />, label: 'Content block', desc: 'Add text, video, or image without a question' },
];

const BLOCK_LABEL: Record<string, string> = Object.fromEntries(BLOCK_DEFS.map(d => [d.type, d.label]));

// ── Add Divider ──────────────────────────────────────────────────────────────

function AddDivider({ onAdd }: { onAdd: (type: BlockTypeId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center my-2">
      <div className="flex-1 border-t border-slate-700" />
      <button
        onClick={() => setOpen(p => !p)}
        className="w-7 h-7 rounded-full bg-slate-800 text-white flex items-center justify-center mx-2 hover:bg-slate-600 transition-colors shrink-0 z-10"
      >
        <Plus size={14} />
      </button>
      <div className="flex-1 border-t border-slate-700" />

      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 top-9 z-30 w-72 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <div className="max-h-72 overflow-y-auto">
            {BLOCK_DEFS.map(def => (
              <button
                key={def.type}
                onClick={() => { onAdd(def.type); setOpen(false); }}
                className="flex items-start gap-3 w-full px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0 text-left"
              >
                <div className="w-10 h-10 border border-gray-200 rounded bg-gray-50 flex items-center justify-center shrink-0 text-gray-600">{def.icon}</div>
                <div>
                  <p className="text-sm font-semibold text-blue-600">{def.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-tight">{def.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Rich text editor ─────────────────────────────────────────────────────────

function RichTextEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastHtml = useRef(value);

  useEffect(() => {
    if (ref.current) { ref.current.innerHTML = value; lastHtml.current = value; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Sync from outside only if it changed externally (not from our own typing)
    if (ref.current && value !== lastHtml.current) {
      ref.current.innerHTML = value;
      lastHtml.current = value;
    }
  }, [value]);

  function exec(cmd: string, val?: string) {
    ref.current?.focus();
    document.execCommand(cmd, false, val);
    if (ref.current) { lastHtml.current = ref.current.innerHTML; onChange(ref.current.innerHTML); }
  }
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-100 bg-gray-50">
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('bold'); }} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700"><Bold size={13} /></button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('italic'); }} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700"><Italic size={13} /></button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('underline'); }} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700"><UnderlineIcon size={13} /></button>
        <div className="w-px h-4 bg-gray-200 mx-0.5" />
        <button type="button" onMouseDown={e => { e.preventDefault(); const u = prompt('URL'); if (u) exec('createLink', u); }} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700"><Link2 size={13} /></button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList'); }} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700"><List size={13} /></button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertOrderedList'); }} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700"><ListOrdered size={13} /></button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        dir="ltr"
        onInput={() => {
          if (ref.current) { lastHtml.current = ref.current.innerHTML; onChange(ref.current.innerHTML); }
        }}
        className="min-h-[80px] px-3 py-2 text-sm text-gray-700 focus:outline-none"
        data-placeholder="Your copy goes here..."
      />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getYouTubeEmbedUrl(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

// ── Block Editors ────────────────────────────────────────────────────────────

const INTRO_SUBS: { type: IntroSubType; label: string; desc: string }[] = [
  { type: 'video', label: 'Embed video', desc: 'Add a personal touch and boost survey responses by embedding a YouTube or Vimeo video introduction.' },
  { type: 'text', label: 'Text introduction', desc: 'Explain how feedback will be used, any specific instructions and mention any perks for completing the survey.' },
  { type: 'image', label: 'Image', desc: 'Make your survey more visually appealing or gather feedback about a specific image.' },
];

function ImageUpload({ url, onUrl, altValue, onAlt }: { url: string; onUrl: (u: string) => void; altValue?: string; onAlt?: (a: string) => void }) {
  return (
    <div>
      {url ? (
        <div className="relative">
          <img src={url} alt="uploaded" className="rounded-lg max-h-52 w-full object-cover border border-gray-200" />
          <button onClick={() => onUrl('')} className="absolute top-2 right-2 p-1 bg-white rounded-full shadow text-gray-400 hover:text-red-500"><X size={13} /></button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors">
          <ImageIcon size={28} className="text-gray-400 mb-2" />
          <span className="text-xs text-gray-500">Click to upload image</span>
          <input type="file" accept="image/*" className="hidden" onChange={e => {
            const file = e.target.files?.[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => onUrl(ev.target?.result as string);
            reader.readAsDataURL(file);
          }} />
        </label>
      )}
      {onAlt && (
        <div className="mt-2">
          <label className="block text-xs text-gray-500 mb-1">Alt text</label>
          <input value={altValue ?? ''} onChange={e => onAlt(e.target.value)} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Describe this image" />
        </div>
      )}
    </div>
  );
}

function IntroductionEditor({ block, onChange }: { block: SurveyQuestion; onChange: (b: SurveyQuestion) => void }) {
  const sub = block.settings.subType as IntroSubType | undefined;
  const set = (patch: Record<string, unknown>) => onChange({ ...block, settings: { ...block.settings, ...patch } });

  if (!sub) {
    return (
      <div className="space-y-3">
        {INTRO_SUBS.map(s => (
          <button key={s.type} onClick={() => set({ subType: s.type })}
            className="flex items-start gap-3 w-full text-left p-3 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 transition-colors">
            <div className="w-5 h-5 rounded-full border-2 border-gray-300 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-gray-900">{s.label}</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-tight">{s.desc}</p>
            </div>
          </button>
        ))}
      </div>
    );
  }

  if (sub === 'video') {
    const videoUrl = (block.settings.videoUrl as string) ?? '';
    const embedUrl = getYouTubeEmbedUrl(videoUrl);
    return (
      <div>
        {embedUrl ? (
          <iframe src={embedUrl} className="w-full rounded-xl aspect-video border border-gray-200 mb-4" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
        ) : (
          <div className="bg-gray-100 rounded-xl aspect-video flex items-center justify-center mb-4 border border-gray-200">
            <div className="w-16 h-16 border-2 border-gray-400 rounded-xl flex items-center justify-center">
              <Play size={28} className="text-gray-400 ml-1" />
            </div>
          </div>
        )}
        <label className="block text-sm font-medium text-gray-700 mb-1">Video URL</label>
        <input value={videoUrl} onChange={e => set({ videoUrl: e.target.value })}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="https://youtube.com/watch?v=..." />
        <p className="text-xs text-gray-400 mt-1.5">We currently only support videos from <strong>YouTube</strong> and <strong>Vimeo</strong></p>
      </div>
    );
  }

  if (sub === 'text') {
    return (
      <div>
        <p className="text-sm font-bold text-gray-900 mb-2">What would you like to say?</p>
        <RichTextEditor value={(block.settings.richText as string) ?? ''} onChange={v => set({ richText: v })} />
        <div className="mt-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">Add image</p>
          <ImageUpload url={(block.settings.imageUrl as string) ?? ''} onUrl={u => set({ imageUrl: u })} altValue={(block.settings.imageAlt as string) ?? ''} onAlt={a => set({ imageAlt: a })} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <ImageUpload url={(block.settings.imageUrl as string) ?? ''} onUrl={u => set({ imageUrl: u })} altValue={(block.settings.imageAlt as string) ?? ''} onAlt={a => set({ imageAlt: a })} />
    </div>
  );
}

function OptionsEditor({ block, onChange, multiple }: { block: SurveyQuestion; onChange: (b: SurveyQuestion) => void; multiple?: boolean }) {
  const [newOpt, setNewOpt] = useState('');
  function addOpt() {
    const v = newOpt.trim(); if (!v) return;
    onChange({ ...block, options: [...block.options, v] });
    setNewOpt('');
  }
  return (
    <div>
      <input value={block.question} onChange={e => onChange({ ...block, question: e.target.value })} placeholder="Your question here…"
        className="w-full text-sm font-semibold text-gray-900 bg-transparent border-0 border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none py-1 mb-4" />
      <div className="space-y-2">
        {block.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2.5">
            {multiple
              ? <div className="w-4 h-4 rounded border-2 border-gray-300 shrink-0" />
              : <div className="w-4 h-4 rounded-full border-2 border-gray-300 shrink-0" />}
            <input
              value={opt}
              onChange={e => { const o = [...block.options]; o[i] = e.target.value; onChange({ ...block, options: o }); }}
              className="flex-1 text-sm text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none py-0.5"
            />
            <button onClick={() => onChange({ ...block, options: block.options.filter((_, j) => j !== i) })} className="text-gray-300 hover:text-red-400 shrink-0"><X size={12} /></button>
          </div>
        ))}
        <div className="flex items-center gap-2 mt-2">
          <input value={newOpt} onChange={e => setNewOpt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOpt(); } }}
            placeholder="Add option…" className="flex-1 px-3 py-1.5 border border-dashed border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={addOpt} className="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">Add</button>
        </div>
      </div>
    </div>
  );
}

function RangeEditor({ block, onChange }: { block: SurveyQuestion; onChange: (b: SurveyQuestion) => void }) {
  const min = (block.settings.min as number) ?? 0;
  const max = (block.settings.max as number) ?? 10;
  const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const set = (patch: Record<string, unknown>) => onChange({ ...block, settings: { ...block.settings, ...patch } });
  return (
    <div>
      <input value={block.question} onChange={e => onChange({ ...block, question: e.target.value })} placeholder="Your question here…"
        className="w-full text-sm font-semibold text-gray-900 bg-transparent border-0 border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none py-1 mb-4" />
      <div className="flex gap-1 flex-wrap mb-2">
        {steps.map(n => (
          <div key={n} className="w-9 h-9 border border-gray-200 rounded flex items-center justify-center text-sm text-gray-600 bg-gray-50 font-medium">{n}</div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-gray-400 mb-4">
        <span>{(block.settings.minLabel as string) || 'Not at all likely'}</span>
        <span>{(block.settings.maxLabel as string) || 'Extremely likely'}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Min label</label>
          <input value={(block.settings.minLabel as string) ?? ''} onChange={e => set({ minLabel: e.target.value })} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="Not at all likely" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Max label</label>
          <input value={(block.settings.maxLabel as string) ?? ''} onChange={e => set({ maxLabel: e.target.value })} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="Extremely likely" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Min value</label>
          <input type="number" value={min} onChange={e => set({ min: Number(e.target.value) })} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Max value</label>
          <input type="number" value={max} onChange={e => set({ max: Number(e.target.value) })} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
        </div>
      </div>
    </div>
  );
}

function TextEditor({ block, onChange }: { block: SurveyQuestion; onChange: (b: SurveyQuestion) => void }) {
  return (
    <div>
      <input value={block.question} onChange={e => onChange({ ...block, question: e.target.value })} placeholder="Your question here…"
        className="w-full text-sm font-semibold text-gray-900 bg-transparent border-0 border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none py-1 mb-3" />
      <div className="px-3 py-3 border border-gray-100 rounded-lg bg-gray-50 text-sm text-gray-400 italic">Open-ended text answer</div>
    </div>
  );
}

function EmailEditor({ block, onChange }: { block: SurveyQuestion; onChange: (b: SurveyQuestion) => void }) {
  return (
    <div>
      <input value={block.question} onChange={e => onChange({ ...block, question: e.target.value })} placeholder="What is your email address?"
        className="w-full text-sm font-semibold text-gray-900 bg-transparent border-0 border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none py-1 mb-3" />
      <div className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-lg bg-gray-50">
        <Mail size={15} className="text-gray-400" />
        <span className="text-sm text-gray-400">email@example.com</span>
      </div>
      <p className="text-xs text-gray-400 mt-1.5">Responses will be added to your audience</p>
    </div>
  );
}

const CONTACT_FIELDS = [
  { id: 'first_name', label: 'First name' }, { id: 'last_name', label: 'Last name' },
  { id: 'phone', label: 'Phone' }, { id: 'address', label: 'Address' },
  { id: 'age', label: 'Age' }, { id: 'gender', label: 'Gender' },
];

function ContactEditor({ block, onChange }: { block: SurveyQuestion; onChange: (b: SurveyQuestion) => void }) {
  const fields = (block.settings.fields as string[]) ?? ['first_name', 'last_name'];
  function toggle(id: string) {
    const updated = fields.includes(id) ? fields.filter(f => f !== id) : [...fields, id];
    onChange({ ...block, settings: { ...block.settings, fields: updated } });
  }
  return (
    <div>
      <p className="text-sm font-semibold text-gray-900 mb-3">Contact information</p>
      <p className="text-xs text-gray-500 mb-3">Select which fields to include:</p>
      <div className="grid grid-cols-2 gap-2">
        {CONTACT_FIELDS.map(f => (
          <label key={f.id} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={fields.includes(f.id)} onChange={() => toggle(f.id)} className="rounded" />
            <span className="text-sm text-gray-700">{f.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function ContentEditor({ block, onChange }: { block: SurveyQuestion; onChange: (b: SurveyQuestion) => void }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...block, settings: { ...block.settings, ...patch } });
  return (
    <div className="space-y-4">
      <RichTextEditor value={(block.settings.richText as string) ?? ''} onChange={v => set({ richText: v })} />
      <ImageUpload url={(block.settings.imageUrl as string) ?? ''} onUrl={u => set({ imageUrl: u })} altValue={(block.settings.imageAlt as string) ?? ''} onAlt={a => set({ imageAlt: a })} />
    </div>
  );
}

function BlockEditor({ block, onChange }: { block: SurveyQuestion; onChange: (b: SurveyQuestion) => void }) {
  switch (block.type) {
    case 'introduction': return <IntroductionEditor block={block} onChange={onChange} />;
    case 'radio': return <OptionsEditor block={block} onChange={onChange} />;
    case 'checkbox': return <OptionsEditor block={block} onChange={onChange} multiple />;
    case 'range': return <RangeEditor block={block} onChange={onChange} />;
    case 'text': return <TextEditor block={block} onChange={onChange} />;
    case 'email': return <EmailEditor block={block} onChange={onChange} />;
    case 'contact': return <ContactEditor block={block} onChange={onChange} />;
    case 'content': return <ContentEditor block={block} onChange={onChange} />;
    default: return <TextEditor block={block} onChange={onChange} />;
  }
}

// ── Properties Panel ─────────────────────────────────────────────────────────

function PropertiesPanel({
  block, onTypeChange, onDuplicate, onDelete,
}: {
  block: SurveyQuestion | null;
  onTypeChange: (t: BlockTypeId) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  if (!block) return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 text-xs text-gray-400 text-center py-8">
      Click a block to select it
    </div>
  );
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-4 border-b border-gray-100">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Section type</label>
        <div className="relative">
          <select value={block.type} onChange={e => onTypeChange(e.target.value as BlockTypeId)}
            className="w-full appearance-none px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-8 bg-white">
            {BLOCK_DEFS.map(d => <option key={d.type} value={d.type}>{d.label}</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
      </div>
      <div className="px-2 py-2">
        <button onClick={onDuplicate} className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors">
          <Copy size={14} className="text-blue-500" /> Duplicate question
        </button>
        <button onClick={onDelete} className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors">
          <Trash2 size={14} /> Delete question
        </button>
      </div>
    </div>
  );
}

// ── Survey Builder ────────────────────────────────────────────────────────────

function SurveyBuilder({ survey: init, onBack, onSaved }: { survey: Survey; onBack: () => void; onSaved: (s: Survey) => void }) {
  const [survey, setSurvey] = useState<Survey>(init);
  const [blocks, setBlocks] = useState<SurveyQuestion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    surveysService.getSurvey(survey.id).then(s => {
      setSurvey(s);
      setBlocks((s.questions ?? []).sort((a, b) => a.order_idx - b.order_idx));
      setLoading(false);
    });
  }, [survey.id]);

  const selected = blocks.find(b => b.id === selectedId) ?? null;

  function addBlock(type: BlockTypeId, atIdx?: number) {
    const tempId = `new-${Date.now()}`;
    const nb: SurveyQuestion = {
      id: tempId, survey_id: survey.id, type, question: '',
      options: type === 'radio' || type === 'checkbox' ? ['Option 1', 'Option 2'] : [],
      required: false, order_idx: 0, settings: {},
    };
    setBlocks(prev => {
      const arr = [...prev];
      if (atIdx !== undefined) arr.splice(atIdx, 0, nb); else arr.push(nb);
      return arr.map((b, i) => ({ ...b, order_idx: i }));
    });
    setSelectedId(tempId);
  }

  function updateBlock(b: SurveyQuestion) { setBlocks(prev => prev.map(x => x.id === b.id ? b : x)); }

  function deleteBlock(id: string) {
    setBlocks(prev => prev.filter(b => b.id !== id).map((b, i) => ({ ...b, order_idx: i })));
    setSelectedId(null);
  }

  function duplicateBlock(id: string) {
    const b = blocks.find(x => x.id === id); if (!b) return;
    const idx = blocks.indexOf(b);
    const dup: SurveyQuestion = { ...b, id: `new-${Date.now()}`, order_idx: idx + 1 };
    setBlocks(prev => { const a = [...prev]; a.splice(idx + 1, 0, dup); return a.map((x, i) => ({ ...x, order_idx: i })); });
    setSelectedId(dup.id);
  }

  function changeType(id: string, type: BlockTypeId) {
    setBlocks(prev => prev.map(b => b.id !== id ? b : {
      ...b, type,
      options: type === 'radio' || type === 'checkbox' ? (b.options.length ? b.options : ['Option 1', 'Option 2']) : [],
      settings: {},
    }));
  }

  async function save() {
    setSaving(true); setError('');
    try {
      const updated = await surveysService.updateSurvey(survey.id, {
        title: survey.title, description: survey.description,
        thank_you_message: survey.thank_you_message, status: survey.status,
      });
      setSurvey(updated);

      const fresh = await surveysService.getSurvey(survey.id);
      const localRealIds = new Set(blocks.filter(b => !b.id.startsWith('new-')).map(b => b.id));
      for (const sq of (fresh.questions ?? [])) {
        if (!localRealIds.has(sq.id)) await surveysService.deleteQuestion(survey.id, sq.id);
      }

      const idMap = new Map<string, string>();
      const saved: SurveyQuestion[] = [];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const payload = { type: b.type, question: b.question, options: b.options, required: b.required, order_idx: i, settings: b.settings };
        if (b.id.startsWith('new-')) {
          const q = await surveysService.addQuestion(survey.id, payload);
          idMap.set(b.id, q.id);
          saved.push(q);
        } else {
          const q = await surveysService.updateQuestion(survey.id, b.id, payload);
          saved.push(q);
        }
      }
      setBlocks(saved);
      if (selectedId && idMap.has(selectedId)) setSelectedId(idMap.get(selectedId)!);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      onSaved(updated);
    } catch (e) { setError(String(e)); }
    setSaving(false);
  }

  if (loading) return <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"><ArrowLeft size={18} /></button>
        <input value={survey.title} onChange={e => setSurvey(s => ({ ...s, title: e.target.value }))}
          className="flex-1 text-xl font-semibold text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none pb-0.5" />
        <select value={survey.status} onChange={e => setSurvey(s => ({ ...s, status: e.target.value as Survey['status'] }))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>
        {error && <span className="text-red-500 text-xs max-w-xs truncate">{error}</span>}
        <a href={`${window.location.origin}/survey/${survey.id}?preview=1`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          <Eye size={14} /> Preview
        </a>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors">
          {saving ? 'Saving…' : saved ? <><Check size={14} /> Saved</> : 'Save'}
        </button>
      </div>

      {/* Split layout */}
      <div className="flex gap-5">
        {/* Canvas */}
        <div className="flex-1 min-w-0">
          {blocks.length === 0 && (
            <div className="text-center py-10 mb-2">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">What would you like to learn?</h2>
              <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">
                You can learn valuable insights from your audience by asking simple questions about their interests, experience, or whether they'd recommend you to a friend.
              </p>
            </div>
          )}

          <AddDivider onAdd={t => addBlock(t, 0)} />

          {blocks.map((block, idx) => (
            <div key={block.id}>
              <div
                onClick={() => setSelectedId(block.id)}
                className={`rounded-xl border-2 p-5 cursor-pointer transition-all mb-0.5 ${selectedId === block.id ? 'border-blue-400 shadow-sm bg-blue-50/20' : 'border-gray-200 bg-white hover:border-gray-300'}`}
              >
                <BlockEditor block={block} onChange={updateBlock} />
              </div>
              <AddDivider onAdd={t => addBlock(t, idx + 1)} />
            </div>
          ))}
        </div>

        {/* Properties panel */}
        <div className="w-52 shrink-0">
          <PropertiesPanel
            block={selected}
            onTypeChange={t => selectedId && changeType(selectedId, t)}
            onDuplicate={() => selectedId && duplicateBlock(selectedId)}
            onDelete={() => selectedId && deleteBlock(selectedId)}
          />
        </div>
      </div>
    </div>
  );
}

// ── New Survey Modal ──────────────────────────────────────────────────────────

function NewSurveyModal({ onClose, onCreate }: { onClose: () => void; onCreate: (s: Survey) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    campaignService.listCampaigns().then(setCampaigns).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!title.trim()) return;
    setSaving(true); setError('');
    try {
      const survey = await surveysService.createSurvey({
        title: title.trim(),
        description: description.trim() || undefined,
        ...(purpose ? { settings: { purpose, campaign_id: campaignId || undefined } } as any : {}),
      });
      if (campaignId) {
        await campaignService.addContent(campaignId, {
          content_type: 'survey',
          title: survey.title,
          description: purpose ? `${SURVEY_PURPOSES.find(p => p.value === purpose)?.label ?? purpose} survey` : undefined,
          external_id: survey.id,
          status: 'draft',
          channel: 'survey',
        }).catch(() => {});
      }
      onCreate(survey);
    }
    catch (e) { setError(String(e)); setSaving(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900">Create survey</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Survey name <span className="text-red-400">*</span></label>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="e.g. Customer satisfaction survey" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Purpose <span className="text-gray-400 font-normal">(optional)</span></label>
          <div className="grid grid-cols-2 gap-2">
            {SURVEY_PURPOSES.map(p => (
              <button key={p.value} type="button" onClick={() => setPurpose(prev => prev === p.value ? '' : p.value)}
                className={`flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-all ${purpose === p.value ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <span className={`text-xs font-semibold ${purpose === p.value ? 'text-indigo-700' : 'text-gray-800'}`}>{p.label}</span>
                <span className="mt-0.5 text-[10px] text-gray-400 leading-tight">{p.description}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" placeholder="What is this survey about?" />
        </div>
        {campaigns.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Link to Campaign <span className="text-gray-400 font-normal">(optional)</span></label>
            <select value={campaignId} onChange={e => setCampaignId(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white">
              <option value="">No campaign</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button type="submit" disabled={!title.trim() || saving} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create survey'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Survey List ───────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', active: 'bg-green-100 text-green-700', closed: 'bg-red-100 text-red-600',
};

function SurveyList({ onSelect, onNew, onAnalytics }: {
  onSelect: (s: Survey) => void; onNew: () => void; onAnalytics: (s: Survey) => void;
}) {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    surveysService.listSurveys().then(setSurveys).catch(e => setError(String(e))).finally(() => setLoading(false));
  }, []);

  async function del(id: string) {
    if (!confirm('Delete this survey and all responses?')) return;
    await surveysService.deleteSurvey(id);
    setSurveys(p => p.filter(s => s.id !== id));
  }

  async function dup(s: Survey) {
    const c = await surveysService.createSurvey({ title: `${s.title} (copy)` });
    const full = await surveysService.getSurvey(s.id);
    for (const q of (full.questions ?? [])) await surveysService.addQuestion(c.id, { type: q.type, question: q.question, options: q.options, required: q.required, order_idx: q.order_idx, settings: q.settings });
    const updated = await surveysService.listSurveys(); setSurveys(updated);
  }

  if (loading) return <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading surveys…</div>;
  if (error) return <div className="py-8 text-center text-red-500 text-sm">{error}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Surveys</h1>
          <p className="text-sm text-gray-500 mt-0.5">Collect feedback from your audience with shareable surveys.</p>
        </div>
        <button onClick={onNew} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus size={15} /> New Survey
        </button>
      </div>

      {surveys.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ClipboardList size={40} className="text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm font-medium">No surveys yet</p>
          <p className="text-gray-400 text-xs mt-1 mb-4">Create your first survey to start collecting responses.</p>
          <button onClick={onNew} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Create survey</button>
        </div>
      ) : (
        <div className="grid gap-4">
          {surveys.map(s => (
            <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                    <span className="text-xs text-gray-400">{s.response_count ?? 0} responses</span>
                    {typeof s.settings?.purpose === 'string' && (() => {
                      const p = SURVEY_PURPOSES.find(x => x.value === s.settings.purpose);
                      return p ? <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700">{p.label}</span> : null;
                    })()}
                  </div>
                  <h3 className="font-semibold text-gray-900 truncate">{s.title}</h3>
                  {s.description && <p className="text-sm text-gray-500 mt-0.5 truncate">{s.description}</p>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => dup(s)} title="Duplicate" className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors"><Copy size={14} /></button>
                  <button onClick={() => onAnalytics(s)} className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                    <BarChart2 size={14} /> Results
                  </button>
                  <button onClick={() => del(s.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 size={14} /></button>
                  <button onClick={() => onSelect(s)} className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 font-medium border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors">
                    Edit <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Analytics ────────────────────────────────────────────────────────────────

function NpsBar({ score }: { score: number }) {
  const pct = ((score + 100) / 200) * 100;
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-400 mb-1"><span>-100</span><span>0</span><span>+100</span></div>
      <div className="relative h-3 rounded-full bg-gradient-to-r from-red-400 via-yellow-300 to-green-400">
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-white border-2 border-gray-700 rounded-full shadow" style={{ left: `${pct}%` }} />
      </div>
      <p className="text-2xl font-bold text-center mt-2 text-gray-900">{score > 0 ? `+${score}` : score}</p>
    </div>
  );
}

function QCard({ q, a }: { q: SurveyQuestion; a: QuestionAnalytics }) {
  const label = BLOCK_LABEL[q.type] ?? q.type;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{label}</span>
        <p className="font-medium text-gray-900 text-sm">{q.question || <em className="text-gray-400">Untitled</em>}</p>
      </div>

      {(a.type === 'radio' || a.type === 'checkbox') && (
        <div className="space-y-2">
          {Object.entries(a.counts).sort((x, y) => y[1] - x[1]).map(([opt, cnt]) => {
            const pct = a.total > 0 ? (cnt / a.total) * 100 : 0;
            return (
              <div key={opt}>
                <div className="flex justify-between text-sm mb-1"><span className="text-gray-700">{opt}</span><span className="text-gray-500 font-medium">{cnt} ({pct.toFixed(0)}%)</span></div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
          <p className="text-xs text-gray-400 mt-1">{a.total} responses</p>
        </div>
      )}

      {a.type === 'rating' && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-3xl font-bold text-gray-900">{(a.average ?? 0).toFixed(1)}</span>
            <div className="flex">{[1,2,3,4,5].map(n => <Star key={n} size={18} className={n <= Math.round(a.average ?? 0) ? 'text-amber-400 fill-amber-400' : 'text-gray-200'} />)}</div>
          </div>
          {Object.entries(a.distribution ?? {}).sort((x,y)=>Number(y[0])-Number(x[0])).map(([n,cnt]) => {
            const pct = a.total > 0 ? ((cnt as number) / a.total) * 100 : 0;
            return (
              <div key={n} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-gray-500">{n}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} /></div>
                <span className="w-6 text-right text-gray-400">{cnt as number}</span>
              </div>
            );
          })}
          <p className="text-xs text-gray-400 mt-2">{a.total} responses</p>
        </div>
      )}

      {a.type === 'nps' && (
        <div>
          <NpsBar score={Math.round(a.score ?? 0)} />
          <div className="flex justify-around mt-4 text-center">
            <div><p className="text-xl font-bold text-green-600">{a.promoters}</p><p className="text-xs text-gray-400">Promoters</p></div>
            <div><p className="text-xl font-bold text-yellow-500">{a.passives}</p><p className="text-xs text-gray-400">Passives</p></div>
            <div><p className="text-xl font-bold text-red-500">{a.detractors}</p><p className="text-xs text-gray-400">Detractors</p></div>
          </div>
        </div>
      )}

      {a.type === 'text' && (
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {(a.responses ?? []).length === 0 ? <p className="text-sm text-gray-400">No responses yet.</p>
            : (a.responses ?? []).map((r, i) => <div key={i} className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700">"{r}"</div>)}
          <p className="text-xs text-gray-400">{a.total} responses</p>
        </div>
      )}

      {a.type !== 'radio' && a.type !== 'checkbox' && a.type !== 'rating' && a.type !== 'nps' && a.type !== 'text' && (
        <p className="text-sm text-gray-400">No analytics available for this block type.</p>
      )}
    </div>
  );
}

function SurveyAnalyticsView({ survey, onBack }: { survey: Survey; onBack: () => void }) {
  const [analytics, setAnalytics] = useState<SurveyAnalytics | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const publicUrl = `${window.location.origin}/survey/${survey.id}`;

  useEffect(() => {
    Promise.all([surveysService.getAnalytics(survey.id), surveysService.getSurvey(survey.id)])
      .then(([a, s]) => { setAnalytics(a); setQuestions(s.questions ?? []); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [survey.id]);

  if (loading) return <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading analytics…</div>;
  if (error) return <div className="py-8 text-center text-red-500 text-sm">{error}</div>;
  if (!analytics) return null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">{survey.title}</h1>
          <p className="text-sm text-gray-500">Survey results</p>
        </div>
        <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
          <ExternalLink size={14} /> Preview
        </a>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { icon: <Users size={18} className="text-blue-600" />, bg: 'bg-blue-50', val: analytics.total_responses, label: 'Total responses' },
          { icon: <TrendingUp size={18} className="text-green-600" />, bg: 'bg-green-50', val: `${analytics.completion_rate ?? 0}%`, label: 'Completion rate' },
          { icon: <Eye size={18} className="text-purple-600" />, bg: 'bg-purple-50', val: questions.length, label: 'Questions' },
        ].map(m => (
          <div key={m.label} className="bg-white border border-gray-200 rounded-xl p-5 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg ${m.bg} flex items-center justify-center`}>{m.icon}</div>
            <div><p className="text-2xl font-bold text-gray-900">{m.val}</p><p className="text-xs text-gray-500">{m.label}</p></div>
          </div>
        ))}
      </div>

      <div className="grid gap-4">
        {questions.map(q => {
          const a = analytics.questions[q.id];
          if (!a) return null;
          return <QCard key={q.id} q={q} a={a} />;
        })}
        {questions.length === 0 && <p className="text-center text-gray-400 text-sm py-8">No questions in this survey.</p>}
      </div>
    </div>
  );
}

// ── Share panel (inside builder) ─────────────────────────────────────────────

function SharePanel({ survey }: { survey: Survey }) {
  const url = `${window.location.origin}/survey/${survey.id}`;
  const [copied, setCopied] = useState(false);
  function copy() { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 mt-4">
      <p className="text-sm font-semibold text-blue-800 mb-1">Public link</p>
      <p className="text-xs text-blue-600 mb-3">Set status to <strong>Active</strong> to accept responses.</p>
      <div className="flex items-center gap-2">
        <input readOnly value={url} className="flex-1 px-3 py-2 bg-white border border-blue-200 rounded-lg text-xs text-gray-700 focus:outline-none" />
        <button onClick={copy} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className="p-2 text-blue-600 hover:text-blue-800"><ExternalLink size={15} /></a>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

type View = { mode: 'list' } | { mode: 'builder'; survey: Survey } | { mode: 'analytics'; survey: Survey };

export default function MarketingSurveys() {
  const [view, setView] = useState<View>({ mode: 'list' });
  const [newOpen, setNewOpen] = useState(false);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {view.mode === 'list' && (
        <SurveyList
          onSelect={s => setView({ mode: 'builder', survey: s })}
          onNew={() => setNewOpen(true)}
          onAnalytics={s => setView({ mode: 'analytics', survey: s })}
        />
      )}
      {view.mode === 'builder' && (
        <>
          <SurveyBuilder
            survey={view.survey}
            onBack={() => setView({ mode: 'list' })}
            onSaved={s => setView({ mode: 'builder', survey: s })}
          />
          <SharePanel survey={view.survey} />
        </>
      )}
      {view.mode === 'analytics' && (
        <SurveyAnalyticsView survey={view.survey} onBack={() => setView({ mode: 'list' })} />
      )}
      {newOpen && <NewSurveyModal onClose={() => setNewOpen(false)} onCreate={s => { setNewOpen(false); setView({ mode: 'builder', survey: s }); }} />}
    </div>
  );
}
