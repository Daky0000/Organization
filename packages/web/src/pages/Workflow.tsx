import { useState, useEffect } from 'react';
import {
  Plus, Zap, GitBranch, Play, Trash2, ChevronRight, ChevronDown,
  CheckCircle2, XCircle, AlertCircle, Loader2,
  Settings, X, ToggleLeft, ToggleRight, History, Sparkles,
  Bell, Image, Calendar, Filter, Tag, Globe, Type,
} from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiBase';

function tok() { return localStorage.getItem('auth_token') ?? ''; }

async function api<T = any>(method: string, path: string, body?: any): Promise<T> {
  const r = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeType = 'trigger' | 'condition' | 'action' | 'end';

type TriggerSubType = 'post_created' | 'post_scheduled' | 'post_published' | 'manual';
type ConditionSubType = 'has_image' | 'no_image' | 'platform_is' | 'keyword_contains' | 'post_type_is';
type ActionSubType = 'generate_ai_image' | 'auto_schedule' | 'send_notification' | 'add_to_media' | 'apply_template';

interface WFNode {
  id: string;
  type: NodeType;
  subType: TriggerSubType | ConditionSubType | ActionSubType | 'end';
  label: string;
  config: Record<string, any>;
}

interface WFEdge {
  id: string;
  sourceId: string;
  targetId: string;
  branch?: 'yes' | 'no';
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'inactive';
  nodes: WFNode[];
  edges: WFEdge[];
  created_at: string;
  updated_at: string;
}

interface WorkflowRun {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  trigger_data: any;
  logs: { step: string; message: string; ts: string }[];
  started_at: string;
  completed_at: string | null;
}

// ── Node catalogue ────────────────────────────────────────────────────────────

const TRIGGER_OPTIONS: { subType: TriggerSubType; label: string; desc: string; icon: React.ReactNode }[] = [
  { subType: 'post_created',   label: 'Post Created',    desc: 'Fires when a new post is created',  icon: <Plus size={14} /> },
  { subType: 'post_scheduled', label: 'Post Scheduled',  desc: 'Fires when a post is scheduled',    icon: <Calendar size={14} /> },
  { subType: 'post_published', label: 'Post Published',  desc: 'Fires when a post goes live',       icon: <Globe size={14} /> },
  { subType: 'manual',         label: 'Manual Trigger',  desc: 'Run this workflow on demand',       icon: <Play size={14} /> },
];

const CONDITION_OPTIONS: { subType: ConditionSubType; label: string; desc: string; icon: React.ReactNode }[] = [
  { subType: 'has_image',       label: 'Has Image',         desc: 'Post includes an image',           icon: <Image size={14} /> },
  { subType: 'no_image',        label: 'No Image',          desc: 'Post has no image attached',       icon: <Image size={14} /> },
  { subType: 'platform_is',     label: 'Platform Is',       desc: 'Post targets a specific platform', icon: <Globe size={14} /> },
  { subType: 'keyword_contains',label: 'Contains Keyword',  desc: 'Post text contains a keyword',     icon: <Type size={14} /> },
  { subType: 'post_type_is',    label: 'Post Type Is',      desc: 'Filter by post type',              icon: <Filter size={14} /> },
];

const ACTION_OPTIONS: { subType: ActionSubType; label: string; desc: string; icon: React.ReactNode; color: string }[] = [
  { subType: 'generate_ai_image', label: 'AI Image Prompt',      desc: 'Draft an image prompt with AI and notify you (uses credits)', icon: <Sparkles size={14} />, color: 'text-violet-600 bg-violet-50 border-violet-200' },
  { subType: 'auto_schedule',     label: 'Auto Schedule',         desc: 'Schedule the post automatically',       icon: <Calendar size={14} />, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { subType: 'send_notification', label: 'Send Notification',     desc: 'Send an in-app notification',           icon: <Bell size={14} />, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { subType: 'add_to_media',      label: 'Save to Media Library', desc: 'Add generated content to media library',icon: <Image size={14} />, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { subType: 'apply_template',    label: 'Apply Template',        desc: 'Apply a card template to the post',    icon: <Tag size={14} />, color: 'text-pink-600 bg-pink-50 border-pink-200' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10); }

function nodeColor(type: NodeType) {
  if (type === 'trigger')   return 'border-[#2563EB] bg-indigo-50/60';
  if (type === 'condition') return 'border-amber-400 bg-amber-50/60';
  if (type === 'action')    return 'border-emerald-400 bg-emerald-50/60';
  return 'border-slate-300 bg-slate-50';
}

function nodeIconBg(type: NodeType) {
  if (type === 'trigger')   return 'bg-[#2563EB] text-white';
  if (type === 'condition') return 'bg-amber-400 text-white';
  if (type === 'action')    return 'bg-emerald-500 text-white';
  return 'bg-slate-300 text-white';
}

function nodeIcon(node: WFNode) {
  if (node.type === 'trigger')   return <Zap size={13} />;
  if (node.type === 'condition') return <GitBranch size={13} />;
  if (node.type === 'action')    return <Play size={13} />;
  return <XCircle size={13} />;
}

function statusBadge(status: Workflow['status']) {
  if (status === 'active')   return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Active</span>;
  if (status === 'inactive') return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5">Inactive</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5">Draft</span>;
}

function runStatusIcon(status: WorkflowRun['status']) {
  if (status === 'completed') return <CheckCircle2 size={14} className="text-emerald-500" />;
  if (status === 'failed')    return <XCircle size={14} className="text-red-400" />;
  if (status === 'running')   return <Loader2 size={14} className="animate-spin text-[#2563EB]" />;
  return <AlertCircle size={14} className="text-slate-400" />;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Node Config Form ──────────────────────────────────────────────────────────

function TemplateSelect({ value, onChange }: { value: string; onChange: (id: string, name: string) => void }) {
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/card-templates/published`, {
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.templates)) setTemplates(d.templates); })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-xs text-slate-400">Loading templates…</p>;
  if (!templates.length) return <p className="text-xs text-slate-400">No published card templates yet.</p>;

  return (
    <select
      value={value}
      onChange={(e) => {
        const t = templates.find((t) => t.id === e.target.value);
        onChange(e.target.value, t?.name ?? '');
      }}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#2563EB] focus:outline-none"
    >
      <option value="">— Select a template —</option>
      {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

function NodeConfigForm({ node, onChange }: { node: WFNode; onChange: (cfg: Record<string, any>) => void }) {
  const cfg = node.config;

  if (node.subType === 'platform_is' || node.subType === 'post_type_is') {
    const options = node.subType === 'platform_is'
      ? ['instagram', 'facebook', 'twitter', 'linkedin', 'tiktok']
      : ['image', 'video', 'text', 'carousel'];
    return (
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          {node.subType === 'platform_is' ? 'Platform' : 'Post Type'}
        </label>
        <select
          value={cfg.platform ?? cfg.type ?? options[0]}
          onChange={(e) => onChange({ ...cfg, [node.subType === 'platform_is' ? 'platform' : 'type']: e.target.value })}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#2563EB] focus:outline-none"
        >
          {options.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
        </select>
      </div>
    );
  }

  if (node.subType === 'keyword_contains') {
    return (
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Keyword</label>
        <input
          type="text"
          value={cfg.keyword ?? ''}
          onChange={(e) => onChange({ ...cfg, keyword: e.target.value })}
          placeholder="e.g. sale, launch, new…"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#2563EB] focus:outline-none"
        />
      </div>
    );
  }

  if (node.subType === 'send_notification') {
    return (
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Message</label>
        <textarea
          value={cfg.message ?? ''}
          onChange={(e) => onChange({ ...cfg, message: e.target.value })}
          rows={3}
          placeholder="e.g. Your post was published successfully!"
          className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#2563EB] focus:outline-none"
        />
        <p className="text-[11px] text-slate-400">Use {'{{post_title}}'} to insert the post title.</p>
      </div>
    );
  }

  if (node.subType === 'generate_ai_image') {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">AI Model</label>
          <select
            value={cfg.model ?? 'flux-kontext-pro'}
            onChange={(e) => onChange({ ...cfg, model: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#2563EB] focus:outline-none"
          >
            {['flux-2-turbo','flux-2-klein','seedream-v5-lite','flux-kontext-pro','flux-2-pro','mystic'].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={cfg.save_to_media ?? true}
            onChange={(e) => onChange({ ...cfg, save_to_media: e.target.checked })}
            className="rounded border-slate-300 text-[#2563EB]"
          />
          <span className="text-sm text-slate-700">Save result to Media Library</span>
        </label>
      </div>
    );
  }

  if (node.subType === 'auto_schedule') {
    const slots = ['Best time', 'Morning (9am)', 'Midday (12pm)', 'Afternoon (3pm)', 'Evening (6pm)'];
    return (
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Time Slot</label>
        <select
          value={cfg.slot ?? 'Best time'}
          onChange={(e) => onChange({ ...cfg, slot: e.target.value })}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#2563EB] focus:outline-none"
        >
          {slots.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    );
  }

  if (node.subType === 'post_created' || node.subType === 'post_scheduled' || node.subType === 'post_published') {
    const platforms = ['Any', 'Instagram', 'Facebook', 'Twitter', 'LinkedIn', 'TikTok'];
    return (
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Filter by Platform</label>
        <select
          value={cfg.platform ?? 'Any'}
          onChange={(e) => onChange({ ...cfg, platform: e.target.value })}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#2563EB] focus:outline-none"
        >
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
    );
  }

  if (node.subType === 'apply_template') {
    return (
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Card Template</label>
        <TemplateSelect
          value={cfg.template_id ?? ''}
          onChange={(id, name) => onChange({ ...cfg, template_id: id, template_name: name })}
        />
        {cfg.template_name && (
          <p className="text-[11px] text-slate-400">Selected: {cfg.template_name}</p>
        )}
      </div>
    );
  }

  return <p className="text-xs text-slate-400 italic">No configuration needed for this step.</p>;
}

// ── Add Step Picker ───────────────────────────────────────────────────────────

function AddStepPicker({
  onSelect, onClose, allowTrigger = false
}: {
  onSelect: (type: NodeType, subType: string, label: string) => void;
  onClose: () => void;
  allowTrigger?: boolean;
}) {
  const [tab, setTab] = useState<'condition' | 'action'>(allowTrigger ? 'condition' : 'condition');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-black text-slate-900">Add a Step</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>

        <div className="flex border-b border-slate-100 px-5">
          <button onClick={() => setTab('condition')} className={`py-2.5 px-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'condition' ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            Condition
          </button>
          <button onClick={() => setTab('action')} className={`py-2.5 px-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'action' ? 'border-[#2563EB] text-[#2563EB]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            Action
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {tab === 'condition' && CONDITION_OPTIONS.map((o) => (
            <button
              key={o.subType}
              onClick={() => onSelect('condition', o.subType, o.label)}
              className="w-full flex items-center gap-3 rounded-xl border border-slate-200 hover:border-amber-400 hover:bg-amber-50/40 px-4 py-3 text-left transition-all group"
            >
              <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0 group-hover:bg-amber-200 transition-colors">
                {o.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{o.label}</p>
                <p className="text-xs text-slate-500">{o.desc}</p>
              </div>
            </button>
          ))}
          {tab === 'action' && ACTION_OPTIONS.map((o) => (
            <button
              key={o.subType}
              onClick={() => onSelect('action', o.subType, o.label)}
              className="w-full flex items-center gap-3 rounded-xl border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/40 px-4 py-3 text-left transition-all group"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 group-hover:bg-emerald-200 transition-colors">
                {o.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{o.label}</p>
                <p className="text-xs text-slate-500">{o.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Trigger Picker ────────────────────────────────────────────────────────────

function TriggerPicker({ onSelect, onClose }: { onSelect: (subType: TriggerSubType, label: string) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-black text-slate-900">Choose a Trigger</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-2">
          {TRIGGER_OPTIONS.map((o) => (
            <button
              key={o.subType}
              onClick={() => onSelect(o.subType, o.label)}
              className="w-full flex items-center gap-3 rounded-xl border border-slate-200 hover:border-[#2563EB] hover:bg-indigo-50/40 px-4 py-3 text-left transition-all group"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-100 text-[#2563EB] flex items-center justify-center shrink-0 group-hover:bg-indigo-200 transition-colors">
                {o.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{o.label}</p>
                <p className="text-xs text-slate-500">{o.desc}</p>
              </div>
              <ChevronRight size={14} className="ml-auto text-slate-300 group-hover:text-[#2563EB]" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Flow Node Card ────────────────────────────────────────────────────────────

function FlowNodeCard({
  node,
  isSelected,
  onSelect,
  onDelete,
  showDeleteBtn,
}: {
  node: WFNode;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  showDeleteBtn: boolean;
}) {
  return (
    <div
      onClick={onSelect}
      className={`relative rounded-2xl border-2 px-4 py-3 cursor-pointer transition-all select-none
        ${nodeColor(node.type)}
        ${isSelected ? 'ring-2 ring-offset-1 ring-[#2563EB] shadow-lg scale-[1.01]' : 'hover:shadow-md hover:scale-[1.005]'}`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${nodeIconBg(node.type)}`}>
          {nodeIcon(node)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {node.type === 'end' ? '' : node.type}
          </p>
          <p className="text-sm font-bold text-slate-800 truncate">{node.label}</p>
          {node.type === 'condition' && (
            <div className="flex gap-2 mt-1">
              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">✓ Yes</span>
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">✗ No</span>
            </div>
          )}
          {node.type === 'trigger' && (
            <p className="text-[11px] text-slate-500 mt-0.5">Starts this workflow</p>
          )}
          {node.type === 'end' && (
            <p className="text-[11px] text-slate-400 mt-0.5 italic">Flow ends here</p>
          )}
        </div>
        {showDeleteBtn && node.type !== 'end' && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="shrink-0 p-1 rounded-lg hover:bg-red-100 text-slate-300 hover:text-red-500 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Flow renderer ─────────────────────────────────────────────────────────────

function AddStepBtn({ onClick, label = '+ Add step' }: { onClick: () => void; label?: string }) {
  return (
    <div className="flex flex-col items-center py-1">
      <div className="w-px h-4 bg-slate-200" />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="flex items-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 hover:border-[#2563EB] hover:bg-indigo-50 px-4 py-2 text-xs font-bold text-slate-500 hover:text-[#2563EB] transition-all shadow-sm bg-white"
      >
        <Plus size={13} className="shrink-0" /> {label}
      </button>
      <div className="w-px h-4 bg-slate-200" />
    </div>
  );
}

function BranchBox({ label, bgColor, borderColor, labelColor, children }: {
  label: string; bgColor: string; borderColor: string; labelColor: string; children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col items-center rounded-2xl border-2 ${borderColor} ${bgColor} px-4 pt-3 pb-4 min-w-[280px]`}>
      <span className={`text-[11px] font-black uppercase tracking-widest mb-3 ${labelColor}`}>{label}</span>
      {children}
    </div>
  );
}

// Recursive flow component — works for main chain AND inside branches at any depth.
// condCtx: when set, we're the first node of an empty branch; if it's an end node we show
// "Add step to this branch" before the End Flow card.
function FlowChain({
  nodeId,
  condCtx,
  allNodes,
  edges,
  selectedId,
  onSelectNode,
  onDeleteNode,
  onAddStep,
}: {
  nodeId: string | null;
  condCtx: { nodeId: string; branch: 'yes' | 'no' } | null;
  allNodes: WFNode[];
  edges: WFEdge[];
  selectedId: string | null;
  onSelectNode: (id: string) => void;
  onDeleteNode: (id: string) => void;
  onAddStep: (afterId: string, branch?: 'yes' | 'no') => void;
}): React.ReactElement | null {
  if (!nodeId) return null;
  const node = allNodes.find((n) => n.id === nodeId);
  if (!node) return null;

  // ── End node ──
  if (node.type === 'end') {
    return (
      <div className="flex flex-col items-center w-full">
        {condCtx && (
          <AddStepBtn
            onClick={() => onAddStep(condCtx.nodeId, condCtx.branch)}
            label="+ Add step to this branch"
          />
        )}
        <div className="w-full max-w-[300px]">
          <FlowNodeCard node={node} isSelected={selectedId === node.id} onSelect={() => onSelectNode(node.id)} onDelete={() => onDeleteNode(node.id)} showDeleteBtn={false} />
        </div>
      </div>
    );
  }

  // ── Condition node ──
  if (node.type === 'condition') {
    const yesEdge = edges.find((e) => e.sourceId === node.id && e.branch === 'yes');
    const noEdge  = edges.find((e) => e.sourceId === node.id && e.branch === 'no');
    const nextEdge = edges.find((e) => e.sourceId === node.id && !e.branch);
    return (
      <div className="flex flex-col items-center w-full">
        <div className="w-full max-w-[300px]">
          <FlowNodeCard node={node} isSelected={selectedId === node.id} onSelect={() => onSelectNode(node.id)} onDelete={() => onDeleteNode(node.id)} showDeleteBtn={true} />
        </div>
        <div className="w-px h-4 bg-slate-200" />
        <div className="flex gap-4 w-full justify-center items-start">
          <BranchBox label="✓  If Yes" bgColor="bg-emerald-50/60" borderColor="border-emerald-200" labelColor="text-emerald-700">
            <FlowChain nodeId={yesEdge?.targetId ?? null} condCtx={{ nodeId: node.id, branch: 'yes' }} allNodes={allNodes} edges={edges} selectedId={selectedId} onSelectNode={onSelectNode} onDeleteNode={onDeleteNode} onAddStep={onAddStep} />
          </BranchBox>
          <BranchBox label="✗  If No" bgColor="bg-red-50/60" borderColor="border-red-200" labelColor="text-red-600">
            <FlowChain nodeId={noEdge?.targetId ?? null} condCtx={{ nodeId: node.id, branch: 'no' }} allNodes={allNodes} edges={edges} selectedId={selectedId} onSelectNode={onSelectNode} onDeleteNode={onDeleteNode} onAddStep={onAddStep} />
          </BranchBox>
        </div>
        {nextEdge && (
          <FlowChain nodeId={nextEdge.targetId} condCtx={null} allNodes={allNodes} edges={edges} selectedId={selectedId} onSelectNode={onSelectNode} onDeleteNode={onDeleteNode} onAddStep={onAddStep} />
        )}
      </div>
    );
  }

  // ── Trigger / Action node ──
  const nextEdge = edges.find((e) => e.sourceId === node.id && !e.branch);
  return (
    <div className="flex flex-col items-center w-full">
      <div className="w-full max-w-[300px]">
        <FlowNodeCard node={node} isSelected={selectedId === node.id} onSelect={() => onSelectNode(node.id)} onDelete={() => onDeleteNode(node.id)} showDeleteBtn={node.type !== 'trigger'} />
      </div>
      <AddStepBtn onClick={() => onAddStep(node.id)} />
      {nextEdge && (
        <FlowChain nodeId={nextEdge.targetId} condCtx={null} allNodes={allNodes} edges={edges} selectedId={selectedId} onSelectNode={onSelectNode} onDeleteNode={onDeleteNode} onAddStep={onAddStep} />
      )}
    </div>
  );
}

// ── Workflow Builder ──────────────────────────────────────────────────────────

function WorkflowBuilder({
  workflow,
  onSave,
  onBack,
}: {
  workflow: Workflow;
  onSave: (updated: Workflow) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(workflow.name);
  const [nodes, setNodes] = useState<WFNode[]>(workflow.nodes);
  const [edges, setEdges] = useState<WFEdge[]>(workflow.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTriggerPicker, setShowTriggerPicker] = useState(nodes.length === 0);
  const [addAfter, setAddAfter] = useState<{ nodeId: string; branch?: 'yes' | 'no' } | null>(null);
  const [changingNodeId, setChangingNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [runResult, setRunResult] = useState<{ status: string; logs: any[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  const triggerNode = nodes.find((n) => n.type === 'trigger');

  const addNode = (type: NodeType, subType: string, label: string) => {
    if (!addAfter) return;
    const newNode: WFNode = { id: uid(), type, subType: subType as any, label, config: {} };

    const newNodes = [...nodes, newNode];
    // Remove the existing outgoing edge from addAfter.nodeId (splice it out so we can re-route)
    const newEdges = [...edges];
    const existingIdx = newEdges.findIndex(
      (e) => e.sourceId === addAfter.nodeId &&
        (addAfter.branch ? e.branch === addAfter.branch : !e.branch)
    );
    const existingNext = existingIdx >= 0 ? newEdges.splice(existingIdx, 1)[0] : null;

    if (type === 'condition') {
      const yesEnd: WFNode = { id: uid(), type: 'end', subType: 'end', label: 'End Flow', config: {} };
      const noEnd:  WFNode = { id: uid(), type: 'end', subType: 'end', label: 'End Flow', config: {} };
      newNodes.push(yesEnd, noEnd);
      newEdges.push(
        { id: uid(), sourceId: addAfter.nodeId, targetId: newNode.id, branch: addAfter.branch },
        { id: uid(), sourceId: newNode.id, targetId: yesEnd.id, branch: 'yes' },
        { id: uid(), sourceId: newNode.id, targetId: noEnd.id,  branch: 'no' },
      );
    } else {
      // Re-route: addAfter.nodeId → newNode → (whatever was after addAfter.nodeId before)
      const afterTargetId = existingNext?.targetId ?? (() => {
        const e: WFNode = { id: uid(), type: 'end', subType: 'end', label: 'End Flow', config: {} };
        newNodes.push(e);
        return e.id;
      })();
      newEdges.push(
        { id: uid(), sourceId: addAfter.nodeId, targetId: newNode.id, branch: addAfter.branch },
        { id: uid(), sourceId: newNode.id, targetId: afterTargetId },
      );
    }

    setNodes(newNodes);
    setEdges(newEdges);
    setAddAfter(null);
    setSelectedId(newNode.id);
  };

  const deleteNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.sourceId !== nodeId && e.targetId !== nodeId));
    if (selectedId === nodeId) setSelectedId(null);
  };

  const changeNode = (type: NodeType, subType: string, label: string) => {
    if (!changingNodeId) return;
    setNodes((prev) => prev.map((n) =>
      n.id === changingNodeId ? { ...n, type, subType: subType as any, label, config: {} } : n
    ));
    setChangingNodeId(null);
  };

  const updateNodeConfig = (cfg: Record<string, any>) => {
    setNodes((prev) => prev.map((n) => n.id === selectedId ? { ...n, config: cfg } : n));
  };

  const updateNodeLabel = (label: string) => {
    setNodes((prev) => prev.map((n) => n.id === selectedId ? { ...n, label } : n));
  };

  const handleSave = async () => {
    setSaving(true);
    const updated = await api('PUT', `/api/workflows/${workflow.id}`, { name, nodes, edges });
    setSaving(false);
    if (updated.success) onSave(updated.workflow);
  };

  const handleRun = async () => {
    setRunning(true);
    setRunResult(null);
    const r = await api('POST', `/api/workflows/${workflow.id}/run`, { trigger_data: { title: 'Test post', platform: 'instagram' } });
    setRunning(false);
    setRunResult(r);
  };

  const loadRuns = async () => {
    setLoadingRuns(true);
    const r = await api('GET', `/api/workflows/${workflow.id}/runs`);
    setLoadingRuns(false);
    if (r.success) setRuns(r.runs);
  };

  useEffect(() => {
    if (showHistory) loadRuns();
  }, [showHistory]);

  const renderFlow = () => {
    if (!triggerNode) {
      return (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 border-2 border-dashed border-indigo-200 flex items-center justify-center">
            <Zap size={24} className="text-indigo-300" />
          </div>
          <p className="text-slate-500 text-sm font-medium">Start by choosing a trigger</p>
          <button
            onClick={() => setShowTriggerPicker(true)}
            className="flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-bold text-white hover:bg-indigo-600 transition"
          >
            <Plus size={14} /> Choose Trigger
          </button>
        </div>
      );
    }
    return (
      <FlowChain
        nodeId={triggerNode.id}
        condCtx={null}
        allNodes={nodes}
        edges={edges}
        selectedId={selectedId}
        onSelectNode={setSelectedId}
        onDeleteNode={deleteNode}
        onAddStep={(afterId, branch) => setAddAfter({ nodeId: afterId, branch })}
      />
    );
  };

  return (
    <div className="flex h-full min-h-[calc(100vh-120px)]">
      {/* Canvas */}
      <div className="flex-1 overflow-y-auto overflow-x-auto">
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center gap-3 bg-white/90 backdrop-blur border-b border-slate-100 px-5 py-3">
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <ChevronDown size={16} className="-rotate-90" />
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 text-base font-black text-slate-900 bg-transparent border-0 outline-none focus:bg-slate-50 rounded-lg px-2 py-0.5"
          />
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              <History size={13} /> History
            </button>
            <button
              onClick={handleRun}
              disabled={running || !triggerNode}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Test Run
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-600 disabled:opacity-50 transition"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save
            </button>
          </div>
        </div>

        {/* Run result */}
        {runResult && (
          <div className={`mx-5 mt-4 rounded-xl border px-4 py-3 text-sm ${runResult.status === 'completed' ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex items-center gap-2 font-semibold mb-2">
              {runResult.status === 'completed' ? <CheckCircle2 size={14} className="text-emerald-600" /> : <XCircle size={14} className="text-red-500" />}
              <span className={runResult.status === 'completed' ? 'text-emerald-700' : 'text-red-600'}>
                Run {runResult.status}
              </span>
              <button onClick={() => setRunResult(null)} className="ml-auto text-slate-400 hover:text-slate-600"><X size={13} /></button>
            </div>
            <div className="space-y-1">
              {runResult.logs.map((l: any, i: number) => (
                <p key={i} className="text-xs text-slate-600 font-mono">{l.message}</p>
              ))}
            </div>
          </div>
        )}

        {/* History panel */}
        {showHistory && (
          <div className="mx-5 mt-4 rounded-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
              <h4 className="text-sm font-black text-slate-700">Run History</h4>
              <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
            </div>
            {loadingRuns ? (
              <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-400" /></div>
            ) : runs.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No runs yet. Use Test Run to trigger this workflow.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {runs.map((run) => (
                  <div key={run.id}>
                    <button
                      onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left"
                    >
                      {runStatusIcon(run.status)}
                      <span className="text-xs font-semibold text-slate-700 capitalize">{run.status}</span>
                      <span className="text-xs text-slate-400 ml-auto">{timeAgo(run.started_at)}</span>
                      <ChevronDown size={12} className={`text-slate-400 transition-transform ${expandedRun === run.id ? 'rotate-180' : ''}`} />
                    </button>
                    {expandedRun === run.id && (
                      <div className="px-4 pb-3 space-y-1">
                        {(run.logs ?? []).map((l, i) => (
                          <p key={i} className="text-xs text-slate-500 font-mono">{l.message}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Flow canvas */}
        <div className="flex flex-col items-center py-8 px-4 gap-0 min-w-[500px]">
          {renderFlow()}
        </div>
      </div>

      {/* Config panel */}
      {selectedNode && (
        <div className="w-72 shrink-0 border-l border-slate-200 bg-white overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-md flex items-center justify-center ${nodeIconBg(selectedNode.type)}`}>
                {nodeIcon(selectedNode)}
              </div>
              <span className="text-sm font-black text-slate-800">{selectedNode.type === 'end' ? 'End' : selectedNode.type.charAt(0).toUpperCase() + selectedNode.type.slice(1)}</span>
            </div>
            <button onClick={() => setSelectedId(null)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X size={14} /></button>
          </div>
          <div className="p-4 space-y-4">
            {selectedNode.type !== 'end' && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Label</label>
                <input
                  type="text"
                  value={selectedNode.label}
                  onChange={(e) => updateNodeLabel(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#2563EB] focus:outline-none"
                />
              </div>
            )}

            <NodeConfigForm node={selectedNode} onChange={updateNodeConfig} />

            {/* AI Instructions — shown for every action and condition */}
            {(selectedNode.type === 'action' || selectedNode.type === 'condition') && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-indigo-600 uppercase tracking-wide flex items-center gap-1">
                  <Sparkles size={11} /> AI Instructions
                </label>
                <textarea
                  value={selectedNode.config.ai_instructions ?? ''}
                  onChange={(e) => updateNodeConfig({ ...selectedNode.config, ai_instructions: e.target.value })}
                  rows={4}
                  placeholder={
                    selectedNode.type === 'action'
                      ? 'Tell the AI exactly what to do at this step…\ne.g. "Generate a professional image matching the post theme"'
                      : 'Describe the condition logic…\ne.g. "Check if the post has at least one image attached"'
                  }
                  className="w-full resize-none rounded-lg border border-indigo-200 bg-indigo-50/30 px-3 py-2 text-sm text-slate-700 focus:border-[#2563EB] focus:outline-none placeholder:text-slate-400/80 leading-relaxed"
                />
                <p className="text-[10px] text-slate-400">The AI reads these instructions when executing this step.</p>
              </div>
            )}

            {/* Change Trigger (keeps all other steps intact) */}
            {selectedNode.type === 'trigger' && (
              <button
                onClick={() => setShowTriggerPicker(true)}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 px-3 py-2 text-xs font-semibold transition"
              >
                <Zap size={12} /> Change Trigger
              </button>
            )}

            {/* Change step type */}
            {(selectedNode.type === 'action' || selectedNode.type === 'condition') && (
              <button
                onClick={() => setChangingNodeId(selectedNode.id)}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-2 text-xs font-semibold transition"
              >
                <Settings size={12} /> Change Step Type
              </button>
            )}

            {/* Remove step */}
            {selectedNode.type !== 'trigger' && selectedNode.type !== 'end' && (
              <button
                onClick={() => { deleteNode(selectedNode.id); setSelectedId(null); }}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 px-3 py-2 text-xs font-semibold transition"
              >
                <Trash2 size={12} /> Remove this step
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {showTriggerPicker && (
        <TriggerPicker
          onClose={() => setShowTriggerPicker(false)}
          onSelect={(subType, label) => {
            const existing = nodes.find((n) => n.type === 'trigger');
            if (existing) {
              // Swap trigger type/label only — all other steps stay intact
              setNodes((prev) => prev.map((n) => n.id === existing.id ? { ...n, subType, label, config: {} } : n));
            } else {
              // First time — create fresh trigger + end
              const trigNode: WFNode = { id: uid(), type: 'trigger', subType, label, config: {} };
              const endNode: WFNode  = { id: uid(), type: 'end', subType: 'end', label: 'End Flow', config: {} };
              setNodes([trigNode, endNode]);
              setEdges([{ id: uid(), sourceId: trigNode.id, targetId: endNode.id }]);
              setSelectedId(trigNode.id);
            }
            setShowTriggerPicker(false);
          }}
        />
      )}

      {addAfter && (
        <AddStepPicker
          onClose={() => setAddAfter(null)}
          onSelect={(type, subType, label) => addNode(type, subType, label)}
        />
      )}

      {changingNodeId && (
        <AddStepPicker
          onClose={() => setChangingNodeId(null)}
          onSelect={(type, subType, label) => changeNode(type, subType, label)}
        />
      )}
    </div>
  );
}

// ── Workflow List Page ─────────────────────────────────────────────────────────

export default function WorkflowPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await api('GET', '/api/workflows');
      if (r.success) setWorkflows(r.workflows ?? []);
      else setLoadError(r.error ?? 'Failed to load workflows');
    } catch (e: any) {
      setLoadError(e.message ?? 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createNew = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const r = await api('POST', '/api/workflows', { name: 'New Workflow', description: '', nodes: [], edges: [] });
      if (r.success) {
        setEditing(r.workflow);
      } else {
        setCreateError(r.error ?? 'Failed to create workflow');
      }
    } catch (e: any) {
      setCreateError(e.message ?? 'Network error');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (wf: Workflow) => {
    setToggling(wf.id);
    const r = await api('POST', `/api/workflows/${wf.id}/activate`);
    setToggling(null);
    if (r.success) setWorkflows((prev) => prev.map((w) => w.id === wf.id ? r.workflow : w));
  };

  const deleteWf = async (id: string) => {
    setDeleting(id);
    await api('DELETE', `/api/workflows/${id}`);
    setDeleting(null);
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
  };

  if (editing) {
    return (
      <WorkflowBuilder
        workflow={editing}
        onSave={(updated) => {
          setWorkflows((prev) => prev.map((w) => w.id === updated.id ? updated : w));
          setEditing(updated);
        }}
        onBack={() => { setEditing(null); load(); }}
      />
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Workflows</h1>
          <p className="text-sm text-slate-500 mt-1">Automate what happens when content is created or published.</p>
        </div>
        <button
          onClick={createNew}
          disabled={creating}
          className="flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-600 disabled:opacity-50 transition active:scale-[0.98]"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} New Workflow
        </button>
      </div>

      {/* Errors */}
      {createError && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          <XCircle size={14} className="shrink-0" /> {createError}
          <button onClick={() => setCreateError(null)} className="ml-auto text-red-400 hover:text-red-600"><X size={12} /></button>
        </div>
      )}
      {loadError && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          <XCircle size={14} className="shrink-0" /> {loadError}
          <button onClick={load} className="ml-auto text-xs font-semibold underline">Retry</button>
        </div>
      )}

      {/* Empty state */}
      {!loading && workflows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-5">
          {/* Illustration */}
          <div className="relative w-24 h-24">
            <div className="absolute inset-0 rounded-3xl bg-indigo-100 rotate-6" />
            <div className="absolute inset-0 rounded-3xl bg-indigo-50 flex items-center justify-center">
              <GitBranch size={36} className="text-[#2563EB]" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-lg font-black text-slate-800">No workflows yet</p>
            <p className="text-sm text-slate-500 mt-1 max-w-xs">
              Create a workflow to automate actions — like generating images whenever you create a post.
            </p>
          </div>
          <button
            onClick={createNew}
            disabled={creating}
            className="flex items-center gap-2 rounded-xl bg-[#2563EB] px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-600 disabled:opacity-50 transition"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {creating ? 'Creating…' : 'Create your first workflow'}
          </button>

          {/* How it works */}
          <div className="mt-6 grid grid-cols-3 gap-4 max-w-lg text-center">
            {[
              { icon: <Zap size={18} className="text-[#2563EB]" />, title: 'Set a trigger', desc: 'Choose what starts the workflow' },
              { icon: <GitBranch size={18} className="text-amber-500" />, title: 'Add conditions', desc: 'Branch based on your rules' },
              { icon: <Play size={18} className="text-emerald-500" />, title: 'Define actions', desc: 'Generate images, schedule, notify' },
            ].map((s) => (
              <div key={s.title} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 flex flex-col items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center shadow-sm">{s.icon}</div>
                <p className="text-xs font-bold text-slate-700">{s.title}</p>
                <p className="text-[11px] text-slate-400">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-slate-400" />
        </div>
      )}

      {/* Workflow cards */}
      {!loading && workflows.length > 0 && (
        <div className="space-y-3">
          {workflows.map((wf) => {
            const triggerNode = wf.nodes.find((n) => n.type === 'trigger');
            const condCount   = wf.nodes.filter((n) => n.type === 'condition').length;
            const actionCount = wf.nodes.filter((n) => n.type === 'action').length;
            return (
              <div
                key={wf.id}
                className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 hover:border-slate-300 hover:shadow-sm transition-all group"
              >
                {/* Icon */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${wf.status === 'active' ? 'bg-indigo-100' : 'bg-slate-100'}`}>
                  <GitBranch size={18} className={wf.status === 'active' ? 'text-[#2563EB]' : 'text-slate-400'} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-slate-900 truncate">{wf.name}</span>
                    {statusBadge(wf.status)}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {triggerNode && (
                      <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Zap size={10} className="text-[#2563EB]" />{triggerNode.label}
                      </span>
                    )}
                    {condCount > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        <GitBranch size={10} className="text-amber-500" />{condCount} condition{condCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {actionCount > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Play size={10} className="text-emerald-500" />{actionCount} action{actionCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {!triggerNode && <span className="text-[11px] text-slate-400 italic">No trigger set</span>}
                  </div>
                </div>

                {/* Last updated */}
                <span className="text-[11px] text-slate-400 shrink-0 hidden sm:block">{timeAgo(wf.updated_at)}</span>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleActive(wf)}
                    disabled={toggling === wf.id}
                    title={wf.status === 'active' ? 'Deactivate' : 'Activate'}
                    className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700"
                  >
                    {toggling === wf.id
                      ? <Loader2 size={15} className="animate-spin" />
                      : wf.status === 'active'
                        ? <ToggleRight size={18} className="text-[#2563EB]" />
                        : <ToggleLeft size={18} />
                    }
                  </button>
                  <button
                    onClick={() => setEditing(wf)}
                    className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700"
                  >
                    <Settings size={15} />
                  </button>
                  <button
                    onClick={() => deleteWf(wf.id)}
                    disabled={deleting === wf.id}
                    className="p-2 rounded-lg hover:bg-red-50 transition-colors text-slate-400 hover:text-red-500"
                  >
                    {deleting === wf.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
